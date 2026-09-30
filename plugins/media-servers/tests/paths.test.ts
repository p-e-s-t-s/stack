import { describe, expect, it } from 'vitest'
import { mapPath, parseMappings } from '../src'

describe('mapPath', () => {
  it('leaves paths alone when there are no mappings', () => {
    expect(mapPath('/data/movies/A/a.mkv', [])).toBe('/data/movies/A/a.mkv')
  })

  it('maps whole folders only', () => {
    const maps = parseMappings('/data/Movies => /media/movies')
    expect(mapPath('/data/Movies/Alien (1979)/a.mkv', maps)).toBe(
      '/media/movies/Alien (1979)/a.mkv',
    )
    expect(mapPath('/data/MoviesExtra/a.mkv', maps)).toBeUndefined()
    expect(mapPath('/data/Movies', maps)).toBe('/media/movies')
  })

  it('takes the longest matching mapping', () => {
    const maps = parseMappings('/data => /a; /data/movies => /b')
    expect(mapPath('/data/movies/x.mkv', maps)).toBe('/b/x.mkv')
    expect(mapPath('/data/tv/x.mkv', maps)).toBe('/a/tv/x.mkv')
  })

  it('maps Windows paths to POSIX, ignoring case and separators', () => {
    const maps = parseMappings('D:\\Media\\Movies => /media/movies')
    expect(mapPath('d:/media/movies/Alien/a.mkv', maps)).toBe('/media/movies/Alien/a.mkv')
    expect(mapPath('D:\\Media\\MoviesExtra\\a.mkv', maps)).toBeUndefined()
  })

  it('maps POSIX paths to Windows with backslashes', () => {
    const maps = parseMappings('/data/movies => D:\\Media')
    expect(mapPath('/data/movies/Alien/a.mkv', maps)).toBe('D:\\Media\\Alien\\a.mkv')
    expect(mapPath('/data/movies', parseMappings('/data/movies => D:\\'))).toBe('D:\\')
  })

  it('matches case exactly for POSIX sources', () => {
    expect(mapPath('/data/movies/a.mkv', parseMappings('/Data => /x'))).toBeUndefined()
  })

  it('refuses traversal', () => {
    const maps = parseMappings('/data => /media')
    expect(() => mapPath('/data/../etc/passwd', maps)).toThrow('..')
    expect(() => parseMappings('/data/.. => /media')).toThrow('..')
  })
})

describe('parseMappings', () => {
  it('rejects malformed and duplicate mappings', () => {
    expect(() => parseMappings('/a')).toThrow('from => to')
    expect(() => parseMappings('/a => /b => /c')).toThrow('from => to')
    expect(() => parseMappings('/a => /b; /a/ => /c')).toThrow('more than once')
    expect(() => parseMappings('C:\\A => /b; c:/a => /c')).toThrow('more than once')
  })

  it('accepts an empty setting', () => {
    expect(parseMappings('')).toEqual([])
  })
})
