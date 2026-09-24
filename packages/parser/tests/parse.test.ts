import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { parse } from '../src'

interface Case {
  name: string
  [field: string]: unknown
}

function load(file: string): Case[] {
  return parseYaml(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
}

/** `group: null` in a fixture means "no group". */
function expected(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === null ? undefined : v]))
}

for (const file of ['handwritten.yml', 'real.yml']) {
  const cases = load(file)
  describe.skipIf(!cases.length)(file, () => {
    for (const { name, ...fields } of cases) {
      it(name || '(empty)', () => {
        const { spans: _, input: __, ...parsed } = parse(name)
        expect(parsed).toMatchObject(expected(fields))
      })
    }
  })
}
