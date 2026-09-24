// Torrent helpers: info hash from a .torrent file or a magnet link. Used so Magpie knows the
// hash of what it sent to a client, and can find it in the client's list afterwards.

import { createHash } from 'node:crypto'

/** Byte range of the bencoded `info` dictionary inside a .torrent file. */
function infoRange(data: Uint8Array): [number, number] | undefined {
  let i = 0
  const byte = () => data[i]!
  const readInt = (end: number) => {
    let n = 0
    for (; byte() !== end; i++) n = n * 10 + (byte() - 48)
    i++
    return n
  }
  const skip = (): void => {
    const c = byte()
    if (c === 0x69 /* i */) {
      while (byte() !== 0x65) i++
      i++
    } else if (c === 0x6c /* l */ || c === 0x64 /* d */) {
      i++
      while (byte() !== 0x65 /* e */) skip()
      i++
    } else if (c >= 0x30 && c <= 0x39) {
      const len = readInt(0x3a /* : */)
      i += len
    } else {
      throw new Error('invalid torrent file')
    }
  }
  if (byte() !== 0x64) throw new Error('invalid torrent file')
  i++
  while (i < data.length && byte() !== 0x65) {
    const len = readInt(0x3a)
    const key = Buffer.from(data.subarray(i, i + len)).toString('latin1')
    i += len
    const start = i
    skip()
    if (key === 'info') return [start, i]
  }
}

export function infoHashOf(torrent: Uint8Array) {
  const range = infoRange(torrent)
  if (!range) throw new Error('torrent file has no info dictionary')
  return createHash('sha1').update(torrent.subarray(range[0], range[1])).digest('hex')
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function magnetHash(uri: string) {
  const m = /xt=urn:btih:([a-z0-9]+)/i.exec(uri)
  if (!m) return
  const hash = m[1]!
  if (hash.length === 40) return hash.toLowerCase()
  if (hash.length !== 32) return
  // base32 → hex
  let bits = ''
  for (const c of hash.toUpperCase()) bits += BASE32.indexOf(c).toString(2).padStart(5, '0')
  return bits
    .match(/.{4}/g)!
    .map((b) => parseInt(b, 2).toString(16))
    .join('')
}
