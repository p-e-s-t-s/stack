// Settings every media-server plugin shares. Spread `mediaServerConfig` into a plugin's
// `Config` and pass `optionsOf(config)` when registering.

import z from 'schemastery'
import { type Mapping, parseMappings } from './paths'

export interface MediaServerConfig {
  kinds: string
  pathMap: string
  debounceSeconds: number
}

export const mediaServerConfig = {
  kinds: z
    .string()
    .default('')
    .description(
      'Only refresh for these kinds, separated by commas (movie, series, music, …). Empty means all.',
    ),
  pathMap: z
    .string()
    .default('')
    .description(
      "Only if the server sees Magpie's library at other paths: `/data/movies => /media/movies; D:\\TV => /tv`. Empty means the paths are the same.",
    ),
  debounceSeconds: z
    .natural()
    .default(15)
    .description('Wait this long for more imports before asking the server to scan.'),
}

export interface ServerOptions {
  /** Empty means every kind. */
  kinds: string[]
  mappings: Mapping[]
  debounceMs: number
}

export function optionsOf(config: MediaServerConfig): ServerOptions {
  return {
    kinds: config.kinds
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    mappings: parseMappings(config.pathMap),
    debounceMs: config.debounceSeconds * 1000,
  }
}
