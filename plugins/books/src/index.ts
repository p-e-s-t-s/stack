// @magpiejs/books: ebooks and audiobooks. Authors are library items — one per format they're
// followed in — and their books are the units, like series and episodes.

declare module '@magpiejs/types' {
  interface MediaKinds {
    ebook: true
    audiobook: true
  }
}

export {}
