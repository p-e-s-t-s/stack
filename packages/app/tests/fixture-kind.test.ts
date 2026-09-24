// Phase 4.5 exit (docs/phase-4.5.md §4): a kind of media defined entirely in this file —
// "notes", plain text files — goes search → grab → import → calendar through the real
// indexers, Torznab, decision, downloads, import, library and calendar plugins, without any
// of them knowing about it.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import CalendarService, { entryState } from '@magpiejs/calendar'
import DatabaseService from '@magpiejs/database'
import DecisionService, { type BaseParsed, profileItems } from '@magpiejs/decision'
import DownloadsService, { grabs } from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import * as torznab from '@magpiejs/indexer-torznab'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService, { renderName } from '@magpiejs/library'
import { Context } from 'cordis'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'

declare module '@magpiejs/types' {
  interface MediaKinds {
    note: true
  }
}

// ---- the whole "notes" kind

interface ParsedNote extends BaseParsed {
  author: string
  stage?: 'draft' | 'final'
}

function parseNote(title: string): ParsedNote {
  // `Author - Title [FINAL]`
  const m = /^(.+?) - (.+?)(?: \[(draft|final)\])?$/i.exec(title.trim())
  return {
    input: title,
    title: m?.[2] ?? title,
    author: m?.[1] ?? '',
    kind: 'note',
    stage: m?.[3]?.toLowerCase() as ParsedNote['stage'],
    revision: { version: 1, real: 0, proper: false, repack: false },
    languages: ['en'],
    flags: [],
  }
}

function notes(ctx: Context) {
  ctx.library.registerKind({ id: 'note', label: 'Notes' })
  ctx.library.registerNaming('note', {
    templates: { noteFile: { label: 'Note file', default: '{Author} - {Title} [{Quality}]' } },
    tokens: ['Author', 'Title', 'Quality'],
  })
  ctx.decision.family<ParsedNote>({
    id: 'text',
    label: 'Text',
    qualities: [
      { id: 'text-draft', name: 'Draft' },
      { id: 'text-final', name: 'Final' },
    ],
    parse: parseNote,
    qualityOf: (p) => (p.stage ? `text-${p.stage}` : 'text-unknown'),
    sizeRule: 'none',
    defaultProfiles: [
      {
        name: 'Any text',
        items: profileItems(['text-draft', 'text-final'], ['text-draft', 'text-final']),
        cutoff: 'text-final',
      },
    ],
  })
  ctx.indexers.searchType('note', {
    mode: 'book',
    fields: ['author', 'title'],
    defaultCategories: [7000],
  })
  ctx.import.register(
    'note',
    async (item, grab, tools) => {
      const [file] = await tools.files()
      const folder = ctx.library.folderOf(item)
      const name = renderName(ctx.library.naming('note').noteFile!, {
        Author: parseNote(grab.title).author,
        Title: item.title,
        Quality: ctx.decision.qualityName(grab.quality),
      })
      const dest = join(folder, name + extname(file!.path))
      const method = await tools.place(file!.path, dest)
      ctx.library.addFile({
        mediaId: item.id,
        path: relative(folder, dest),
        size: file!.size,
        quality: grab.quality,
        formatScore: grab.formatScore,
        languages: ['en'],
        releaseName: grab.title,
        releaseGroup: null,
        revision: parseNote(grab.title).revision,
      })
      return { path: dest, method }
    },
    { extensions: ['.txt'] },
  )
  ctx.calendar.source('note', (from, to, now) =>
    ctx.library
      .list('note')
      .map((item) => ({ item, date: `${item.year}-01-01` }))
      .filter(({ date }) => date >= from && date <= to)
      .map(({ item, date }) => ({
        uid: `note-${item.id}`,
        date,
        kind: 'note' as const,
        mediaId: item.id,
        link: `/notes/${item.id}`,
        title: item.title,
        subtitle: 'Published',
        state: entryState(
          date,
          { hasFile: ctx.library.files(item.id).length > 0, monitored: item.monitored },
          now,
        ),
      })),
  )
}

// ---- a Torznab indexer that offers book search

let server: Server
let base: string
const requests: URLSearchParams[] = []
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    res.setHeader('content-type', 'application/xml')
    if (url.searchParams.get('t') === 'caps') {
      return res.end(`<caps><searching><search available="yes" supportedParams="q"/>
        <book-search available="yes" supportedParams="q,author,title"/></searching>
        <categories><category id="7000" name="Books"/></categories></caps>`)
    }
    requests.push(url.searchParams)
    const item = (title: string, hash: string) =>
      `<item><title>${title}</title><guid>${title}</guid>
        <link>magnet:?xt=urn:btih:${hash}</link><torznab:attr name="seeders" value="5"/></item>`
    res.end(`<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
      ${item('Ann - Field Notes [draft]', 'a'.repeat(40))}
      ${item('Ann - Field Notes [final]', 'b'.repeat(40))}
      ${item('Bob - Other Notes [final]', 'c'.repeat(40))}
    </channel></rss>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

it('runs a kind defined outside the core from search to import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-fixture-kind-'))
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(ImportService)
  await ctx.plugin(CalendarService)
  await ctx.plugin(torznab, { name: 'Books', url: `${base}/api` } as unknown as torznab.Config)
  await ctx.plugin({
    inject: ['library', 'decision', 'indexers', 'import', 'calendar'],
    apply: notes,
  })
  ctx.downloads.register(
    {
      id: 'client',
      protocol: 'torrent',
      add: async (payload) => (payload as { hash: string }).hash,
      list: async () => [],
      remove: async () => {},
      test: async () => ({ ok: true }),
    },
    { name: 'Client', priority: 1, category: 'magpie' },
  )

  // the library item, with a profile of the kind's family
  const profile = ctx.decision.profiles('text')[0]!
  const item = ctx.library.add({
    kind: 'note',
    title: 'Field Notes',
    year: new Date().getFullYear(),
    externalIds: {},
    primaryProvider: 'none',
    profileId: profile.id,
    rootFolderId: ctx.library.addRootFolder(join(dir, 'notes'), 'note').id,
    folder: 'Field Notes',
  })

  // search: book search mode with the kind's fields and categories
  const { releases } = await ctx.indexers.search(
    { kind: 'note', term: 'Field Notes', fields: { author: 'Ann', title: 'Field Notes' } },
    'automatic',
  )
  expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({
    t: 'book',
    author: 'Ann',
    title: 'Field Notes',
    cat: '7000',
  })

  // decide with the text family: the final version wins
  const evaluate = ctx.decision.evaluator({ kind: 'note', mediaId: item.id, profileId: profile.id })
  const decisions = releases
    .filter((r) => parseNote(r.title).title === item.title)
    .map((info) => ({ info, decision: evaluate({ info }) }))
    .sort((a, b) => b.decision.rank[0]! - a.decision.rank[0]!)
  expect(decisions.map((d) => [d.info.title, d.decision.accepted, d.decision.quality])).toEqual([
    ['Ann - Field Notes [final]', true, 'text-final'],
    ['Ann - Field Notes [draft]', true, 'text-draft'],
  ])

  // grab, then the client finishes it
  const best = decisions[0]!
  const grab = await ctx.downloads.grab(item.id, best.info, {
    quality: best.decision.quality,
    formatScore: best.decision.formatScore,
  })
  const out = join(dir, 'downloads', grab.title)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'notes.txt'), 'hello')
  writeFileSync(join(out, 'cover.jpg'), 'x')
  ctx.downloads.db
    .update(grabs)
    .set({ state: 'import_pending', outputPath: out })
    .where(eq(grabs.id, grab.id))
    .run()

  // import with the kind's importer, extensions and naming
  await ctx.import.importGrab(grab.id)
  expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
  expect(readdirSync(join(dir, 'notes', 'Field Notes'))).toEqual(['Ann - Field Notes [Final].txt'])

  // and it's on the calendar
  const year = new Date().getFullYear()
  expect(ctx.calendar.entries(`${year}-01-01`, `${year}-12-31`)).toMatchObject([
    { kind: 'note', title: 'Field Notes', state: 'downloaded', link: `/notes/${item.id}` },
  ])
  rmSync(dir, { recursive: true, force: true })
})
