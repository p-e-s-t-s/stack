// Episode import (docs/phase-4.md §4.3). Loaded only while the import plugin is enabled: maps
// each video in a download to episodes, names and places it, and links it to them.

import { basename, extname, join, relative } from 'node:path'
import type { Grab } from '@magpiejs/downloads'
import { ImportError, type ImportResult, type ImportTools } from '@magpiejs/import'
import { type MediaFile, renderName } from '@magpiejs/library'
import { type ParsedRelease, parse } from '@magpiejs/parser'
import type { Context } from 'cordis'
import type { Series, SeriesService } from './index'
import type { Episode } from './schema'
import { episodesFor } from './search'

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** File name (without extension) for episodes of a series, from the naming templates. */
export function episodeFileName(
  series: Series,
  episodes: Episode[],
  release: { quality: string; qualityName?: string; parsed: ParsedRelease },
  naming: Record<string, string>,
) {
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.number - b.number)
  const first = sorted[0]!
  const template =
    series.details.seriesType === 'daily'
      ? naming.dailyEpisodeFile!
      : series.details.seriesType === 'anime'
        ? naming.animeEpisodeFile!
        : naming.episodeFile!
  const multi = sorted.length > 1
  return renderName(template, {
    'Series Title': series.title,
    Title: series.title,
    Year: series.year ?? undefined,
    season: first.season,
    // S01E01-E02 for multi-episode files
    episode: multi ? sorted.map((e) => pad(e.number)).join('-E') : first.number,
    absolute: multi
      ? sorted.map((e) => pad(e.absoluteNumber ?? 0, 3)).join('-')
      : (first.absoluteNumber ?? undefined),
    'Episode Title': [...new Set(sorted.map((e) => e.title).filter(Boolean))].join(' + '),
    'Air Date': first.airDate ?? undefined,
    Quality: release.qualityName ?? release.quality,
    Group: release.parsed.group,
    Resolution: release.parsed.resolution,
    Source: release.parsed.source,
  })
}

export default function episodeImport(ctx: Context, series: SeriesService) {
  ctx.import.review.register('series', {
    lookup: (term) => series.lookup(term),
    async adopt(row, rootFolderId) {
      const existing = series.list().find((s) => s.details.tmdbId === row.tmdbId)
      if (existing) {
        if (existing.folder !== row.folder || existing.rootFolderId !== rootFolderId)
          throw new ImportError('this series exists in another folder')
        return existing
      }
      return series.add({
        tmdbId: row.tmdbId!,
        profileId: row.profileId!,
        rootFolderId,
        folder: row.folder,
        monitor: 'none',
        seriesType: row.seriesType ?? 'standard',
        search: false,
      })
    },
    async validateAdoption(row) {
      const provider = ctx.metadata.for('series', 'tmdb')
      if (!provider?.getEpisodes) throw new ImportError('enable a TV metadata provider')
      const episodes = (await provider.getEpisodes(String(row.tmdbId))).sort(
        (a, b) => a.season - b.season || a.number - b.number,
      )
      row.episodeChoices = episodes.map((e) => ({
        key: `${e.season}:${e.number}`,
        label: `S${e.season}E${e.number} — ${e.title ?? ''}`,
      }))
      if (!row.episodeKeys?.length) {
        const parsed = parse(basename(row.source, extname(row.source)), { kind: 'series' })
        const numbers = parsed.episodes
        let absolute = 0
        row.episodeKeys = episodes
          .filter((e) => {
            if (e.season > 0) absolute++
            if (numbers?.airDate) return e.airDate === numbers.airDate
            if (
              numbers?.absolute?.length ||
              (numbers?.season === undefined && numbers?.numbers.length)
            )
              return (
                e.season > 0 &&
                (numbers.absolute ?? numbers.numbers).includes(e.absoluteNumber ?? absolute)
              )
            return numbers?.season === e.season && numbers.numbers.includes(e.number)
          })
          .map((e) => `${e.season}:${e.number}`)
      }
      if (
        !row.episodeKeys.length ||
        row.episodeKeys.some((k) => !row.episodeChoices!.some((e) => e.key === k))
      )
        throw new ImportError('choose episode numbers for this file')
    },
    episodes: (id) => series.episodes(id),
    fileEpisodes: (fileId) =>
      series
        .list()
        .flatMap((show) =>
          [...series.episodeFiles(show.id)].filter(([, f]) => f.id === fileId).map(([id]) => id),
        ),
    plan(item, row) {
      const show = series.get(item.id)
      if (!show) throw new ImportError('series not found')
      const parsed = parse(row.releaseName ?? basename(row.source, extname(row.source)), {
        kind: 'series',
      })
      const episodes = series.episodes(item.id)
      const covered = row.episodeIds?.length
        ? episodes.filter((e) => row.episodeIds!.includes(e.id))
        : row.episodeKeys?.length
          ? episodes.filter((e) => row.episodeKeys!.includes(`${e.season}:${e.number}`))
          : episodesFor(show, parsed, episodes)
      if (
        !covered.length ||
        (row.episodeIds?.length && covered.length !== new Set(row.episodeIds).size)
      )
        throw new ImportError('choose episodes belonging to this series')
      const links = series.episodeFiles(item.id)
      const ids = new Set(covered.map((e) => e.id))
      const conflicts = [
        ...new Set(covered.flatMap((e) => (links.get(e.id) ? [links.get(e.id)!.id] : []))),
      ]
      // Do not recycle a multi-episode file still needed by episodes outside this selection.
      const replaceable = conflicts.filter((fid) =>
        [...links].every(([eid, file]) => file.id !== fid || ids.has(eid)),
      )
      const naming = ctx.library.naming('series')
      const seasonDir = show.details.seasonFolders
        ? renderName(naming.seasonFolder!, { season: covered[0]!.season })
        : ''
      const name = episodeFileName(
        show,
        covered,
        { quality: row.quality, qualityName: ctx.decision.qualityName(row.quality), parsed },
        naming,
      )
      return {
        destination: join(
          ctx.library.folderOf(item),
          seasonDir,
          name + extname(row.source).toLowerCase(),
        ),
        episodeIds: covered.map((e) => e.id),
        conflicts,
        preserve: conflicts.filter((id) => !replaceable.includes(id)),
      }
    },
    record(item, row, file) {
      series.replaceFileLinks(file.id, row.episodeIds!)
      ctx.emit('series/episodes', item.id)
    },
    finishAdoption: (id, monitored) => {
      series.finishAdoption(id, monitored)
    },
  })
  async function importEpisodes(itemId: number, grab: Grab, tools: ImportTools) {
    const show = series.get(itemId)
    if (!show) throw new ImportError('the series is no longer in the library')
    const videos = await tools.files()
    const episodes = series.episodes(show.id)
    const grabbed = new Set(series.grabEpisodes(grab.id))
    const releaseParsed = parse(grab.title, { kind: 'series' })
    const folder = ctx.library.folderOf(show)
    const quality = grab.quality

    const results: { path: string; method: string; replaced?: string; removed: string[] }[] = []
    const skipped: string[] = []
    for (const video of videos) {
      const name = basename(video.path, extname(video.path))
      let parsed = parse(name, { kind: 'series' })
      let covered = episodesFor(show, parsed, episodes)
      // a lone file named without episode numbers takes the release's episodes
      if (!covered.length && videos.length === 1) {
        parsed = releaseParsed
        covered = episodesFor(show, parsed, episodes)
        if (!covered.length) covered = episodes.filter((e) => grabbed.has(e.id))
      }
      if (!covered.length) {
        skipped.push(`${basename(video.path)}: no matching episode`)
        continue
      }

      // it may no longer be an upgrade (another import won, or the profile changed)
      const files = series.episodeFiles(show.id)
      const revision = parsed.revision ?? releaseParsed.revision
      const candidate = { quality, formatScore: grab.formatScore, revision }
      const improves = covered.filter((e) => {
        const file = files.get(e.id)
        return !file || grab.manual || tools.isUpgrade(candidate, file)
      })
      if (!improves.length) {
        skipped.push(`${basename(video.path)}: not an upgrade`)
        continue
      }

      const dest = ctx.import.review.adapter('series').plan(show, {
        source: video.path,
        quality,
        episodeIds: covered.map((e) => e.id),
        releaseName: parsed.input,
      }).destination

      // files this one replaces entirely; a multi-episode file that also holds other
      // episodes stays for those
      const coveredIds = new Set(covered.map((e) => e.id))
      const old = new Map<number, MediaFile>()
      for (const e of covered) {
        const file = files.get(e.id)
        if (file) old.set(file.id, file)
      }
      const replaced = [...old.values()].filter((file) =>
        [...files].every(([episodeId, f]) => f.id !== file.id || coveredIds.has(episodeId)),
      )
      const method = await tools.place(video.path, dest)
      // a kept multi-episode file loses the links this file takes over; undo gives them back
      const kept = covered.flatMap((e) => {
        const file = files.get(e.id)
        return file && !replaced.some((f) => f.id === file.id) ? [[e.id, file.id]] : []
      })
      if (kept.length) tools.annotate({ links: kept })

      const removed: string[] = []
      for (const file of replaced) {
        if (join(folder, file.path) !== dest) {
          await tools.recycle(join(folder, file.path))
          removed.push(join(folder, file.path))
        }
        ctx.library.removeFile(file.id)
      }
      const row = ctx.library.addFile({
        mediaId: show.id,
        path: relative(folder, dest),
        size: video.size,
        quality,
        formatScore: grab.formatScore,
        languages: parsed.languages,
        releaseName: grab.title,
        releaseGroup: parsed.group ?? releaseParsed.group ?? null,
        revision,
      })
      series.linkFile(
        row.id,
        covered.map((e) => e.id),
      )
      results.push({
        path: dest,
        method,
        replaced: replaced.map((f) => f.path).join(', ') || undefined,
        removed,
      })
    }

    if (!results.length) throw new ImportError(`nothing imported (${skipped.join('; ')})`)
    ctx.emit('series/episodes', show.id)
    return {
      path: results[0]!.path,
      method: results[0]!.method,
      replaced:
        results
          .map((r) => r.replaced)
          .filter(Boolean)
          .join(', ') || undefined,
      files: results.length,
      added: results.map((r) => r.path),
      removed: results.flatMap((r) => r.removed),
      skipped: skipped.length ? skipped : undefined,
    } satisfies ImportResult
  }

  ctx.import.register('series', (item, grab, tools) => importEpisodes(item.id, grab, tools))
  // undoing an import puts a replaced file back with the episodes it covered
  ctx.import.registerUndo('series', {
    capture: (item, file) =>
      [...series.episodeFiles(item.id)].filter(([, f]) => f.id === file.id).map(([id]) => id),
    restore(_item, file, episodeIds) {
      if (Array.isArray(episodeIds) && episodeIds.length)
        series.linkFile(file.id, episodeIds as number[])
    },
    rollback(_item, note) {
      const links = (note as { links?: [number, number][] } | undefined)?.links ?? []
      const files = new Set(ctx.library.files(_item.id).map((f) => f.id))
      for (const [episodeId, fileId] of links)
        if (files.has(fileId)) series.linkFile(fileId, [episodeId])
    },
    changed: (item) => void ctx.emit('series/episodes', item.id),
  })
}
