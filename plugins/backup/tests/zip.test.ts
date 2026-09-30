import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readZip, writeZip } from '../src/zip'

describe('zip', () => {
  it('round-trips entries, including empty and incompressible ones', async () => {
    const big = randomBytes(200_000)
    const zip = await writeZip([
      { name: 'a.txt', data: Buffer.from('hello hello hello') },
      { name: 'empty', data: Buffer.alloc(0) },
      { name: 'dir/ünï.bin', data: big },
    ])
    const read = readZip(zip)
    expect(read.names).toEqual(['a.txt', 'empty', 'dir/ünï.bin'])
    expect((await read.read('a.txt')).toString()).toBe('hello hello hello')
    expect((await read.read('empty')).length).toBe(0)
    expect(await read.read('dir/ünï.bin')).toEqual(big)
    await expect(read.read('nope')).rejects.toThrow('not in the zip')
  })

  it('notices a damaged entry and a file that is not a zip', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: Buffer.from('x'.repeat(1000)) }])
    zip[30 + 'a.txt'.length + 2] = zip[30 + 'a.txt'.length + 2]! ^ 0xff // inside the packed data
    const read = readZip(zip)
    await expect(read.read('a.txt')).rejects.toThrow()
    expect(() => readZip(Buffer.from('not a zip at all, just text'))).toThrow('not a zip')
  })

  it('makes files that other unzip tools accept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-zip-'))
    try {
      writeFileSync(
        join(dir, 'x.zip'),
        await writeZip([{ name: 'a.txt', data: Buffer.from('hi there') }]),
      )
      let out: string
      try {
        out = execFileSync('unzip', ['-p', join(dir, 'x.zip'), 'a.txt']).toString()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return // no unzip installed
        throw error
      }
      expect(out).toBe('hi there')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
