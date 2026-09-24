import type { ParsedRelease } from '@magpiejs/parser'

/** All qualities, worst to best. A release maps to exactly one. */
export const QUALITIES = [
  'unknown',
  'cam',
  'telesync',
  'telecine',
  'workprint',
  'screener',
  'regional',
  'sdtv',
  'dvd',
  'webrip-480p',
  'webdl-480p',
  'bluray-480p',
  'bluray-576p',
  'hdtv-720p',
  'webrip-720p',
  'webdl-720p',
  'bluray-720p',
  'hdtv-1080p',
  'webrip-1080p',
  'webdl-1080p',
  'bluray-1080p',
  'remux-1080p',
  'hdtv-2160p',
  'webrip-2160p',
  'webdl-2160p',
  'bluray-2160p',
  'remux-2160p',
  'brdisk',
  'rawhd',
] as const

export type Quality = (typeof QUALITIES)[number]

export const QUALITY_NAMES: Record<Quality, string> = Object.fromEntries(
  QUALITIES.map((q) => [
    q,
    q
      .replace(/^webdl/, 'WEB-DL')
      .replace(/^webrip/, 'WEBRip')
      .replace(/^bluray/, 'Bluray')
      .replace(/^remux/, 'Remux')
      .replace(/^hdtv/, 'HDTV')
      .replace(/^sdtv$/, 'SDTV')
      .replace(/^dvd$/, 'DVD')
      .replace(/^brdisk$/, 'BR-DISK')
      .replace(/^rawhd$/, 'Raw-HD')
      .replace(/^[a-z]/, (c) => c.toUpperCase()),
  ]),
) as Record<Quality, string>

function res(parsed: ParsedRelease): '480p' | '576p' | '720p' | '1080p' | '2160p' {
  return parsed.resolution ?? '480p'
}

/** Maps a parsed release to its quality. */
export function qualityOf(parsed: ParsedRelease): Quality {
  const { source, modifiers } = parsed
  if (modifiers.includes('rawhd')) return 'rawhd'
  if (modifiers.includes('brdisk')) return 'brdisk'
  if (modifiers.includes('screener')) return 'screener'
  if (modifiers.includes('regional')) return 'regional'
  switch (source) {
    case 'cam':
    case 'telesync':
    case 'telecine':
    case 'workprint':
      return source
    case 'dvd':
      return 'dvd'
    case 'hdtv': {
      const r = res(parsed)
      return r === '2160p'
        ? 'hdtv-2160p'
        : r === '1080p'
          ? 'hdtv-1080p'
          : r === '720p'
            ? 'hdtv-720p'
            : 'sdtv'
    }
    case 'webrip':
    case 'webdl': {
      const r = res(parsed)
      return `${source}-${r === '576p' ? '480p' : r}` as Quality
    }
    case 'bluray': {
      const r = res(parsed)
      if (modifiers.includes('remux')) return r === '2160p' ? 'remux-2160p' : 'remux-1080p'
      return `bluray-${r}` as Quality
    }
  }
  return 'unknown'
}
