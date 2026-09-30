// @magpiejs/verify: sanity checks on finished downloads (docs/post-download-checks.md). Runs
// as an import guard, after the files are found and before anything is placed, so a
// rejection needs no cleanup: the download is deleted, the release blocklisted and the next
// best one searched for.

import type { Drizzle } from '@magpiejs/database'
import type { Grab } from '@magpiejs/downloads'
import { findFiles, type GuardInput, ImportRejected, VIDEO_EXTENSIONS } from '@magpiejs/import'
import type { MediaItem } from '@magpiejs/library'
import type {} from '@magpiejs/media-tools'
import { parse } from '@magpiejs/parser'
import { probe, run as runTool } from '@magpiejs/probe'
import { type Context, Service } from 'cordis'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import console_ from './console'
import { desc, eq } from 'drizzle-orm'
import {
  BUILT_IN,
  type CheckContext,
  type CheckFn,
  type CheckOptions,
  type ProbeOutcome,
  probeable,
} from './checks'
import * as schema from './schema'

export * from './checks'
export * from './schema'

declare module 'cordis' {
  interface Context {
    verify: VerifyService
  }
  interface Events {
    /** A download was checked. */
    'verify/checked'(result: schema.Result): void
  }
}

const KEY = 'policy'
/** Files probed per download; a season pack is sampled, not probed whole. */
const MAX_PROBED = 10

export interface Config {
  /** Replaceable in tests. */
  maxProbed: number
}

export interface CheckInfo {
  name: string
  label: string
  description: string
  mode: schema.Mode
  needsProbe: boolean
}

export interface Verdict {
  outcome: schema.Outcome
  findings: schema.Finding[]
  files: schema.Result['files']
}

/** Skipped, not failed: a check that cannot run says nothing about the download. */
const UNAVAILABLE = /timeout or invalid output|ENOENT|EACCES/

export class VerifyService extends Service {
  static inject = ['database', 'import', 'downloads', 'library', 'mediaTools']

  db!: Drizzle<typeof schema>
  /** Replaceable in tests. */
  probeFile: typeof probe = probe
  /** Decodes part of a file with ffmpeg; rejects when it finds errors. Replaceable in tests. */
  decodeFile = (
    binary: string,
    path: string,
    from: number,
    seconds: number,
    signal?: AbortSignal,
  ) =>
    runTool(
      binary,
      [
        '-v',
        'error',
        '-xerror',
        '-ss',
        String(from),
        '-t',
        String(seconds),
        '-i',
        path,
        '-f',
        'null',
        '-',
      ],
      signal,
      60_000,
    )
  now = () => Date.now()
  private checks = new Map<string, { fn: CheckFn; options: CheckOptions }>()
  private runtimes = new Set<(item: MediaItem) => number | undefined>()
  private policy_: schema.Policy = schema.DEFAULT_POLICY

  constructor(ctx: Context) {
    super(ctx, 'verify')
  }

  [Service.init]() {
    this.db = this.ctx.database.register({
      namespace: 'verify',
      schema,
      migrations: new URL('../migrations', import.meta.url),
    })
    const saved = this.db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get()
    this.policy_ = normalize(saved?.value)
    for (const { name, fn, options } of BUILT_IN) this.check(name, fn, options)
    this.ctx.inject(['webui'], (ctx) => void ctx.plugin(console_, this))
    this.ctx.import.guard(async (input) => {
      const verdict = await this.run(input)
      if (verdict.outcome !== 'rejected') return
      const reasons = verdict.findings.filter((f) => f.severity === 'reject').map((f) => f.reason)
      throw new ImportRejected(`failed checks: ${reasons.join('; ')}`, verdict.findings)
    })
  }

  /** Adds a check, for the caller's lifetime; other plugins use this for their own. */
  check(name: string, fn: CheckFn, options: CheckOptions = {}) {
    return this.ctx.effect(() => {
      this.checks.set(name, { fn, options })
      return () => this.checks.delete(name)
    }, `verify.check(${name})`)
  }

  /** Says how long an item should run, for the `duration` check. */
  runtime(fn: (item: MediaItem) => number | undefined) {
    return this.ctx.effect(() => {
      this.runtimes.add(fn)
      return () => this.runtimes.delete(fn)
    }, 'verify.runtime')
  }

  // ---- settings

  policy(): schema.Policy {
    return structuredClone(this.policy_)
  }

  list(): CheckInfo[] {
    return [...this.checks].map(([name, { options }]) => ({
      name,
      label: options.label ?? name,
      description: options.description ?? '',
      mode: this.modeOf(name),
      needsProbe: !!options.needsProbe,
    }))
  }

  modeOf(name: string): schema.Mode {
    return this.policy_.modes[name] ?? this.checks.get(name)?.options.mode ?? 'warn'
  }

  save(input: Partial<schema.Policy>) {
    const next = normalize({ ...this.policy_, ...input })
    const row = { key: KEY, value: next, updatedAt: this.now() }
    this.db
      .insert(schema.settings)
      .values(row)
      .onConflictDoUpdate({ target: schema.settings.key, set: row })
      .run()
    this.policy_ = next
    return this.policy()
  }

  // ---- results

  forGrab(grabId: number) {
    return this.db
      .select()
      .from(schema.results)
      .where(eq(schema.results.grabId, grabId))
      .orderBy(desc(schema.results.id))
      .get()
  }

  recent(limit = 50) {
    return this.db.select().from(schema.results).orderBy(desc(schema.results.id)).limit(limit).all()
  }

  // ---- running

  /**
   * Runs every check that is not off and records the outcome. Rejections of a manual grab
   * are warnings: the user chose this release.
   */
  async run(input: GuardInput, signal?: AbortSignal): Promise<Verdict> {
    const { grab } = input
    const verdict = await this.evaluate(input, signal)
    const { outcome, findings, files } = verdict
    const row = this.db
      .insert(schema.results)
      .values({
        grabId: grab.id,
        title: grab.title,
        files,
        findings,
        outcome,
        createdAt: this.now(),
      })
      .returning()
      .get()
    if (outcome !== 'passed')
      this.ctx.logger.info(
        '%s: %s (%s)',
        grab.title,
        outcome,
        findings.map((f) => f.reason).join('; '),
      )
    this.ctx.emit('verify/checked', row)
    return verdict
  }

  /** Runs the checks without recording anything. */
  async evaluate(input: GuardInput, signal?: AbortSignal): Promise<Verdict> {
    const { grab } = input
    const context = await this.context(input, signal)
    const findings: schema.Finding[] = []
    for (const [name, { fn, options }] of this.checks) {
      const mode = this.modeOf(name)
      if (mode === 'off') continue
      if (options.needsProbe && !context.probed.length) continue
      let problems
      try {
        problems = await fn(context)
      } catch (error) {
        // a broken check must not hold up imports
        this.ctx.logger.warn('check %s failed to run: %s', name, (error as Error).message)
        continue
      }
      for (const { reason, detail } of problems)
        findings.push({
          severity: mode === 'reject' && !grab.manual ? 'reject' : 'warn',
          reason,
          detail: detail === undefined ? { check: name } : { check: name, ...asObject(detail) },
        })
    }
    const outcome: schema.Outcome = findings.some((f) => f.severity === 'reject')
      ? 'rejected'
      : findings.length
        ? 'warned'
        : 'passed'
    const files = context.probed.map(({ path, size, result }) => ({
      path,
      size,
      facts: 'facts' in result ? result.facts : null,
    }))
    return { outcome, findings, files }
  }

  private async context(input: GuardInput, signal?: AbortSignal): Promise<CheckContext> {
    const { item, grab, files, outputPath } = input
    const parsed = parse(grab.title, { kind: item.kind === 'series' ? 'series' : 'movie' })
    const probed: CheckContext['probed'] = []
    if (await this.ctx.mediaTools.available('ffprobe')) {
      for (const file of files.filter((f) => probeable(f.path)).slice(0, MAX_PROBED)) {
        const result = await this.probeOne(file.path, signal)
        if (result) probed.push({ ...file, result })
      }
    }
    let runtimeMinutes: number | undefined
    for (const fn of this.runtimes) runtimeMinutes ??= fn(item)
    const decode =
      probed.length &&
      this.modeOf('decode') !== 'off' &&
      (await this.ctx.mediaTools.available('ffmpeg'))
        ? async (path: string, from: number, seconds: number) => {
            try {
              await this.decodeFile(this.ctx.mediaTools.path('ffmpeg'), path, from, seconds, signal)
              return { ok: true }
            } catch (error) {
              if (signal?.aborted) throw error
              // a timeout or a missing tool says nothing about the file
              return {
                ok: UNAVAILABLE.test(error instanceof Error ? error.message : String(error)),
              }
            }
          }
        : undefined
    return {
      item,
      grab,
      parsed,
      policy: this.policy_,
      outputPath,
      files,
      probed,
      runtimeMinutes,
      decode,
    }
  }

  /**
   * Where a file can be tried from the settings page: the library's folders and the folders
   * of recent downloads, so the page cannot be used to probe arbitrary paths on the server.
   */
  private allowedRoots() {
    const roots = this.ctx.library.rootFolders().map((r) => r.path)
    for (const grab of this.ctx.downloads.recent(100))
      if (grab.outputPath) roots.push(grab.outputPath)
    return roots
  }

  /** Runs the checks on a file or folder, as a download of `releaseName` would be. Not recorded. */
  async test(path: string, releaseName = '', signal?: AbortSignal): Promise<Verdict> {
    if (typeof path !== 'string' || !path.trim() || path.includes('\0'))
      throw new Error('enter a path')
    const target = await realpath(resolve(path)).catch(() => {
      throw new Error('that path does not exist')
    })
    const inside = await Promise.all(
      this.allowedRoots().map(async (root) => {
        const real = await realpath(root).catch(() => undefined)
        if (!real) return false
        const rel = relative(real, target)
        return rel === '' || !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      }),
    )
    if (!inside.some(Boolean))
      throw new Error('only files in a library folder or a recent download can be tested')
    const files = await findFiles(target, VIDEO_EXTENSIONS, { skipExtras: true })
    const title = releaseName.trim() || target.split(sep).pop() || 'test'
    // a stand-in download and item: the checks read only what they need of them
    const now = this.now()
    const grab = {
      id: 0,
      mediaId: 0,
      targetId: null,
      release: { guid: title, title, protocol: 'torrent', indexerId: '', downloadUrl: '' },
      title,
      quality: '',
      formatScore: 0,
      protocol: 'torrent',
      clientId: '',
      downloadId: '',
      state: 'import_pending',
      progress: 1,
      sizeBytes: null,
      etaSeconds: null,
      outputPath: target,
      error: null,
      manual: false,
      grabbedAt: now,
      updatedAt: now,
      lastProgressAt: now,
    } satisfies Grab
    const item = { id: 0, kind: 'movie', title } as MediaItem
    return this.evaluate({ item, grab, outputPath: target, files }, signal)
  }

  private async probeOne(path: string, signal?: AbortSignal): Promise<ProbeOutcome | undefined> {
    try {
      return { facts: await this.probeFile(path, this.ctx.mediaTools.path('ffprobe'), signal) }
    } catch (error) {
      if (signal?.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (UNAVAILABLE.test(message)) return
      return { error: message }
    }
  }
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }

function normalize(input?: Partial<schema.Policy>): schema.Policy {
  const modes: Record<string, schema.Mode> = {}
  for (const [name, mode] of Object.entries(input?.modes ?? {}))
    if (mode === 'off' || mode === 'warn' || mode === 'reject') modes[name] = mode
  const tolerance = Number(input?.durationTolerance)
  return {
    modes,
    durationTolerance:
      Number.isFinite(tolerance) && tolerance > 0 && tolerance < 1
        ? tolerance
        : schema.DEFAULT_POLICY.durationTolerance,
  }
}

export default VerifyService
