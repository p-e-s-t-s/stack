import { describe, expect, it } from 'vitest'
import { addedTorrentId } from '../src/index'
const hash = '71754637fd29b4be433723a4a559086e2bc083dc'
describe('qBittorrent add responses', () => {
  it.each(['', 'Ok.', '  Ok.\n'])('accepts legacy success %j', (body) => {
    expect(addedTorrentId(body, hash)).toBe(hash)
  })
  it('accepts modern JSON success and returns the client ID', () => {
    const returned = 'a'.repeat(40)
    expect(
      addedTorrentId(
        JSON.stringify({
          success_count: 1,
          failure_count: 0,
          pending_count: 0,
          added_torrent_ids: [returned.toUpperCase()],
        }),
        hash,
      ),
    ).toBe(returned)
  })
  it('tracks a pending magnet using its known hash', () => {
    expect(
      addedTorrentId(
        JSON.stringify({
          success_count: 0,
          failure_count: 0,
          pending_count: 1,
          added_torrent_ids: [],
        }),
        hash,
      ),
    ).toBe(hash)
  })
  it.each([
    'Fails.',
    '{}',
    'null',
    '{bad json',
    JSON.stringify({ success_count: 0, failure_count: 1, pending_count: 0 }),
    JSON.stringify({ success_count: 0, failure_count: 0, pending_count: 0 }),
  ])('rejects failed or unrecognized responses %j', (body) => {
    expect(() => addedTorrentId(body, hash)).toThrow('did not accept the torrent')
  })
})
