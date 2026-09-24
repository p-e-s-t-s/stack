// Shared domain types and provider contracts (docs/PLAN.md §3.1).
// Types only: this package has no runtime code.

/**
 * The kinds of media Magpie manages. Kind plugins add theirs by declaration merging:
 * `declare module '@magpiejs/types' { interface MediaKinds { podcast: true } }`.
 */
export interface MediaKinds {
  movie: true
  series: true
}
export type MediaKind = keyof MediaKinds & string

/** `http`: a direct download from a URL (podcast episodes, free books), no torrent or usenet. */
export type Protocol = 'torrent' | 'usenet' | 'http'

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
  runtimeMinutes?: number
  originalLanguage?: string
  backdropUrl?: string
  genres?: string[]
  alternateTitles?: string[]
  /** ISO date of the first episode. */
  firstAired?: string
  seasons: { number: number; title?: string; episodeCount: number; posterUrl?: string }[]
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
  overview?: string
  /** ISO date (the provider's local air date; no time of day). */
  airDate?: string
  runtimeMinutes?: number
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
  /** A number, or `MM/DD` for daily shows (with the year as `season`), per Newznab. */
  episode?: number | string
  /** Named search parameters for search types that have them (`artist`, `album`, `author`…). */
  fields?: Record<string, string>
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

export interface AddOptions {
  category?: string
  paused?: boolean
}

/** What gets sent to a client: resolved by the downloads plugin from a release's URL. */
export type DownloadPayload =
  | { type: 'magnet'; uri: string; hash: string; release: ReleaseInfo }
  | { type: 'torrent'; data: Uint8Array; hash: string; release: ReleaseInfo }
  | { type: 'nzb'; data: Uint8Array; release: ReleaseInfo }

export interface DownloadStatus {
  /** Torrent info hash (lower case) or usenet job id. */
  downloadId: string
  name: string
  state: 'queued' | 'downloading' | 'stalled' | 'completed' | 'failed' | 'paused'
  /** 0 to 1. */
  progress: number
  sizeBytes?: number
  etaSeconds?: number
  /** Where the finished download is, as the client sees it. */
  outputPath?: string
  error?: string
}

export interface DownloadClient {
  id: string
  protocol: Protocol
  /** Returns the download id (info hash or job id). */
  add(payload: DownloadPayload, options: AddOptions): Promise<string>
  /** Downloads in Magpie's category. */
  list(): Promise<DownloadStatus[]>
  remove(downloadId: string, deleteData: boolean): Promise<void>
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
