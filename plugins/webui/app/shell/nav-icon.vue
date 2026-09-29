<template>
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] ?? paths.other" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  browse: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M16 8l-3 5-5 3 3-5z',
  movies: 'M4 3h16v18H4z M4 7h16 M4 17h16 M8 3v4 M16 3v4 M8 17v4 M16 17v4',
  series: 'M3 6h18v13H3z M8 22h8 M12 19v3 M8 2l4 4 4-4',
  podcasts: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
  books: 'M12 5v16 M12 5C8 2 4 3 2 4v16c3-2 7-2 10 1 3-3 7-3 10-1V4c-2-1-6-2-10 1',
  music:
    'M9 18V5l11-2v13 M9 5v4l11-2 M9 18a3 3 0 1 1-3-3c2 0 3 1 3 3 M20 16a3 3 0 1 1-3-3c2 0 3 1 3 3',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  history: 'M3 10a9 9 0 1 1 1 8 M3 4v6h6 M12 7v5l3 2',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  logout: 'M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'M6 6l12 12 M18 6 6 18',
  other: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
}
</script>
