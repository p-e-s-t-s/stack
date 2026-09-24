// Writes parser fixtures for a list of release names using the parser's current output.
// The output is a starting point: review every entry before committing
// (docs/phase-2.md §2.3). Usage:
//
//   tsx scripts/write-fixtures.ts names.json > packages/parser/tests/fixtures/real.yml

import { readFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { parse } from '../packages/parser/src'

const names: string[] = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))

const cases = names.map((name) => {
  const p = parse(name)
  const entry: Record<string, unknown> = { name, title: p.title }
  if (p.year) entry.year = p.year
  entry.kind = p.kind
  if (p.episodes) entry.episodes = p.episodes
  if (p.resolution) entry.resolution = p.resolution
  if (p.source) entry.source = p.source
  if (p.modifiers.length) entry.modifiers = p.modifiers
  const video = Object.fromEntries(
    Object.entries(p.video).filter(
      ([k, v]) => v !== undefined && !(k === 'hdr' && !(v as unknown[]).length),
    ),
  )
  if (Object.keys(video).length) entry.video = video
  const audio = Object.fromEntries(
    Object.entries(p.audio).filter(
      ([k, v]) => v !== undefined && !(k === 'codecs' && !(v as unknown[]).length),
    ),
  )
  if (Object.keys(audio).length) entry.audio = audio
  entry.languages = p.languages
  if (p.edition) entry.edition = p.edition
  if (p.streamingService) entry.streamingService = p.streamingService
  if (p.revision.version > 1 || p.revision.real) entry.revision = p.revision
  if (p.hardcodedSubs) entry.hardcodedSubs = p.hardcodedSubs
  if (p.flags.length) entry.flags = p.flags
  entry.group = p.group ?? null
  return entry
})

process.stdout.write(
  '# Real release names (xrel.to scene/P2P listings), reviewed by hand.\n' +
    '# Season, episode and group were also checked against xrel metadata.\n\n' +
    cases
      .map((entry) => '- ' + stringify(entry, { collectionStyle: 'flow', lineWidth: 0 }).trim())
      .join('\n') +
    '\n',
)
