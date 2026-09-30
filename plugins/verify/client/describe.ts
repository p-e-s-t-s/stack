// A one-line description of what a probe found, for the queue row.

import type { ProbeFacts } from '@magpiejs/probe'

export function summarize(facts: ProbeFacts) {
  const parts: string[] = []
  const video = facts.video
  if (video) {
    const p =
      video.width >= 3600
        ? '2160p'
        : video.width >= 1800
          ? '1080p'
          : video.width >= 1200
            ? '720p'
            : `${video.height}p`
    parts.push(p, video.codec.toUpperCase())
  }
  const audio = facts.audio[0]
  if (audio)
    parts.push(
      [audio.codec.toUpperCase(), audio.channels && `${audio.channels}ch`]
        .filter(Boolean)
        .join(' '),
    )
  if (facts.duration) {
    const minutes = Math.round(facts.duration / 60)
    parts.push(
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
        : `${minutes}m`,
    )
  }
  return parts.join(' · ')
}
