// Phase 4.5 exit (docs/phase-4.5.md §4): a kind of media defined entirely in this file —
// "notes", plain text files — goes search → grab → import → calendar through the real
// indexers, Torznab, decision, downloads, import, library and calendar plugins, without any
// of them knowing about it.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { entryState } from '@magpiejs/calendar'
import { type BaseParsed, profileItems } from '@magpiejs/decision'
import * as torznab from '@magpiejs/indexer-torznab'
import { renderName } from '@magpiejs/library'
import {
  createTestContext,
  fakeDownloadClient,
  fakeTorznab,
  finishDownloads,
} from '@magpiejs/testing'
import type { Context } from 'cordis'
import { afterAll, expect, it } from 'vitest'

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

const fake = await fakeTorznab({
  caps: { book: ['q', 'author', 'title'], categories: [{ id: 7000, name: 'Books' }] },
  items: () => [
    { title: 'Ann - Field Notes [draft]', hash: 'a'.repeat(40), seeders: 5 },
    { title: 'Ann - Field Notes [final]', hash: 'b'.repeat(40), seeders: 5 },
    { title: 'Bob - Other Notes [final]', hash: 'c'.repeat(40), seeders: 5 },
  ],
})
afterAll(() => fake.close())

it('runs a kind defined outside the core from search to import', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-fixture-kind-'))
  const ctx = await createTestContext()
  await ctx.plugin(torznab, { name: 'Books', url: `${fake.url}/api` } as unknown as torznab.Config)
  await ctx.plugin({
    inject: ['library', 'decision', 'indexers', 'import', 'calendar'],
    apply: notes,
  })
  const client = fakeDownloadClient()
  ctx.downloads.register(client.client, { name: 'Client', priority: 1, category: 'magpie' })

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
  expect(Object.fromEntries(fake.requests.at(-1)!)).toMatchObject({
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

  // import with the kind's importer, extensions and naming
  await finishDownloads(ctx, {
    dir: join(dir, 'downloads'),
    files: () => ({ 'notes.txt': 'hello', 'cover.jpg': 'x' }),
  })
  expect(ctx.downloads.get(grab.id)!.state).toBe('imported')
  expect(readdirSync(join(dir, 'notes', 'Field Notes'))).toEqual(['Ann - Field Notes [Final].txt'])

  // and it's on the calendar
  const year = new Date().getFullYear()
  expect(ctx.calendar.entries(`${year}-01-01`, `${year}-12-31`)).toMatchObject([
    { kind: 'note', title: 'Field Notes', state: 'downloaded', link: `/notes/${item.id}` },
  ])
  rmSync(dir, { recursive: true, force: true })
})
