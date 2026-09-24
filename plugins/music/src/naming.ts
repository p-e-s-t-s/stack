import type { NamingScheme } from '@magpiejs/library'

export const MUSIC_NAMING: NamingScheme = {
  templates: {
    artistFolder: { label: 'Artist folder', default: '{Artist Name}' },
    albumFolder: { label: 'Album folder', default: '{Album Title} ({Release Year})' },
    trackFile: {
      label: 'Track file',
      default: '{Disc Prefix}{track:00} - {Track Title}',
      help: '{Disc Prefix} is the disc number and a dash (1-) on albums with several discs, and empty otherwise. The file extension is added for you.',
    },
  },
  tokens: [
    'Artist Name',
    'Album Title',
    'Album Type',
    'Release Year',
    'Disc Prefix',
    'disc:0',
    'track:00',
    'Track Title',
    'Quality',
  ],
}
