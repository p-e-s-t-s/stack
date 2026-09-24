// Book import. Loaded only while the import plugin is enabled. Ebooks: each allowed format in
// the download becomes `Author/Book (Year)/Author - Book.ext`. Audiobooks: a single file is
// renamed the same way; several files keep their names and layout (CD1/, CD2/…) together in
// the book folder.

import { extname, join, relative } from 'node:path'
import type { Grab } from '@magpiejs/downloads'
import { profileRanks } from '@magpiejs/decision'
import { ImportError, type ImportResult, type ImportTools } from '@magpiejs/import'
import { type MediaFile, type MediaItem, renderName } from '@magpiejs/library'
import type { Context } from 'cordis'
import type { BookKind, BooksService, Follow } from './index'
import { matchBooks } from './match'
import { parseBook } from './parse'
import { authorNames } from './search'

export const EBOOK_EXTENSIONS = ['.epub', '.azw3', '.azw', '.mobi', '.pdf', '.cbz', '.cbr']
export const AUDIOBOOK_EXTENSIONS = ['.m4b', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus']

/** The quality of one file, from its extension (`.azw` counts as AZW3). */
export function fileQuality(kind: BookKind, path: string, fallback: string) {
  const ext = extname(path).slice(1).toLowerCase()
  if (kind === 'ebook') return `ebook-${ext === 'azw' ? 'azw3' : ext}`
  return ['m4b', 'mp3', 'flac'].includes(ext) ? `audiobook-${ext}` : fallback
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export default function bookImport(ctx: Context, books: BooksService) {
  /** The book a download is: the one it was grabbed for, else by its name. */
  function bookFor(follow: Follow, grab: Grab) {
    const [id] = books.grabBooks(grab.id)
    const all = books.books(follow.id)
    return (
      all.find((b) => b.id === id) ?? matchBooks(parseBook(grab.title), authorNames(follow), all)[0]
    )
  }

  async function importBook(
    item: MediaItem,
    grab: Grab,
    tools: ImportTools,
  ): Promise<ImportResult> {
    const follow = books.get(item.id)
    if (!follow) throw new ImportError('the author is no longer followed')
    const book = bookFor(follow, grab)
    if (!book) throw new ImportError(`${grab.title} is not one of ${follow.author.name}'s books`)
    const found = await tools.files()
    const profile = ctx.decision.profile(follow.profileId)
    const ranks = profile ? profileRanks(profile) : undefined
    const quality = (path: string) => fileQuality(follow.kind, path, grab.quality)

    // ebooks: the largest file of each format the profile allows (every format if none is)
    let files = found
    if (follow.kind === 'ebook') {
      const byFormat = new Map<string, (typeof found)[number]>()
      for (const f of found) if (!byFormat.has(quality(f.path))) byFormat.set(quality(f.path), f)
      const allowed = [...byFormat.values()].filter(
        (f) => ranks?.allowed.has(quality(f.path)) ?? true,
      )
      files = allowed.length ? allowed : [...byFormat.values()]
    }
    files = [...files].sort((a, b) => natural.compare(a.path, b.path))

    // replace what's there only with something better (or when chosen by hand)
    const existing = books.bookFiles(follow.id).get(book.id) ?? []
    const revision = parseBook(grab.title).revision
    if (existing.length && !grab.manual) {
      const best = existing.sort(
        (a, b) => (ranks?.rankOf(b.quality) ?? 0) - (ranks?.rankOf(a.quality) ?? 0),
      )[0]!
      if (
        !tools.isUpgrade({ quality: grab.quality, formatScore: grab.formatScore, revision }, best)
      )
        throw new ImportError(`not an upgrade over ${best.path}`)
    }

    const naming = ctx.library.naming(follow.kind)
    const values = {
      'Author Name': follow.author.name,
      'Book Title': book.title,
      'Release Year': book.year ?? undefined,
      Quality: ctx.decision.qualityName(grab.quality),
    }
    const folder = ctx.library.folderOf(follow)
    const bookDir = join(folder, renderName(naming.bookFolder!, values))
    const fileName = renderName(naming.bookFile!, values)
    const destOf = (path: string) =>
      files.length === 1 || follow.kind === 'ebook'
        ? join(bookDir, fileName + extname(path).toLowerCase())
        : join(bookDir, relative(grab.outputPath!, path))

    for (const old of existing) {
      await tools.recycle(join(folder, old.path))
      ctx.library.removeFile(old.id)
    }
    const placed: { path: string; method: string; row: MediaFile }[] = []
    for (const file of files) {
      const dest = destOf(file.path)
      const method = await tools.place(file.path, dest)
      const row = ctx.library.addFile({
        mediaId: follow.id,
        path: relative(folder, dest),
        size: file.size,
        quality: quality(file.path),
        formatScore: grab.formatScore,
        languages: parseBook(grab.title).languages,
        releaseName: grab.title,
        releaseGroup: parseBook(grab.title).group ?? null,
        revision,
      })
      placed.push({ path: dest, method, row })
    }
    books.linkFiles(
      placed.map((p) => p.row.id),
      book.id,
    )
    ctx.emit('books/changed', follow.id)
    return {
      path: placed.length === 1 ? placed[0]!.path : bookDir,
      method: placed[0]!.method,
      replaced: existing.map((f) => f.path).join(', ') || undefined,
      files: placed.length,
    }
  }

  ctx.import.register('ebook', importBook, { extensions: EBOOK_EXTENSIONS })
  ctx.import.register('audiobook', importBook, { extensions: AUDIOBOOK_EXTENSIONS })
}
