// OPML, the format podcast apps use to move subscriptions between each other.

import { XMLParser } from 'fast-xml-parser'

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )

export function toOpml(podcasts: { title: string; feedUrl: string }[], now = new Date()) {
  const outlines = podcasts
    .map(
      (p) =>
        `    <outline type="rss" text="${escape(p.title)}" title="${escape(p.title)}" xmlUrl="${escape(p.feedUrl)}"/>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Magpie podcasts</title>
    <dateCreated>${now.toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`
}

/** Feed URLs in an OPML file, at any nesting depth. */
export function parseOpml(xml: string): { title?: string; feedUrl: string }[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)
  const found: { title?: string; feedUrl: string }[] = []
  const walk = (node: any) => {
    for (const outline of [node?.outline ?? []].flat()) {
      const url = outline['@_xmlUrl']
      if (url) found.push({ title: outline['@_title'] ?? outline['@_text'], feedUrl: url })
      walk(outline)
    }
  }
  walk(doc?.opml?.body)
  if (!doc?.opml) throw new Error('not an OPML file')
  return found
}
