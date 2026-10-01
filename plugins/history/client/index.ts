import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import HistoryPage from './history.vue'
import MovieHistory from './movie-history.vue'
import SeriesHistory from './series-history.vue'
import MediaHistory from './media-history.vue'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'activity', icon: 'history' },
    path: '/history',
    name: 'History',
    order: 840,
    component: HistoryPage,
  })
  // shown on each movie's page by the movies plugin's `movie-detail` slot
  ctx.client.router.slot({ type: 'movie-detail', component: MovieHistory, order: 100 })
  ctx.client.router.slot({ type: 'series-detail', component: SeriesHistory, order: 100 })
  ctx.client.router.slot({ type: 'podcast-detail', component: MediaHistory, order: 100 })
  ctx.client.router.slot({ type: 'author-detail', component: MediaHistory, order: 100 })
  ctx.client.router.slot({ type: 'artist-detail', component: MediaHistory, order: 100 })
}
