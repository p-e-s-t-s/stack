import type { ExternalIds } from './index'

export type SubtitleFormat = 'srt' | 'ass' | 'ssa' | 'vtt'

export interface SubtitleRequirement {
  id: string
  language: string
  forced: 'full' | 'forced' | 'either'
  hi: 'require' | 'prefer' | 'exclude' | 'either'
  embedded: boolean
  formats: SubtitleFormat[]
  minimum: number
  cutoff: number
}

export interface SubtitleSearchContext {
  kind: 'movie' | 'series'
  title: string
  year: number | null
  ids: ExternalIds
  releaseName: string | null
  releaseGroup: string | null
  size: number
  hash?: string
  duration?: number
  episodes: { season: number; number: number }[]
}

export interface SubtitleCandidate {
  id: string
  providerId: string
  fileId: string
  name: string
  language: string | null
  forced: boolean | null
  hi: boolean | null
  format: SubtitleFormat
  ids: Record<string, string>
  year?: number
  episodes?: { season: number; number: number }[]
  releaseName?: string
  hashMatch?: boolean
  /** Internal adapter data, never accepted from a client as a download URL. */
  data?: Record<string, unknown>
}

export interface SubtitleProvider {
  id: string
  name: string
  priority: number
  automatic: boolean
  search(context: SubtitleSearchContext, requirement: SubtitleRequirement, signal: AbortSignal): Promise<SubtitleCandidate[]>
  download(candidate: SubtitleCandidate, signal: AbortSignal): Promise<Uint8Array>
  test(signal: AbortSignal): Promise<string>
}

export class SubtitleProviderError extends Error {
  constructor(
    public code: 'auth' | 'quota' | 'rate-limit' | 'temporary' | 'invalid',
    message: string,
    public retryAt?: number,
  ) { super(message) }
}
