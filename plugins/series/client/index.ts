import type { Context } from '@cordisjs/client'
import SeriesList from './series-list.vue'
import AddSeries from './add-series.vue'
import SeriesDetail from './series-detail.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/series', name: 'Series', order: 890, component: SeriesList })
  // registered before the detail page so `/series/add` isn't read as a series id
  ctx.client.router.page({
    path: '/series/add',
    name: 'Add series',
    order: 0,
    component: AddSeries,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/series/:id',
    name: 'Series detail',
    order: 0,
    component: SeriesDetail,
    disabled: () => true,
  })
}
