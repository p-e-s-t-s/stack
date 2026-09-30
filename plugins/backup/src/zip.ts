// A minimal zip writer and reader (deflate, no encryption, no zip64): enough for a backup
// holding a handful of files, and readable by any unzip tool. Entries are kept in memory.

import { crc32, deflateRaw, inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const deflate = promisify(deflateRaw)
const inflate = promisify(inflateRaw)

const LIMIT = 0xffff_ffff

export interface ZipEntry {
  name: string
  data: Buffer
  /** Modification time; defaults to now. */
  date?: Date
}

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day =
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  return { time, day }
}

export async function writeZip(entries: ZipEntry[]): Promise<Buffer> {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    if (entry.data.length >= LIMIT) throw new Error(`${entry.name} is too large for a zip file`)
    const name = Buffer.from(entry.name, 'utf8')
    const packed = await deflate(entry.data)
    const crc = crc32(entry.data)
    const { time, day } = dosTime(entry.date ?? new Date())

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, packed)

    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(20, 4) // version made by
    local.copy(head, 6, 4, 30) // needed, flags, method, time, date, crc, sizes, name length
    head.writeUInt32LE(offset, 42)
    central.push(head, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

/** The names in a zip and a function that unpacks one of them, checking its CRC. */
export function readZip(zip: Buffer) {
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('not a zip file')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<
    string,
    { method: number; crc: number; size: number; packed: number; offset: number }
  >()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('damaged zip directory')
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    files.set(zip.toString('utf8', at + 46, at + 46 + nameLength), {
      method: zip.readUInt16LE(at + 10),
      crc: zip.readUInt32LE(at + 16),
      packed: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
    })
    at += 46 + nameLength + extra
  }
  return {
    names: [...files.keys()],
    async read(name: string): Promise<Buffer> {
      const f = files.get(name)
      if (!f) throw new Error(`${name} is not in the zip`)
      if (zip.readUInt32LE(f.offset) !== 0x04034b50) throw new Error('damaged zip entry')
      const start =
        f.offset + 30 + zip.readUInt16LE(f.offset + 26) + zip.readUInt16LE(f.offset + 28)
      const raw = zip.subarray(start, start + f.packed)
      const data =
        f.method === 0 ? Buffer.from(raw) : f.method === 8 ? await inflate(raw) : undefined
      if (!data) throw new Error(`${name} uses an unsupported compression method`)
      if (data.length !== f.size || crc32(data) !== f.crc) throw new Error(`${name} is damaged`)
      return data
    },
  }
}
