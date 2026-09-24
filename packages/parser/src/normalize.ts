/**
 * Canonical form of a title for matching releases to library items:
 * `The Lord of the Rings: The Return of the King` → `lord of the rings the return of the king`.
 */
export function normalizeTitle(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '')
}
