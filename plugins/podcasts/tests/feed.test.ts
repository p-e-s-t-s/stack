import { expect, it } from 'vitest'
import { parseDuration, parseFeed } from '../src/feed'

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>Test Cast</title>
  <itunes:author>Ann</itunes:author>
  <itunes:image href="https://x/cover.jpg"/>
  <item>
    <title>Episode 2</title>
    <guid isPermaLink="false">0042</guid>
    <pubDate>Tue, 22 Sep 2026 10:00:00 +0000</pubDate>
    <enclosure url="https://x/2.mp3" type="audio/mpeg" length="1000"/>
    <itunes:duration>1:02:03</itunes:duration>
    <itunes:season>1</itunes:season><itunes:episode>2</itunes:episode>
  </item>
  <item>
    <title>Announcement without audio</title>
    <guid>news</guid>
  </item>
  <item>
    <title>Episode 1</title>
    <pubDate>Tue, 15 Sep 2026 10:00:00 +0000</pubDate>
    <enclosure url="https://x/1.mp3" type="audio/mpeg"/>
    <itunes:duration>45:10</itunes:duration>
  </item>
</channel>
</rss>`

it('reads a podcast feed', () => {
  const feed = parseFeed(FEED)
  expect(feed).toMatchObject({ title: 'Test Cast', author: 'Ann', imageUrl: 'https://x/cover.jpg' })
  expect(feed.episodes).toEqual([
    {
      guid: '0042', // kept as written, not read as a number
      title: 'Episode 2',
      publishedAt: '2026-09-22T10:00:00.000Z',
      enclosure: { url: 'https://x/2.mp3', type: 'audio/mpeg', length: 1000 },
      durationSeconds: 3723,
      season: 1,
      number: 2,
    },
    // no guid: the media URL identifies it
    {
      guid: 'https://x/1.mp3',
      title: 'Episode 1',
      publishedAt: '2026-09-15T10:00:00.000Z',
      enclosure: { url: 'https://x/1.mp3', type: 'audio/mpeg' },
      durationSeconds: 2710,
    },
  ])
  expect([parseDuration('3600'), parseDuration('bad'), parseDuration(undefined)]).toEqual([
    3600,
    undefined,
    undefined,
  ])
})
