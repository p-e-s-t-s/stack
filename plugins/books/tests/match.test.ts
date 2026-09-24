import { expect, it } from 'vitest'
import { audiobookFamily, ebookFamily } from '../src/families'
import { matchBook, matchBooks } from '../src/match'
import { parseBook } from '../src/parse'

const match = (release: string, author: string, title: string, subtitle?: string) =>
  matchBook(parseBook(release), [author], { title, subtitle })

it('matches releases to books by author and title, in either order', () => {
  // scene names with the author run into the title, and folded spellings
  expect(
    match(
      'Ruth.Kvarnstrom.Jones.Systrarna.Pa.Sophiahemmet.2026.SWEDiSH.RETAiL.ePub.eBOOK-DECiPHER',
      'Ruth Kvarnström Jones',
      'Systrarna på Sophiahemmet',
    ),
  ).toBe(true)
  expect(
    match(
      'Stacia_Stark_-_A_Kingdom_This_Cursed_And_Empty_Svensk_Utgaava-AUDiOBOOK-WEB-SE-2026-CRAViNGS_iNT',
      'Stacia Stark',
      'A Kingdom This Cursed and Empty',
    ),
  ).toBe(true)
  expect(match('The Martian - Andy Weir [MP3]', 'Andy Weir', 'The Martian')).toBe(true)
  expect(
    match(
      'J.R.R.Tolkien.-.The.Hobbit.2012.RETAIL.EPUB.eBook-GRP',
      'J. R. R. Tolkien',
      'The Hobbit',
    ),
  ).toBe(true)
  expect(match('Tolkien - The Hobbit [EPUB]', 'J. R. R. Tolkien', 'The Hobbit')).toBe(true)
  // subtitle, series and edition words are fine
  expect(
    match(
      'Brandon Sanderson - Mistborn 01 - The Final Empire (Unabridged) [M4B]',
      'Brandon Sanderson',
      'The Final Empire',
    ),
  ).toBe(true)
  // co-written: the other author's name is in the author part
  expect(
    match(
      'Cherrie.Moraga.And.Gloria.Anzaldua.-.This.Bridge.Called.My.Back.Writings.By.Radical.Women.Of.Color.40th.Anniversary.Edition.2022.RETAIL.EPUB.eBook-CTO',
      'Cherríe Moraga',
      'This Bridge Called My Back',
      'Writings by Radical Women of Color',
    ),
  ).toBe(true)
  // another book whose title starts the same, or another author
  expect(match('Frank Herbert - Dune Messiah [EPUB]', 'Frank Herbert', 'Dune')).toBe(false)
  expect(match('Brian Herbert - Dune [EPUB]', 'Frank Herbert', 'Dune')).toBe(false)
  const books = [{ title: 'Dune' }, { title: 'Dune Messiah' }]
  expect(
    matchBooks(parseBook('Frank Herbert - Dune Messiah [EPUB]'), ['Frank Herbert'], books),
  ).toEqual([{ title: 'Dune Messiah' }])
})

it('rates releases by their best format, and keeps ebooks and audiobooks apart', () => {
  const mort = parseBook('Terry Pratchett - Mort (pdf, epub)')
  expect(ebookFamily.qualityOf(mort)).toBe('ebook-epub')
  expect(audiobookFamily.qualityOf(parseBook('Author_-_Title-AUDiOBOOK-WEB-SE-2026-GRP'))).toBe(
    'audiobook-mp3',
  )
  const rule = (family: typeof ebookFamily, name: string) =>
    Object.values(family.rules!).map((r) => r({ parsed: parseBook(name), formatScore: 0 } as never))
  expect(rule(ebookFamily, 'Andy Weir - The Martian [M4B]')).toContainEqual({
    reason: 'is an audiobook',
    permanent: true,
  })
  expect(rule(audiobookFamily, 'Stephen King - It (Abridged) [MP3]')).toContainEqual({
    reason: 'is abridged',
    permanent: true,
  })
})
