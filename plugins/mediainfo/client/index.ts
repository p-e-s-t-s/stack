import type { Context } from '@cordisjs/client'
import MediaInfo from './media-info.vue'

export default function (ctx: Context) {
  // shown on each movie's and series' page by the `movie-detail` / `series-detail` slots
  ctx.client.router.slot({ type: 'movie-detail', component: MediaInfo, order: 90 })
  ctx.client.router.slot({ type: 'series-detail', component: MediaInfo, order: 90 })
}
