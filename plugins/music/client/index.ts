import type { Context } from '@cordisjs/client'
import ArtistList from './artist-list.vue'
import AddArtist from './add-artist.vue'
import ArtistDetail from './artist-detail.vue'
import AlbumDetail from './album-detail.vue'
import './style.css'

export default function (ctx: Context) {
  ctx.client.router.page({ path: '/music', name: 'Music', order: 865, component: ArtistList })
  // registered before the detail pages so `/music/add` isn't read as an id
  ctx.client.router.page({
    path: '/music/add',
    name: 'Add artist',
    order: 0,
    component: AddArtist,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/music/:id',
    name: 'Artist detail',
    order: 0,
    component: ArtistDetail,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/music/:id/:albumId',
    name: 'Album detail',
    order: 0,
    component: AlbumDetail,
    disabled: () => true,
  })
}
