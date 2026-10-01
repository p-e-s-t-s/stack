// Web console entry: Settings → Download checks, and a check badge on queue rows.

import type {} from '@magpiejs/webui'
import type { Context } from 'cordis'
import type { CheckInfo, VerifyService, Verdict } from './index'
import type { Mode, Policy, Result } from './schema'

export interface VerifyData {
  checks: CheckInfo[]
  durationTolerance: number
  /** ffprobe and ffmpeg availability, for notices next to the checks that need them. */
  tools: { ffprobe: boolean; ffmpeg: boolean }
  recent: Result[]
  /** Changes whenever a download is checked, so open queue rows reload. */
  version: number
  /** The latest check of a download, if it has been checked. */
  forGrab(grabId: number): Promise<Result | null>
  save(input: { modes: Record<string, Mode>; durationTolerance: number }): Promise<Policy>
  /** Runs the checks on a path inside the library or a recent download; nothing is recorded. */
  test(path: string, releaseName: string): Promise<Verdict>
}

export default function console_(ctx: Context, verify: VerifyService) {
  let version = 0
  const snapshot = () => ({
    checks: verify.list(),
    durationTolerance: verify.policy().durationTolerance,
    tools: {
      ffprobe: ctx.mediaTools.status.ffprobe.ok,
      ffmpeg: ctx.mediaTools.status.ffmpeg.ok,
    },
    recent: verify.recent(30),
  })
  const refresh = () =>
    entry.mutate((d) => {
      Object.assign(d, snapshot())
      d.version = ++version
    })
  ctx.on('verify/checked', refresh)
  ctx.on('media-tools/changed', refresh)

  const entry = ctx.webui.addEntry(
    {
      baseUrl: import.meta.url,
      source: '../client/index.ts',
      manifest: '../dist/manifest.json',
      routes: ['/settings/import-checks'],
    },
    {
      ...snapshot(),
      version,
      async forGrab(grabId) {
        return verify.forGrab(grabId) ?? null
      },
      async save(input) {
        const saved = verify.save({
          modes: input.modes,
          durationTolerance: input.durationTolerance,
        })
        refresh()
        return saved
      },
      test: (path, releaseName) => verify.test(path, releaseName),
    } satisfies VerifyData,
  )
}
