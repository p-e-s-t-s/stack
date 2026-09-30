// Turns probe facts into the short labels the panel shows.

import type { AudioFacts, ProbeFacts, SubtitleFacts, VideoFacts } from '@magpiejs/probe'

const HDR: Record<string, string> = {
  dv: 'Dolby Vision',
  hdr10: 'HDR10',
  hdr10plus: 'HDR10+',
  hlg: 'HLG',
}

/** `2160p` for UHD (also when cropped to a wide aspect ratio), `1080p`, `720p`… */
export function resolutionLabel(video: Pick<VideoFacts, 'width' | 'height'>) {
  const { width, height } = video
  if (width >= 3600 || height >= 2000) return '2160p'
  if (width >= 1800 || height >= 1000) return '1080p'
  if (width >= 1200 || height >= 700) return '720p'
  if (height >= 560) return '576p'
  return height ? `${height}p` : 'unknown'
}

export function videoSummary(video: VideoFacts) {
  return [
    resolutionLabel(video),
    video.codec.toUpperCase(),
    video.bitDepth && video.bitDepth > 8 ? `${video.bitDepth}-bit` : '',
    ...video.hdr.map((h) => HDR[h] ?? h),
    video.frameRate ? `${video.frameRate} fps` : '',
    video.bitrate ? mbps(video.bitrate) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function audioSummary(audio: AudioFacts) {
  const atmos = /atmos/i.test(audio.profile ?? '')
  return [
    audio.language ?? 'unknown language',
    audio.codec.toUpperCase() + (atmos ? ' Atmos' : ''),
    audio.layout ?? (audio.channels ? `${audio.channels} ch` : ''),
    audio.title && audio.title !== audio.language ? audio.title : '',
    audio.default ? 'default' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function subtitleSummary(sub: SubtitleFacts) {
  return [
    sub.language ?? 'unknown language',
    sub.codec,
    sub.forced ? 'forced' : '',
    sub.hi ? 'SDH' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function mbps(bitsPerSecond: number) {
  return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond >= 10_000_000 ? 0 : 1)} Mbps`
}

export function duration(seconds: number) {
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

/**
 * The resolution the release name promised (`bluray-1080p` → `1080p`), when the file is
 * really something else.
 */
export function labelMismatch(quality: string, video: VideoFacts | undefined) {
  const claimed = /(\d{3,4})p$/.exec(quality)?.[1]
  if (!claimed || !video) return
  const actual = resolutionLabel(video)
  return actual === `${claimed}p` ? undefined : { claimed: `${claimed}p`, actual }
}
