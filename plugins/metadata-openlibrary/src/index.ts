// @magpiejs/metadata-openlibrary: authors and their books from Open Library. It needs no key.
// Search finds authors by name, and by the title of a book they wrote.

import type {} from '@cordisjs/plugin-http'
import type {} from '@magpiejs/books'
import type {} from '@magpiejs/metadata'
import type {
  AuthorMetadata,
  BookMetadata,
  MetadataProvider,
  MetadataSearchResult,
} from '@magpiejs/types'
import type { Context } from 'cordis'
import z from 'schemastery'

export const name = 'metadata-openlibrary'
export const inject = ['http', 'metadata']

export interface Config {
  language: string
  baseUrl: string
  coversUrl: string
}

export const Config: z<Config> = z.object({
  language: z
    .string()
    .default('eng')
    .description(
      'Only list books published in this language (ISO 639-2 code: eng, ger, fre, spa…).',
    ),
  baseUrl: z.string().default('https://openlibrary.org').hidden(),
  coversUrl: z.string().default('https://covers.openlibrary.org').hidden(),
})

interface SearchAuthor {
  key: string
  name: string
  alternate_names?: string[]
  birth_date?: string
  top_work?: string
  work_count?: number
}

interface SearchWork {
  key: string
  title: string
  subtitle?: string
  first_publish_year?: number
  cover_i?: number
  language?: string[]
  edition_count?: number
  publish_date?: string[]
  author_key?: string[]
  author_name?: string[]
}

interface Author {
  name: string
  personal_name?: string
  alternate_names?: string[]
  bio?: string | { value: string }
  birth_date?: string
  photos?: number[]
}

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ')

/**
 * A full date from Open Library's free-form publish dates (`Aug 18, 2015`, `November 14th
 * 2017`, `2021-05-04`, `15.03.2023`). Year-only dates give nothing.
 */
export function parsePublishDate(value: string): string | undefined {
  const pad = (n: number) => String(n).padStart(2, '0')
  const make = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : undefined
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return make(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value)
  if (m) return make(+m[3]!, +m[2]!, +m[1]!)
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(value)
  if (m) return make(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!)
  m = /^(\d{1,2}) ([a-z]{3})[a-z]*\.? (\d{4})$/i.exec(value)
  if (m) return make(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!)
}

/** Summaries and study guides of a book, whose authors a title search would otherwise list. */
const COMPANION = /\b(?:summary|summaries|study guide|analysis|workbook|sparknotes|cliffsnotes)\b/i

const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{S}]+$/u

/** Whether a work belongs on the author's book list. */
export function isBook(work: SearchWork, authorId: string, language: string) {
  // anthologies list the author among others; their own books list them first
  if (work.author_key?.[0] !== authorId) return false
  if (!work.edition_count) return false
  // omnibus editions: "The Martian / Artemis / Project Hail Mary"
  if (work.title.includes(' / ')) return false
  if (work.language?.length) return work.language.includes(language)
  // unknown language: keep titles written in the Latin alphabet for Latin-script languages
  return LATIN.test(work.title)
}

export function apply(ctx: Context, config: Config) {
  const get = <T>(path: string, params: Record<string, string | number> = {}) =>
    ctx.http.get<T>(`${config.baseUrl}${path}`, {
      params,
      responseType: 'json',
      timeout: 30_000,
      headers: { 'User-Agent': 'Magpie (https://github.com/p-e-s-t-s/stack)' },
    })

  const id = (key: string) => key.split('/').pop()!
  const cover = (coverId?: number) =>
    coverId && coverId > 0 ? `${config.coversUrl}/b/id/${coverId}-L.jpg` : undefined
  const photo = (authorId: string, photos?: number[]) => {
    const photoId = photos?.find((p) => p > 0)
    return photoId
      ? `${config.coversUrl}/a/id/${photoId}-L.jpg`
      : `${config.coversUrl}/a/olid/${authorId}-L.jpg?default=false`
  }

  const provider: MetadataProvider = {
    id: 'openlibrary',
    kinds: ['ebook', 'audiobook'],

    // authors by name, then the authors of books with that title
    async search(query) {
      const [authors, works] = await Promise.all([
        get<{ docs: SearchAuthor[] }>('/search/authors.json', { q: query.term, limit: 10 }),
        get<{ docs: SearchWork[] }>('/search.json', {
          title: query.term,
          fields: 'key,title,author_key,author_name,first_publish_year',
          limit: 10,
        }),
      ])
      const results = new Map<string, MetadataSearchResult>()
      for (const a of authors.docs) {
        if (!a.work_count) continue
        results.set(a.key, {
          kind: query.kind ?? 'ebook',
          title: a.name,
          ids: { openlibrary: a.key },
          posterUrl: photo(a.key),
          overview: a.top_work && `Known for ${a.top_work} · ${a.work_count} works`,
        })
      }
      for (const w of works.docs) {
        const authorId = w.author_key?.[0]
        if (!authorId || results.has(authorId) || COMPANION.test(w.title)) continue
        results.set(authorId, {
          kind: query.kind ?? 'ebook',
          title: w.author_name?.[0] ?? authorId,
          ids: { openlibrary: authorId },
          posterUrl: photo(authorId),
          overview: `Author of ${w.title}${w.first_publish_year ? ` (${w.first_publish_year})` : ''}`,
        })
      }
      return [...results.values()]
    },

    async getAuthor(authorId) {
      const a = await get<Author>(`/authors/${authorId}.json`)
      const bio = typeof a.bio === 'string' ? a.bio : a.bio?.value
      const names = new Set([a.personal_name, ...(a.alternate_names ?? [])].filter(Boolean))
      names.delete(a.name)
      return {
        kind: 'ebook',
        title: a.name,
        ids: { openlibrary: authorId },
        overview: bio?.trim(),
        posterUrl: photo(authorId, a.photos),
        alternateNames: [...names] as string[],
        birthDate: a.birth_date,
      } satisfies AuthorMetadata
    },

    async getBooks(authorId) {
      const books: BookMetadata[] = []
      const limit = 500
      for (let page = 1; page <= 10; page++) {
        const { docs, numFound } = await get<{ docs: SearchWork[]; numFound: number }>(
          '/search.json',
          {
            author_key: authorId,
            fields:
              'key,title,subtitle,first_publish_year,cover_i,language,edition_count,publish_date,author_key',
            sort: 'editions',
            limit,
            page,
          },
        )
        for (const w of docs) {
          if (!isBook(w, authorId, config.language)) continue
          // the earliest full date in the year it first came out (1 January is usually a
          // placeholder for "some time that year")
          const releaseDate = (w.publish_date ?? [])
            .map(parsePublishDate)
            .filter(
              (d): d is string =>
                !!d && d.startsWith(`${w.first_publish_year}-`) && !d.endsWith('-01-01'),
            )
            .sort()[0]
          books.push({
            ids: { openlibrary: id(w.key) },
            title: w.title,
            subtitle: w.subtitle,
            year: w.first_publish_year,
            releaseDate,
            coverUrl: cover(w.cover_i),
            editions: w.edition_count,
            languages: w.language,
          })
        }
        if (page * limit >= numFound) break
      }
      return books
    },
  }
  ctx.metadata.register(provider)
}
