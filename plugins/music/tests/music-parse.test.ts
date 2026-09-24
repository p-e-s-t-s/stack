import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { parseMusic, parseTrackFile } from '../src/parse'

/** The listed fields of a parse, with unset ones as `null` (how fixtures say "not set"). */
const pick = (parsed: object, fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(fields).map((k) => [k, (parsed as Record<string, unknown>)[k] ?? null]),
  )

for (const file of ['handwritten.yml', 'real.yml']) {
  const cases: { name: string; expect: Record<string, unknown> }[] = parseYaml(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'),
  )
  describe(file, () => {
    for (const { name, expect: fields } of cases)
      it(name, () => expect(pick(parseMusic(name), fields)).toMatchObject(fields))
  })
}

it('reads disc, track number, artist and title from track file names', () => {
  const cases: [string, number, object][] = [
    ['01 - 15 Step.flac', 1, { track: 1, title: '15 Step' }],
    ['07. Reckoner.flac', 1, { track: 7, title: 'Reckoner' }],
    ['1-01 Airbag.mp3', 2, { disc: 1, track: 1, title: 'Airbag' }],
    [
      '203. Subterranean Homesick Alien.mp3',
      2,
      { disc: 2, track: 3, title: 'Subterranean Homesick Alien' },
    ],
    ['103 Song.mp3', 1, { track: 103, title: 'Song' }], // one disc: a three-digit number is the track
    ['CD2/03 Something.flac', 2, { disc: 2, track: 3, title: 'Something' }],
    ['Disc 1/05 Let Down.flac', 2, { disc: 1, track: 5, title: 'Let Down' }],
    ['Radiohead - 04 - Nude.mp3', 1, { track: 4, artist: 'Radiohead', title: 'Nude' }],
    ['05 Radiohead - All I Need.flac', 1, { track: 5, artist: 'Radiohead', title: 'All I Need' }],
    ['01-radiohead-15_step-grp.mp3', 1, { track: 1, artist: 'radiohead', title: '15 step' }],
    ['B2 - Side Two Song.flac', 1, { disc: 2, track: 2, title: 'Side Two Song' }],
    ['Track 7.mp3', 1, { track: 7 }],
    ['Weird Fishes.flac', 1, { title: 'Weird Fishes' }],
  ]
  for (const [path, discs, expected] of cases)
    expect(parseTrackFile(path, discs), path).toEqual(expected)
})
