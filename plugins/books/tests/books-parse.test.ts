import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { parseBook } from '../src/parse'

interface Case {
  name: string
  expect: Record<string, unknown>
}

/** The listed fields of a parse, with unset ones as `null` (how fixtures say "not set"). */
const pick = (parsed: object, fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(fields).map((k) => [k, (parsed as Record<string, unknown>)[k] ?? null]),
  )

for (const file of ['handwritten.yml', 'real.yml']) {
  const cases: Case[] = parseYaml(
    readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'),
  )
  describe(file, () => {
    for (const { name, expect: fields } of cases)
      it(name, () => expect(pick(parseBook(name), fields)).toMatchObject(fields))
  })
}
