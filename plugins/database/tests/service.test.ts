import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DatabaseService from '../src'
import * as librarySchema from './fixtures/library/schema'
import * as subtitlesSchema from './fixtures/subtitles/schema'

const libraryMigrations = new URL('./fixtures/library/migrations', import.meta.url)
const subtitlesMigrations = new URL('./fixtures/subtitles/migrations', import.meta.url)

let dir: string
let ctx: Context
const handles: Record<string, any> = {}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-svc-'))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir + '/').href
  await ctx.plugin(DatabaseService, { path: 'data/magpie.db', backupRetention: 3 })
})

afterEach(async () => {
  await ctx.registry.delete(DatabaseService)
  rmSync(dir, { recursive: true, force: true })
})

const library = {
  name: 'library',
  inject: ['database'],
  apply(ctx: Context) {
    const db = ctx.database.register({
      namespace: 'library',
      schema: librarySchema,
      migrations: libraryMigrations,
    })
    handles.library = db
  },
}

const subtitles = {
  name: 'subtitles',
  inject: ['database'],
  apply(ctx: Context) {
    const db = ctx.database.register({
      namespace: 'subtitles',
      schema: subtitlesSchema,
      migrations: subtitlesMigrations,
    })
    handles.subtitles = db
  },
}

describe('DatabaseService', () => {
  it('creates the file under the config directory and backs up before migrating', async () => {
    await ctx.plugin(library)
    expect(existsSync(join(dir, 'data/magpie.db'))).toBe(true)
    const backups = readdirSync(join(dir, 'data/backups'))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/library-0002_title_nullable\.db$/)
  })

  it('gives each plugin a typed drizzle instance and cascades deletes across plugins', async () => {
    await ctx.plugin(library)
    await ctx.plugin(subtitles)
    const lib = handles.library
    const subs = handles.subtitles
    lib.insert(librarySchema.media).values({ id: 1, title: 'Alien' }).run()
    subs.insert(subtitlesSchema.assignments).values({ mediaId: 1, profile: 'en' }).run()
    expect(subs.select().from(subtitlesSchema.assignments).all()).toHaveLength(1)
    lib.delete(librarySchema.media).where(eq(librarySchema.media.id, 1)).run()
    expect(subs.select().from(subtitlesSchema.assignments).all()).toHaveLength(0)
  })

  it('tracks active plugins and only drops data of disabled ones', async () => {
    const fiber = await ctx.plugin(library)
    const subsFiber = await ctx.plugin(subtitles)
    expect(ctx.database.status().map((s) => [s.namespace, s.active])).toEqual([
      ['library', 1],
      ['subtitles', 1],
    ])
    expect(() => ctx.database.dropNamespace('subtitles')).toThrow(/in use/)

    await subsFiber.dispose()
    expect(ctx.database.status().find((s) => s.namespace === 'subtitles')?.active).toBe(0)
    expect(ctx.database.dropNamespace('subtitles')).toEqual(['subtitles_assignments'])
    expect(ctx.database.status().map((s) => s.namespace)).toEqual(['library'])

    // re-enabling recreates its tables from scratch
    await ctx.plugin(subtitles)
    expect(ctx.database.status().map((s) => s.namespace)).toEqual(['library', 'subtitles'])
    await fiber.dispose()
  })

  it('fails only the plugin whose schema declares a foreign table', async () => {
    const rogue = {
      name: 'rogue',
      inject: ['database'],
      apply(ctx: Context) {
        ctx.database.register({ namespace: 'rogue', schema: librarySchema, migrations: [] })
      },
    }
    await expect(ctx.plugin(rogue)).rejects.toThrow(/doesn't own/)
    await ctx.plugin(library)
    expect(ctx.database.status().map((s) => s.namespace)).toEqual(['library'])
  })

  it('prunes old backups', async () => {
    for (let i = 0; i < 5; i++) ctx.database.backup(`manual${i}`)
    expect(readdirSync(join(dir, 'data/backups'))).toHaveLength(3)
  })
})
