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
  async function importEpisodes(itemId: number, grab: Grab, tools: ImportTools) {
    const show = series.get(itemId)
    if (!show) throw new ImportError('the series is no longer in the library')
    const videos = await tools.files()
    const episodes = series.episodes(show.id)
    const grabbed = new Set(series.grabEpisodes(grab.id))
    const releaseParsed = parse(grab.title, { kind: 'series' })
    const naming = ctx.library.naming('series')
    const folder = ctx.library.folderOf(show)
    const quality = grab.quality

    const results: { path: string; method: string; replaced?: string }[] = []
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

      const seasonDir =
        show.details.seasonFolders && naming.seasonFolder
          ? renderName(naming.seasonFolder, { season: covered[0]!.season })
          : ''
      const fileName = episodeFileName(
        show,
        covered,
        { quality, qualityName: ctx.decision.qualityName(quality), parsed },
        naming,
      )
      const dest = join(folder, seasonDir, fileName + extname(video.path).toLowerCase())

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
      for (const file of replaced) if (join(folder, file.path) === dest) await tools.recycle(dest)

      const method = await tools.place(video.path, dest)

      for (const file of replaced) {
        if (join(folder, file.path) !== dest) await tools.recycle(join(folder, file.path))
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
      skipped: skipped.length ? skipped : undefined,
    } satisfies ImportResult
  }

  ctx.import.register('series', (item, grab, tools) => importEpisodes(item.id, grab, tools))
}
