// @magpiejs/podcasts: the podcast kind (docs/PLAN.md, Phase 4.6). Podcasts are followed by
// their RSS feed: episodes come from the feed, are downloaded directly from their URL by the
// `downloader-http` client through the normal downloads queue, and imported like any other
// kind. There are no indexers or quality choices: each episode has one file.

import { rmSync } from 'node:fs'
import type {} from '@cordisjs/plugin-http'
import type {} from '@cordisjs/plugin-timer'
import type { Drizzle } from '@magpiejs/database'
import { type BaseParsed, profileItems } from '@magpiejs/decision'
import type {} from '@magpiejs/jobs'
import { type MediaFile, type MediaItem, type NamingScheme, renderName } from '@magpiejs/library'
import type {} from '@magpiejs/metadata'
import { type Context, Service } from 'cordis'
import { desc, eq, inArray } from 'drizzle-orm'
import z from 'schemastery'
import { type FeedEpisode, parseFeed } from './feed'
import * as schema from './schema'

export * from './feed'
export * from './schema'

declare module '@magpiejs/types' {
  interface MediaKinds {
    podcast: true
  }
}

declare module 'cordis' {
  interface Context {
    podcasts: PodcastsService
  }
  interface Events {
    'podcasts/added'(podcast: Podcast, options: { download: boolean }): void
    /** Episodes were added or changed (refresh, monitoring, files, downloads). */
    'podcasts/episodes'(mediaId: number): void
  }
}

export interface PodcastStats {
  episodes: number
  downloaded: number
  /** Monitored episodes without a file. */
  wanted: number
  /** ISO date-time of the newest episode. */
  latest?: string
}

export interface Podcast extends MediaItem {
  details: schema.PodcastDetails
  stats: PodcastStats
}

export interface AddPodcastOptions {
  feedUrl: string
  rootFolderId: number
  /** Which episodes to download: every one, only new ones, the newest few, or none. */
  monitor?: schema.MonitorOption
  /** For `latest`: how many of the newest episodes. */
  latestCount?: number
  /** Keep only the files of the newest N episodes. */
  keepLatest?: number | null
  /** Start downloading right away. */
  download?: boolean
  itunesId?: string
}

export interface Config {
  /** Minutes between feed refreshes. */
  refreshMinutes: number
}

export const Config: z<Config> = z.object({
  refreshMinutes: z.natural().min(5).default(60).description('Minutes between feed checks.'),
})

/** Downloads that failed this often wait for a manual download. */
export const MAX_ATTEMPTS = 3

export const PODCAST_NAMING: NamingScheme = {
  templates: {
    podcastFolder: { label: 'Podcast folder', default: '{Podcast Title}' },
    episodeFile: {
      label: 'Episode file',
      default: '{Published Date} - {Episode Title}',
      help: 'The file extension is added for you.',
    },
  },
  tokens: ['Podcast Title', 'Author', 'Published Date', 'Episode Title', 'season:00', 'episode:00'],
}

/** Podcasts need a quality profile like every library item; theirs has one quality. */
const podcastFamily = {
  id: 'podcast',
  label: 'Podcasts',
  qualities: [{ id: 'podcast-episode', name: 'Episode' }],
  parse: (title: string): BaseParsed => ({
    input: title,
    title,
    kind: 'episode',
    revision: { version: 1, real: 0, proper: false, repack: false },
    languages: [],
    flags: [],
  }),
  qualityOf: () => 'podcast-episode',
  sizeRule: 'none' as const,
  defaultProfiles: [
    {
      name: 'Podcast',
      items: profileItems(['podcast-episode'], ['podcast-episode']),
      cutoff: 'podcast-episode',
    },
  ],
}

function episodeValues(e: FeedEpisode) {
  return {
    guid: e.guid,
    title: e.title,
    description: e.description ?? null,
    publishedAt: e.publishedAt ?? null,
    enclosureUrl: e.enclosure.url,
    enclosureType: e.enclosure.type ?? null,
    enclosureSize: e.enclosure.length ?? null,
    durationSeconds: e.durationSeconds ?? null,
    season: e.season ?? null,
    number: e.number ?? null,
  }
}

export class PodcastsService extends Service {
  static inject = ['database', 'library', 'decision', 'jobs', 'http', 'timer']

  db!: Drizzle<typeof schema>
  config: Config

  constructor(ctx: Context, config: Config = { refreshMinutes: 60 }) {
    super(ctx, 'podcasts')
    this.config = config
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'podcasts',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    this.ctx.library.registerKind({ id: 'podcast', label: 'Podcasts' })
    this.ctx.library.registerNaming('podcast', PODCAST_NAMING)
    this.ctx.decision.family(podcastFamily)
    this.ctx.jobs.define('podcasts.refresh', async (payload: { id?: number }) => {
      const ids = payload?.id ? [payload.id] : this.list().map((p) => p.id)
      for (const id of ids) {
        try {
          await this.refresh(id)
        } catch (error) {
          this.ctx.logger.warn('could not refresh podcast %s: %s', id, error)
        }
      }
    })
    this.ctx.jobs.schedule(
      'podcasts.refresh-all',
      'podcasts.refresh',
      this.config.refreshMinutes * 60_000,
    )
  }

  /** The profile podcasts use (created with the podcast quality family). */
  profileId() {
    const profile = this.ctx.decision.profiles('podcast')[0]
    if (!profile) throw new Error('the podcast quality profile is missing')
    return profile.id
  }

  // ---- finding podcasts

  /** Search a podcast directory (iTunes); results already followed carry their library id. */
  async lookup(term: string) {
    const provider = this.ctx.metadata.for('podcast')
    if (!provider) throw new Error('no podcast search is enabled (add iTunes in Settings)')
    const results = await provider.search({ term, kind: 'podcast' })
    const followed = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [d.feedUrl, d.mediaId]),
    )
    return results.map((r) => ({ ...r, libraryId: followed.get(r.feedUrl ?? '') }))
  }

  /** Fetches and reads a feed. `null` when it hasn't changed since the given validators. */
  async fetchFeed(
    url: string,
    validators: { etag?: string | null; lastModified?: string | null } = {},
  ) {
    const response = await this.ctx.http(url, {
      headers: {
        Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        ...(validators.etag && { 'If-None-Match': validators.etag }),
        ...(validators.lastModified && { 'If-Modified-Since': validators.lastModified }),
      },
      responseType: 'text',
      timeout: 30_000,
      validateStatus: () => true,
    } as never)
    if (response.status === 304) return null
    if (response.status >= 400) throw new Error(`the feed answered HTTP ${response.status}`)
    const feed = parseFeed(await response.text())
    return {
      feed,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    }
  }

  /** What a feed holds, before following it. */
  async preview(feedUrl: string) {
    const result = await this.fetchFeed(feedUrl)
    const feed = result!.feed
    return {
      title: feed.title,
      author: feed.author,
      description: feed.description,
      imageUrl: feed.imageUrl,
      episodes: feed.episodes.length,
      latest:
        feed.episodes
          .map((e) => e.publishedAt ?? '')
          .sort()
          .at(-1) || undefined,
    }
  }

  // ---- following

  async add(options: AddPodcastOptions): Promise<Podcast> {
    const feedUrl = options.feedUrl.trim()
    const found = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.feedUrl, feedUrl))
      .get()
    if (found) throw new Error('this podcast is already followed')
    const { feed, etag, lastModified } = (await this.fetchFeed(feedUrl))!
    const monitor = options.monitor ?? 'new'
    const newest = new Set(
      [...feed.episodes]
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, options.latestCount ?? 3)
        .map((e) => e.guid),
    )
    const monitored = (e: FeedEpisode) =>
      monitor === 'all' || (monitor === 'latest' && newest.has(e.guid))

    const naming = this.ctx.library.naming('podcast')
    const item = this.ctx.library.add({
      kind: 'podcast',
      title: feed.title,
      year: null,
      overview: feed.description ?? null,
      posterUrl: feed.imageUrl ?? null,
      monitored: monitor !== 'none',
      externalIds: options.itunesId ? { itunes: options.itunesId } : {},
      primaryProvider: 'feed',
      profileId: this.profileId(),
      rootFolderId: options.rootFolderId,
      folder: renderName(naming.podcastFolder!, {
        'Podcast Title': feed.title,
        Author: feed.author,
      }),
      refreshedAt: Date.now(),
    })
    this.db.transaction((tx) => {
      tx.insert(schema.details)
        .values({
          mediaId: item.id,
          feedUrl,
          itunesId: options.itunesId ?? null,
          author: feed.author ?? null,
          link: feed.link ?? null,
          language: feed.language ?? null,
          monitorNew: monitor !== 'none',
          keepLatest: options.keepLatest ?? null,
          etag,
          lastModified,
          refreshedAt: Date.now(),
        })
        .run()
      for (const e of dedupe(feed.episodes)) {
        tx.insert(schema.episodes)
          .values({ mediaId: item.id, ...episodeValues(e), monitored: monitored(e) })
          .run()
      }
    })
    const podcast = this.get(item.id)!
    this.ctx.emit('podcasts/added', podcast, { download: options.download ?? true })
    return podcast
  }

  /** Reads the feed again: new episodes are added (monitored if the podcast says so). */
  async refresh(id: number) {
    const podcast = this.get(id)
    if (!podcast) return
    const d = podcast.details
    let result: Awaited<ReturnType<PodcastsService['fetchFeed']>>
    try {
      result = await this.fetchFeed(d.feedUrl, d)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.db
        .update(schema.details)
        .set({ refreshError: reason })
        .where(eq(schema.details.mediaId, id))
        .run()
      throw error
    }
    const now = Date.now()
    if (!result) {
      this.db
        .update(schema.details)
        .set({ refreshedAt: now, refreshError: null })
        .where(eq(schema.details.mediaId, id))
        .run()
      return
    }
    const { feed, etag, lastModified } = result
    const known = new Map(this.episodes(id).map((e) => [e.guid, e]))
    const monitorNew = podcast.monitored && d.monitorNew
    let added = 0
    this.db.transaction((tx) => {
      tx.update(schema.details)
        .set({
          author: feed.author ?? null,
          link: feed.link ?? null,
          language: feed.language ?? null,
          etag,
          lastModified,
          refreshedAt: now,
          refreshError: null,
        })
        .where(eq(schema.details.mediaId, id))
        .run()
      for (const e of dedupe(feed.episodes)) {
        const old = known.get(e.guid)
        if (old) {
          tx.update(schema.episodes)
            .set(episodeValues(e))
            .where(eq(schema.episodes.id, old.id))
            .run()
        } else {
          tx.insert(schema.episodes)
            .values({ mediaId: id, ...episodeValues(e), monitored: monitorNew })
            .run()
          added++
        }
      }
      // episodes that left the feed stay: feeds often only list the latest ones
    })
    this.ctx.library.update(id, {
      title: feed.title,
      overview: feed.description ?? null,
      posterUrl: feed.imageUrl ?? null,
      refreshedAt: now,
    })
    if (added) this.ctx.logger.info('%s: %d new episode(s)', feed.title, added)
    this.ctx.emit('podcasts/episodes', id)
  }

  // ---- reading

  get(id: number): Podcast | undefined {
    const item = this.ctx.library.get(id)
    const details = this.db
      .select()
      .from(schema.details)
      .where(eq(schema.details.mediaId, id))
      .get()
    if (!item || !details) return
    return { ...item, details, stats: this.stats(id) }
  }

  list(): Podcast[] {
    const details = new Map(
      this.db
        .select()
        .from(schema.details)
        .all()
        .map((d) => [d.mediaId, d]),
    )
    return this.ctx.library
      .list('podcast')
      .filter((item) => details.has(item.id))
      .map((item) => ({ ...item, details: details.get(item.id)!, stats: this.stats(item.id) }))
  }

  stats(mediaId: number): PodcastStats {
    const episodes = this.episodes(mediaId)
    const files = this.episodeFiles(mediaId)
    return {
      episodes: episodes.length,
      downloaded: episodes.filter((e) => files.has(e.id)).length,
      wanted: episodes.filter((e) => e.monitored && !files.has(e.id)).length,
      latest: episodes[0]?.publishedAt ?? undefined,
    }
  }

  /** Newest first. */
  episodes(mediaId: number) {
    return this.db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.mediaId, mediaId))
      .orderBy(desc(schema.episodes.publishedAt), desc(schema.episodes.id))
      .all()
  }

  episode(id: number) {
    return this.db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get()
  }

  /** Files of a podcast by episode id. */
  episodeFiles(mediaId: number): Map<number, MediaFile> {
    const files = new Map(this.ctx.library.files(mediaId).map((f) => [f.id, f]))
    if (!files.size) return new Map()
    const links = this.db
      .select()
      .from(schema.episodeFiles)
      .where(inArray(schema.episodeFiles.fileId, [...files.keys()]))
      .all()
    return new Map(links.map((l) => [l.episodeId, files.get(l.fileId)!]))
  }

  /** Episodes to download: monitored, no file, not failing repeatedly. */
  wanted(mediaId: number) {
    const podcast = this.get(mediaId)
    if (!podcast?.monitored) return []
    const files = this.episodeFiles(mediaId)
    return this.episodes(mediaId).filter(
      (e) => e.monitored && !files.has(e.id) && e.attempts < MAX_ATTEMPTS,
    )
  }

  // ---- changing

  update(
    id: number,
    patch: { monitored?: boolean; monitorNew?: boolean; keepLatest?: number | null },
  ) {
    const { monitored, ...details } = patch
    if (Object.keys(details).length)
      this.db.update(schema.details).set(details).where(eq(schema.details.mediaId, id)).run()
    if (monitored !== undefined) this.ctx.library.update(id, { monitored })
    this.ctx.emit('podcasts/episodes', id)
    return this.get(id)
  }

  monitorEpisodes(episodeIds: number[], monitored: boolean) {
    if (!episodeIds.length) return
    const rows = this.db
      .update(schema.episodes)
      .set({ monitored, ...(monitored && { attempts: 0, lastError: null }) })
      .where(inArray(schema.episodes.id, episodeIds))
      .returning()
      .all()
    for (const mediaId of new Set(rows.map((r) => r.mediaId)))
      this.ctx.emit('podcasts/episodes', mediaId)
  }

  /** Records that a library file holds an episode (replacing an earlier one). */
  linkFile(fileId: number, episodeId: number) {
    this.db.transaction((tx) => {
      tx.delete(schema.episodeFiles).where(eq(schema.episodeFiles.episodeId, episodeId)).run()
      tx.insert(schema.episodeFiles).values({ fileId, episodeId }).run()
    })
  }

  failed(episodeId: number, reason: string) {
    const episode = this.episode(episodeId)
    if (!episode) return
    this.db
      .update(schema.episodes)
      .set({ attempts: episode.attempts + 1, lastError: reason })
      .where(eq(schema.episodes.id, episodeId))
      .run()
    this.ctx.emit('podcasts/episodes', episode.mediaId)
  }

  remove(id: number, deleteFiles = false) {
    const podcast = this.get(id)
    if (!podcast) return
    if (deleteFiles) rmSync(this.ctx.library.folderOf(podcast), { recursive: true, force: true })
    this.ctx.library.remove(id)
  }
}

/** Some feeds repeat an item; keep the first of each guid. */
function dedupe(episodes: FeedEpisode[]) {
  const seen = new Set<string>()
  return episodes.filter((e) => !seen.has(e.guid) && seen.add(e.guid))
}

export default PodcastsService
