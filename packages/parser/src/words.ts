// Word-level matching of release names against known names, for kinds whose release names
// run parts together (books, music): the name must hold each known part as consecutive words,
// and callers decide what may be left over.

/**
 * Words for comparing names: no accents, case or punctuation, and German and Scandinavian
 * spellings folded together (`Kvarnström`, `Kvarnstroem`, `Kvarnstrom`; `Gård`, `Gaard`).
 */
export function foldedWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/aa/g, 'a'))
}

/** The words of a name, with the parts found in it so far marked as used. */
export class WordCover {
  readonly words: string[]
  private used: boolean[]

  constructor(text: string) {
    this.words = foldedWords(text)
    this.used = this.words.map(() => false)
  }

  /** Marks `needle` (folded words) as found, at its first unused position. */
  take(needle: string[]) {
    if (!needle.length) return false
    outer: for (let i = 0; i + needle.length <= this.words.length; i++) {
      for (let j = 0; j < needle.length; j++)
        if (this.used[i + j] || this.words[i + j] !== needle[j]) continue outer
      for (let j = 0; j < needle.length; j++) this.used[i + j] = true
      return true
    }
    return false
  }

  /** Words not taken. */
  rest() {
    return this.words.filter((_, i) => !this.used[i])
  }
}
