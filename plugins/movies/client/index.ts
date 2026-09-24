import type { Context } from '@cordisjs/client'
import MovieList from './movie-list.vue'
import AddMovie from './add-movie.vue'
import MovieDetail from './movie-detail.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/movies', name: 'Movies', order: 900, component: MovieList })
  ctx.client.router.page({
    path: '/movies/add',
    name: 'Add movie',
    order: 0,
    component: AddMovie,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/movie/:id',
    name: 'Movie',
    order: 0,
    component: MovieDetail,
    disabled: () => true,
  })
}
