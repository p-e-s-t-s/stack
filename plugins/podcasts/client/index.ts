import { registerPage } from '@magpiejs/console-kit/navigation'
import type { Context } from '@cordisjs/client'
import PodcastList from './podcast-list.vue'
import AddPodcast from './add-podcast.vue'
import PodcastDetail from './podcast-detail.vue'
import './style.css'

export default function (ctx: Context) {
  registerPage(ctx, {
    navigation: { group: 'library', icon: 'podcasts' },
    path: '/podcasts',
    name: 'Podcasts',
    order: 880,
    component: PodcastList,
  })
  // registered before the detail page so `/podcasts/add` isn't read as a podcast id
  ctx.client.router.page({
    path: '/podcasts/add',
    name: 'Add podcast',
    order: 0,
    component: AddPodcast,
    disabled: () => true,
  })
  ctx.client.router.page({
    path: '/podcasts/:id',
    name: 'Podcast detail',
    order: 0,
    component: PodcastDetail,
    disabled: () => true,
  })
}
