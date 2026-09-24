// Shared domain types and provider contracts (docs/PLAN.md §3.1).
// Types only: this package has no runtime code.

export type MediaKind = 'movie' | 'series'
export type Protocol = 'torrent' | 'usenet'

export interface ExternalIds {
  tmdb?: string
  tvdb?: string
  imdb?: string
  anidb?: string
  mal?: string
}

export interface TestResult {
  ok: boolean
  message?: string
}

// Metadata

export interface SearchQuery {
  term: string
  kind?: MediaKind
  year?: number
}

export interface MetadataSearchResult {
  kind: MediaKind
  title: string
  year?: number
  overview?: string
  posterUrl?: string
  ids: ExternalIds
}

export interface MovieMetadata extends MetadataSearchResult {
  kind: 'movie'
  runtimeMinutes?: number
  /** ISO dates. */
  releaseDates?: { theatrical?: string; digital?: string; physical?: string }
  alternateTitles?: string[]
  originalLanguage?: string
  backdropUrl?: string
  genres?: string[]
}

export interface SeriesMetadata extends MetadataSearchResult {
  kind: 'series'
  status?: 'continuing' | 'ended' | 'upcoming'
  network?: string
}

export interface EpisodeOrdering {
  id: string
  name: string
}

export interface EpisodeMetadata {
  season: number
  number: number
  absoluteNumber?: number
  title?: string
  airDateUtc?: string
}

export interface MetadataProvider {
  id: string
  kinds: MediaKind[]
  search(query: SearchQuery): Promise<MetadataSearchResult[]>
  getMovie?(externalId: string): Promise<MovieMetadata>
  getSeries?(externalId: string): Promise<SeriesMetadata>
  getEpisodes?(externalId: string, ordering?: EpisodeOrdering): Promise<EpisodeMetadata[]>
  orderings?(externalId: string): Promise<EpisodeOrdering[]>
  mapIds?(ids: ExternalIds): Promise<ExternalIds>
}

// Indexers

export interface IndexerCaps {
  categories: { id: number; name: string }[]
  searchParams: { movie: string[]; tv: string[]; search: string[] }
}

export interface ReleaseQuery {
  kind: MediaKind
  term?: string
  ids?: ExternalIds
  season?: number
  episode?: number
}

export interface ReleaseInfo {
  guid: string
  title: string
  protocol: Protocol
  indexerId: string
  downloadUrl: string
  infoUrl?: string
  size?: number
  publishedAt?: string
  seeders?: number
  leechers?: number
  infoHash?: string
  categories?: number[]
  ids?: ExternalIds
}

export interface IndexerProvider {
  id: string
  protocol: Protocol
  capabilities(): Promise<IndexerCaps>
  search(query: ReleaseQuery): Promise<ReleaseInfo[]>
  rss?(): Promise<ReleaseInfo[]>
  test(): Promise<TestResult>
}

// Download clients

export interface DownloadRef {
  clientId: string
  /** torrent info hash or usenet job id */
  downloadId: string
}

export interface AddOptions {
  category?: string
  paused?: boolean
}

export interface DownloadStatus extends DownloadRef {
  name: string
  state: 'queued' | 'downloading' | 'stalled' | 'completed' | 'failed' | 'paused'
  progress: number
  sizeBytes?: number
  etaSeconds?: number
  error?: string
}

export interface DownloadClient {
  id: string
  protocol: Protocol
  add(release: ReleaseInfo, options: AddOptions): Promise<DownloadRef>
  list(): Promise<DownloadStatus[]>
  remove(ref: DownloadRef, deleteData: boolean): Promise<void>
  /** Path as the client sees it; path mapping converts it to a local path. */
  outputPath(ref: DownloadRef): Promise<string>
  test(): Promise<TestResult>
}

// Subtitles

export interface SubtitleQuery {
  languages: string[]
  ids?: ExternalIds
  fileHash?: string
  releaseName?: string
  season?: number
  episode?: number
}

export interface SubtitleCandidate {
  providerId: string
  id: string
  language: string
  forced: boolean
  hearingImpaired: boolean
  score: number
  releaseName?: string
}

export interface SubtitleProvider {
  id: string
  search(query: SubtitleQuery): Promise<SubtitleCandidate[]>
  download(candidate: SubtitleCandidate): Promise<Uint8Array>
}

// Notifications

export interface NotificationEvent {
  type: string
  title: string
  body?: string
  data?: Record<string, unknown>
}

export interface Notifier {
  id: string
  events: string[]
  send(event: NotificationEvent): Promise<void>
}
