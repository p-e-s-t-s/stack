// @magpiejs/list-imdb: a public IMDb list, read from its CSV export. IMDb has no official
// API, so this is best effort: a private list or a changed export format fails with an error
// and changes nothing.

import type {} from '@cordisjs/plugin-http'
import { type ListConfig, listConfig, listIdOf, settingsOf } from '@magpiejs/import-lists/config'
import type { ListEntry } from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'list-imdb'
export const inject = ['http', 'importLists']

export interface Config extends ListConfig {
  list: string
}

export const Config: z<Config> = z.object({
  list: z.string().required().description('The list id (ls…) or its address on imdb.com.'),
  ...listConfig,
  name: z.string().default('IMDb list').description('Name shown in Magpie.'),
})

export function listIdFrom(value: string) {
  const match = /\b(ls\d+)\b/.exec(value)
  if (!match) throw new Error('not an IMDb list id (it looks like ls012345678)')
  return match[1]!
}

/** Parses CSV with quoted fields (commas, doubled quotes and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) rows.push(row)
  return rows
}

const KINDS: Record<string, 'movie' | 'series'> = {
  movie: 'movie',
  'tv movie': 'movie',
  'tv series': 'series',
  'tv mini series': 'series',
}

/** Entries from an IMDb list export; other title types (shorts, episodes, people) are skipped. */
export function entriesFromCsv(text: string): ListEntry[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const column = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name)
  const [id, title, type, year] = ['const', 'title', 'title type', 'year'].map(column) as [
    number,
    number,
    number,
    number,
  ]
  if (id < 0 || title < 0 || type < 0)
    throw new Error('IMDb returned something that is not a list export (is the list public?)')
  const entries: ListEntry[] = []
  for (const row of rows) {
    const kind = KINDS[(row[type] ?? '').trim().toLowerCase()]
    const imdb = (row[id] ?? '').trim()
    if (!kind || !/^tt\d+$/.test(imdb) || !row[title]) continue
    entries.push({
      kind,
      title: row[title]!,
      year: year >= 0 ? Number(row[year]) || undefined : undefined,
      ids: { imdb },
    })
  }
  return entries
}

export function apply(ctx: Context, config: Config) {
  const list = listIdFrom(config.list)
  const download = () =>
    ctx.http.get<string>(`https://www.imdb.com/list/${list}/export`, {
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Magpie)' },
      timeout: 30_000,
    })
  ctx.importLists.register(
    {
      id: listIdOf(ctx, 'imdb', config.name),
      kinds: ['movie', 'series'],
      async fetch() {
        return entriesFromCsv(await download())
      },
      async test() {
        try {
          const count = entriesFromCsv(await download()).length
          return { ok: true, message: `Found the list (${count} titles)` }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    { name: config.name, settings: settingsOf(config) },
  )
}
