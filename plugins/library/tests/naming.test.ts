import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import { Context } from 'cordis'
import { expect, it } from 'vitest'
import LibraryService, { renderName } from '../src'

const scheme = (tokens: string[]) => ({
  templates: { file: { label: 'File', default: '{Token}' } },
  tokens,
})

it('renders tokens case-insensitively', () => {
  expect(renderName('{Title} ({Year})', { Title: 'Show', Year: 2020 })).toBe('Show (2020)')
  // a template can be hand-typed in any case and still resolve
  expect(renderName('{title} ({year})', { Title: 'Show', Year: 2020 })).toBe('Show (2020)')
  expect(renderName('{season:00}x{episode:00}', { season: 1, episode: 2 })).toBe('01x02')
})

it('rejects a naming scheme whose tokens differ only by case', async () => {
  const ctx = new Context()
  await ctx.plugin(DatabaseService, { path: ':memory:' })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  // `Disc` and `disc:0` resolve to the same token in renderName, so registering both is a
  // plugin bug (this is what shipped, briefly, for the music plugin's track naming)
  expect(() => ctx.library.registerNaming('movie', scheme(['Disc', 'disc:0']))).toThrow(
    /differ only by case/,
  )
  // tokens that don't collide once padding is stripped are fine
  expect(() => ctx.library.registerNaming('movie', scheme(['Disc Prefix', 'disc:0']))).not.toThrow()
})
