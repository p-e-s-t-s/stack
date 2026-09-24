// Which album a release is, and which track a file is. Releases are matched on words: the
// artist and the album title must both be in the name, and what's left over may only be
// edition words; files are matched to the track list by disc and track number, checked
// against the title and length, or by title alone.

import { foldedWords, WordCover } from '@magpiejs/parser'
import type { ParsedMusic, ParsedTrack } from './parse'

/** Words a release may add to an album's title. `live` isn't one: live albums are albums. */
const NOISE = new Set(
  foldedWords(
    `deluxe edition expanded remastered remaster reissue anniversary special limited bonus tracks
    track version original the ep lp single album web cd vinyl digital`,
  ),
)
const isYear = (w: string) => /^(?:19|20)\d{2}$/.test(w)

export interface AlbumCandidate {
  title: string
}

/** Whether a release is this album by this artist (any of the artist's names). */
export function matchAlbum(parsed: ParsedMusic, artists: string[], album: AlbumCandidate) {
  const name = new WordCover(parsed.name)
  const title = foldedWords(album.title)
  // a self-titled album needs the artist's name twice
  if (!title.length || !name.take(title)) return false
  if (!artists.some((a) => name.take(foldedWords(a)))) return false
  return name.rest().every((w) => NOISE.has(w) || isYear(w))
}

/** The albums a release could be, best match (longest title) first. */
export function matchAlbums<A extends AlbumCandidate>(
  parsed: ParsedMusic,
  artists: string[],
  albums: A[],
) {
  return albums
    .filter((a) => matchAlbum(parsed, artists, a))
    .sort((a, b) => foldedWords(b.title).length - foldedWords(a.title).length)
}

// ---- tracks

export interface TrackCandidate {
  id: number
  disc: number
  number: number
  title: string
  lengthMs?: number | null
}

/** How alike two titles are: shared words over the shorter title's words (0 to 1). */
export function titleSimilarity(a: string, b: string) {
  const x = foldedWords(a)
  const y = new Set(foldedWords(b))
  if (!x.length || !y.size) return 0
  const shared = x.filter((w) => y.has(w)).length
  return shared / Math.min(x.length, y.size)
}

/** Seconds a file's length may differ from the track's. */
const LENGTH_SLACK = 20

/**
 * The track a file is: by disc and number when the title (if any) agrees, else by title. Its
 * length, when known, must be close to the track's.
 */
export function matchTrack<T extends TrackCandidate>(
  file: ParsedTrack & { seconds?: number },
  tracks: T[],
  discs: number,
): T | undefined {
  const lengthOk = (t: TrackCandidate) =>
    file.seconds === undefined ||
    !t.lengthMs ||
    Math.abs(t.lengthMs / 1000 - file.seconds) <= LENGTH_SLACK
  const titleOk = (t: TrackCandidate) => !file.title || titleSimilarity(file.title, t.title) >= 0.5
  if (file.track !== undefined) {
    const disc = file.disc ?? (discs === 1 ? 1 : undefined)
    const numbered = tracks.find(
      (t) => t.number === file.track && (disc === undefined ? discs === 1 : t.disc === disc),
    )
    if (numbered && titleOk(numbered) && lengthOk(numbered)) return numbered
  }
  if (!file.title) return
  const byTitle = tracks
    .filter((t) => (file.disc === undefined || t.disc === file.disc) && lengthOk(t))
    .map((t) => ({ t, score: titleSimilarity(file.title!, t.title) }))
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score)
  return byTitle[0]?.t
}
