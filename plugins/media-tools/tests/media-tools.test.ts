import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import DatabaseService from '@magpiejs/database'
import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MediaTools from '../src'

let dir: string
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'magpie-tools-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function tool(name: string, script: string) {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
  return path
}

async function boot(db = ':memory:') {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: db })
  await ctx.plugin(MediaTools)
  return ctx
}

describe('media tools', () => {
  it('reports tools that are missing, without failing', async () => {
    const ctx = await boot()
    await ctx.mediaTools.save({ ffprobe: join(dir, 'nope'), ffmpeg: join(dir, 'nope2') })
    expect(ctx.mediaTools.status.ffprobe).toEqual({ ok: false, detail: 'not found' })
    expect(await ctx.mediaTools.available('ffprobe')).toBe(false)
  })

  it('checks the tools after a save, reports their version and announces changes', async () => {
    const ctx = await boot()
    const events: string[] = []
    ctx.on('media-tools/changed', () => void events.push('changed'))
    const ffprobe = tool('ffprobe', 'echo "ffprobe version 7.1.1 Copyright (c) 2007"')
    const status = await ctx.mediaTools.save({ ffprobe })
    expect(status.ffprobe).toEqual({ ok: true, version: '7.1.1', detail: 'available' })
    expect(ctx.mediaTools.path('ffprobe')).toBe(ffprobe)
    expect(await ctx.mediaTools.available('ffprobe')).toBe(true)
    expect(events.length).toBeGreaterThan(0)
  })

  it('uses the paths saved last, even when a check was already running', async () => {
    const ctx = await boot()
    const ffprobe = tool('ffprobe', 'echo "ffprobe version 6.0"')
    // the check started at startup is still in flight here
    const status = await ctx.mediaTools.save({ ffprobe })
    expect(status.ffprobe.version).toBe('6.0')
  })

  it('rejects empty or absurd paths and keeps the old ones', async () => {
    const ctx = await boot()
    await expect(ctx.mediaTools.save({ ffprobe: '  ' })).rejects.toThrow('ffprobe needs')
    await expect(ctx.mediaTools.save({ ffmpeg: 'a\0b' })).rejects.toThrow('ffmpeg needs')
    expect(ctx.mediaTools.settings()).toEqual({ ffprobe: 'ffprobe', ffmpeg: 'ffmpeg' })
  })

  it('keeps the saved paths across a restart', async () => {
    const db = join(dir, 'magpie.db')
    const first = await boot(db)
    await first.mediaTools.save({ ffprobe: '/opt/ffprobe' })
    const second = await boot(db)
    expect(second.mediaTools.path('ffprobe')).toBe('/opt/ffprobe')
  })

  it('adopts a path another plugin used to keep, only when nothing is saved yet', async () => {
    const ctx = await boot()
    await ctx.mediaTools.adopt('ffprobe', '/usr/local/bin/ffprobe')
    expect(ctx.mediaTools.path('ffprobe')).toBe('/usr/local/bin/ffprobe')
    await ctx.mediaTools.adopt('ffprobe', '/elsewhere/ffprobe')
    expect(ctx.mediaTools.path('ffprobe')).toBe('/usr/local/bin/ffprobe')
    const other = await boot()
    await other.mediaTools.adopt('ffprobe', 'ffprobe') // the default is not worth saving
    expect(other.mediaTools.settings().ffprobe).toBe('ffprobe')
  })
})
