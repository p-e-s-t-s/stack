// Album import. Loaded only while the import plugin is enabled. Each audio file is matched to
// a track of the album — by its tags when it has readable ones, else by its path — and the
// album is refused unless every track gets exactly one file. Files are named
// `Artist/Album (Year)/{Disc}NN - Title.ext` and replace the album's earlier files when they're
// an upgrade.

import { extname, join, relative } from 'node:path'
import type { Grab } from '@magpiejs/downloads'
import { ImportError, type ImportResult, type ImportTools } from '@magpiejs/import'
import { type MediaItem, renderName } from '@magpiejs/library'
import type { Context } from 'cordis'
import type { MusicService } from './index'
import { matchAlbums, matchTrack } from './match'
import { parseMusic, parseTrackFile } from './parse'
import type { Track } from './schema'
import { artistNames } from './search'

export const AUDIO_EXTENSIONS = [
  '.flac',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wav',
  '.aiff',
  '.wv',
  '.ape',
]

export interface FileTags {
  disc?: number
  track?: number
  title?: string
  /** Seconds. */
  seconds?: number
}

/** Tags and length of an audio file; empty when it can't be read. */
export async function readTags(path: string): Promise<FileTags> {
  try {
    const { parseFile } = await import('music-metadata')
    const { common, format } = await parseFile(path, { duration: true, skipCovers: true })
    return {
      disc: common.disk.no ?? undefined,
      track: common.track.no ?? undefined,
      title: common.title,
      seconds: format.duration,
    }
  } catch {
    return {}
  }
}

export default function albumImport(ctx: Context, music: MusicService) {
  async function importAlbum(
    item: MediaItem,
    grab: Grab,
    tools: ImportTools,
  ): Promise<ImportResult> {
    const artist = music.get(item.id)
    if (!artist) throw new ImportError('the artist is no longer in the library')
    const albums = music.albums(artist.id)
    const [grabbed] = music.grabAlbums(grab.id)
    const album =
      albums.find((a) => a.id === grabbed) ??
      matchAlbums(parseMusic(grab.title), artistNames(ctx, artist), albums)[0]
    if (!album) throw new ImportError(`${grab.title} is not one of ${artist.title}'s albums`)
    const tracks = await music.ensureTracks(album.id)
    if (!tracks.length) throw new ImportError(`no track list for ${album.title}`)
    const discs = new Set(tracks.map((t) => t.disc)).size

    // every file to a distinct track
    const files = await tools.files()
    const matched = new Map<number, { path: string; size: number; track: Track }>()
    const skipped: string[] = []
    for (const file of files) {
      const path = relative(grab.outputPath!, file.path)
      const fromName = parseTrackFile(path, discs)
      const tags = await readTags(file.path)
      const track = matchTrack(
        {
          disc: tags.disc ?? fromName.disc,
          track: tags.track ?? fromName.track,
          title: tags.title ?? fromName.title,
          seconds: tags.seconds,
        },
        tracks,
        discs,
      )
      if (!track) {
        skipped.push(`${path}: no matching track`)
        continue
      }
      const taken = matched.get(track.id)
      if (taken)
        throw new ImportError(
          `${path} and ${relative(grab.outputPath!, taken.path)} are both track ${track.number} (${track.title})`,
        )
      matched.set(track.id, { ...file, track })
    }
    const missing = tracks.filter((t) => !matched.has(t.id))
    if (missing.length)
      throw new ImportError(
        `${matched.size} of ${tracks.length} tracks of ${album.title} found; missing ${missing
          .slice(0, 5)
          .map((t) => `${discs > 1 ? `${t.disc}-` : ''}${t.number} ${t.title}`)
          .join(', ')}${missing.length > 5 ? '…' : ''}`,
      )

    // replace what's there only with something better (or when chosen by hand)
    const existing = music.trackFiles(album.id)
    const revision = parseMusic(grab.title).revision
    if (existing.size && !grab.manual) {
      const worst = music.worstFile(album.id, artist.profileId)!
      if (
        !tools.isUpgrade({ quality: grab.quality, formatScore: grab.formatScore, revision }, worst)
      )
        throw new ImportError(
          `not an upgrade over the ${ctx.decision.qualityName(worst.quality)} files`,
        )
    }

    const naming = ctx.library.naming('music')
    const folder = ctx.library.folderOf(artist)
    const albumDir = join(
      folder,
      renderName(naming.albumFolder!, {
        'Artist Name': artist.title,
        'Album Title': album.title,
        'Album Type': album.primaryType ?? undefined,
        'Release Year': album.releaseDate?.slice(0, 4),
      }),
    )
    for (const old of existing.values()) {
      await tools.recycle(join(folder, old.path))
      ctx.library.removeFile(old.id)
    }
    let method = ''
    const parsed = parseMusic(grab.title)
    for (const { path, size, track } of [...matched.values()].sort(
      (a, b) => a.track.disc - b.track.disc || a.track.number - b.track.number,
    )) {
      const name = renderName(naming.trackFile!, {
        'Artist Name': artist.title,
        'Album Title': album.title,
        'Disc Prefix': discs > 1 ? `${track.disc}-` : undefined,
        disc: track.disc,
        track: track.number,
        'Track Title': track.title,
        Quality: ctx.decision.qualityName(grab.quality),
      })
      const dest = join(albumDir, name + extname(path).toLowerCase())
      method = await tools.place(path, dest)
      const row = ctx.library.addFile({
        mediaId: artist.id,
        path: relative(folder, dest),
        size,
        quality: grab.quality,
        formatScore: grab.formatScore,
        languages: parsed.languages,
        releaseName: grab.title,
        releaseGroup: parsed.group ?? null,
        revision,
      })
      music.linkTrackFile(row.id, track.id)
    }
    ctx.emit('music/changed', artist.id)
    return {
      path: albumDir,
      method,
      replaced: existing.size ? `${existing.size} files` : undefined,
      files: matched.size,
      skipped: skipped.length ? skipped : undefined,
    }
  }

  ctx.import.register('music', importAlbum, { extensions: AUDIO_EXTENSIONS })
}
