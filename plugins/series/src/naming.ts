import type { NamingScheme } from '@magpiejs/library'

export const SERIES_NAMING: NamingScheme = {
  templates: {
    seriesFolder: { label: 'Series folder', default: '{Series Title} ({Year})' },
    seasonFolder: {
      label: 'Season folder',
      default: 'Season {season:00}',
      help: 'Used for series with season folders on.',
    },
    episodeFile: {
      label: 'Episode file',
      default: '{Series Title} - S{season:00}E{episode:00} - {Episode Title} [{Quality}]',
      help: 'The file extension is added for you.',
    },
    dailyEpisodeFile: {
      label: 'Daily episode file',
      default: '{Series Title} - {Air Date} - {Episode Title} [{Quality}]',
    },
    animeEpisodeFile: {
      label: 'Anime episode file',
      default:
        '{Series Title} - S{season:00}E{episode:00} - {absolute:000} - {Episode Title} [{Quality}]',
    },
  },
  tokens: [
    'Series Title',
    'Year',
    'season:00',
    'episode:00',
    'absolute:000',
    'Episode Title',
    'Air Date',
    'Quality',
    'Group',
    'Resolution',
    'Source',
  ],
}
