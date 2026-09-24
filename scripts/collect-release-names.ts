// Collects real release names for parser fixtures (docs/phase-2.md §2.3).
//
// Source: xrel.to's public API (scene and P2P release listings: names and metadata only).
// Keeps English movie/TV releases and writes one JSON object per line with the metadata
// xrel knows (type, season, episode, group), which the corpus test checks the parser
// against. Usage:
//
//   tsx scripts/collect-release-names.ts [--pages 5] [--out packages/parser/tests/corpus/xrel.jsonl]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    pages: { type: 'string', default: '5' },
    out: { type: 'string', default: 'packages/parser/tests/corpus/xrel.jsonl' },
  },
})
const pages = Number(values.pages)
const API = 'https://api.xrel.to/v2'

export interface CorpusEntry {
  name: string
  type: 'movie' | 'tv'
  season?: number
  episode?: number
  group?: string
  sizeMb?: number
  source: 'scene' | 'p2p'
  category: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(path: string): Promise<any> {
  const response = await fetch(API + path)
  if (!response.ok) throw new Error(`${response.status} for ${path}`)
  const remaining = Number(response.headers.get('x-ratelimit-remaining') ?? 100)
  if (remaining < 50) throw new Error('xrel rate limit almost used up; try again next hour')
  await sleep(400)
  return response.json()
}

function toMb(size?: { number: number; unit: string }) {
  if (!size) return undefined
  return size.unit === 'GB' ? Math.round(size.number * 1024) : size.number
}

const entries = new Map<string, CorpusEntry>()
if (existsSync(values.out!)) {
  for (const line of readFileSync(values.out!, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as CorpusEntry
    entries.set(entry.name, entry)
  }
}
const before = entries.size

function addScene(item: any, category: string) {
  const type = item.ext_info?.type
  if (!item.flags?.english || (type !== 'movie' && type !== 'tv')) return
  entries.set(item.dirname, {
    name: item.dirname,
    type,
    season: item.tv_season || undefined,
    episode: item.tv_episode || undefined,
    group: item.group_name,
    sizeMb: toMb(item.size),
    source: 'scene',
    category,
  })
}

const sceneCategories = ['TVSERIES', 'TVSHOW', 'X264', 'X265', 'UHD', 'REMUX', 'ANIME', 'MOVIES']
for (let page = 1; page <= pages; page++) {
  const latest = await get(`/release/latest.json?per_page=100&page=${page}`)
  for (const item of latest.list) addScene(item, 'latest')
}
for (const category of sceneCategories) {
  for (let page = 1; page <= pages; page++) {
    const result = await get(
      `/release/browse_category.json?category_name=${category}&per_page=100&page=${page}`,
    )
    for (const item of result.list) addScene(item, category)
  }
}
for (let page = 1; page <= pages * 4; page++) {
  const result = await get(`/p2p/releases.json?per_page=100&page=${page}`)
  for (const item of result.list) {
    const type = item.category?.meta_cat
    if (item.main_lang !== 'english' || (type !== 'movie' && type !== 'tv')) continue
    entries.set(item.dirname, {
      name: item.dirname,
      type,
      group: item.group?.name,
      sizeMb: item.size_mb,
      source: 'p2p',
      category: item.category.sub_cat,
    })
  }
}

const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(values.out!, sorted.map((e) => JSON.stringify(e)).join('\n') + '\n')
console.log(`${sorted.length} release names (${sorted.length - before} new) in ${values.out}`)
