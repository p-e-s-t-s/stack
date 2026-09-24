import type { NamingScheme } from '@magpiejs/library'

export const MOVIE_NAMING: NamingScheme = {
  templates: {
    movieFolder: { label: 'Movie folder', default: '{Title} ({Year})' },
    movieFile: {
      label: 'Movie file',
      default: '{Title} ({Year}) [{Quality}]',
      help: 'The file extension is added for you.',
    },
  },
  tokens: ['Title', 'Year', 'Quality', 'Edition', 'Group', 'Resolution', 'Source'],
}
