// The Radarr/Sonarr v3 indexer resource, as far as Prowlarr's application sync uses it.
// Prowlarr sends and compares `fields` by name, so a pushed body is stored as it came and
// handed back unchanged; only the few fields Magpie acts on are read out of it.

export interface Field {
  name: string
  value?: unknown
  [key: string]: unknown
}

export interface IndexerResource {
  id?: number
  name?: string
  implementation?: string
  protocol?: string
  priority?: number
  enableRss?: boolean
  enableAutomaticSearch?: boolean
  enableInteractiveSearch?: boolean
  fields?: Field[]
  tags?: number[]
  [key: string]: unknown
}

export interface Connection {
  name: string
  protocol: 'torrent' | 'usenet'
  url: string
  apiKey: string
  priority: number
  enableRss: boolean
  enableAutomatic: boolean
  enableInteractive: boolean
}

export class ResourceError extends Error {
  constructor(
    public property: string,
    message: string,
  ) {
    super(message)
  }
}

const field = (body: IndexerResource, name: string) =>
  body.fields?.find((f) => f.name === name)?.value

/** What to connect to for a pushed indexer: Prowlarr's per-indexer Torznab/Newznab proxy. */
export function connectionOf(body: IndexerResource): Connection {
  const base = String(field(body, 'baseUrl') ?? '').trim()
  if (!/^https?:\/\/[^/\s]+/i.test(base))
    throw new ResourceError('BaseUrl', 'the base URL must be an http(s) address')
  const path = String(field(body, 'apiPath') ?? '/api').trim() || '/api'
  const priority = Number(body.priority)
  const protocol =
    body.implementation === 'Newznab' || body.protocol === 'usenet' ? 'usenet' : 'torrent'
  return {
    name: String(body.name || base),
    protocol,
    url: base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`),
    apiKey: String(field(body, 'apiKey') ?? ''),
    priority: Number.isFinite(priority) && priority >= 0 ? Math.round(priority) : 25,
    enableRss: body.enableRss !== false,
    enableAutomatic: body.enableAutomaticSearch !== false,
    enableInteractive: body.enableInteractiveSearch !== false,
  }
}

const textbox = (order: number, name: string, label: string, value: unknown, extra = {}) => ({
  order,
  name,
  label,
  value,
  type: 'textbox',
  advanced: false,
  privacy: 'normal',
  isFloat: false,
  ...extra,
})

const FIELDS = () => [
  textbox(0, 'baseUrl', 'URL', '', { type: 'url' }),
  textbox(1, 'apiPath', 'API Path', '/api', { advanced: true }),
  textbox(2, 'apiKey', 'API Key', '', { type: 'password', privacy: 'apiKey' }),
  textbox(3, 'categories', 'Categories', [], { type: 'select' }),
  textbox(4, 'animeCategories', 'Anime Categories', [], { type: 'select', advanced: true }),
  textbox(5, 'animeStandardFormatSearch', 'Anime Standard Format Search', false, {
    type: 'checkbox',
    advanced: true,
  }),
  textbox(6, 'additionalParameters', 'Additional Parameters', '', { advanced: true }),
  textbox(7, 'multiLanguages', 'Multi Languages', [], { type: 'select', advanced: true }),
  textbox(8, 'minimumSeeders', 'Minimum Seeders', 1, { type: 'number', advanced: true }),
  textbox(9, 'seedCriteria.seedRatio', 'Seed Ratio', null, { type: 'number', advanced: true }),
  textbox(10, 'seedCriteria.seedTime', 'Seed Time', null, { type: 'number', advanced: true }),
  textbox(11, 'seedCriteria.seasonPackSeedTime', 'Season-Pack Seed Time', null, {
    type: 'number',
    advanced: true,
  }),
  textbox(12, 'requiredFlags', 'Required Flags', [], { type: 'select', advanced: true }),
  textbox(
    13,
    'rejectBlocklistedTorrentHashesWhileGrabbing',
    'Reject Blocklisted Torrent Hashes',
    false,
    {
      type: 'checkbox',
      advanced: true,
    },
  ),
]

/** `GET /indexer/schema`: the templates Prowlarr copies when it adds an indexer. */
export function schema(): IndexerResource[] {
  return (['Torznab', 'Newznab'] as const).map((implementation) => ({
    id: 0,
    name: '',
    implementation,
    implementationName: implementation,
    configContract: `${implementation}Settings`,
    infoLink: `https://wiki.servarr.com/prowlarr/supported-indexers#${implementation.toLowerCase()}`,
    protocol: implementation === 'Newznab' ? 'usenet' : 'torrent',
    enableRss: true,
    enableAutomaticSearch: true,
    enableInteractiveSearch: true,
    supportsRss: true,
    supportsSearch: true,
    priority: 25,
    downloadClientId: 0,
    tags: [],
    fields: FIELDS(),
  }))
}
