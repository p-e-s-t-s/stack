import { Context, Logger } from 'cordis'
import Timer from '@cordisjs/plugin-timer'
import Server from '@cordisjs/plugin-server'
import HTTP from '@cordisjs/plugin-http'
import Database from '@magpiejs/database'
import Jobs from '@magpiejs/jobs'
import Decision from '@magpiejs/decision'
import Library from '@magpiejs/library'
import Metadata from '@magpiejs/metadata'
import Downloads from '@magpiejs/downloads'
import Import from '@magpiejs/import'
import Movies from '@magpiejs/movies'
import Series from '@magpiejs/series'
import WebUI from '@magpiejs/webui'
const ctx = new Context()
ctx.baseUrl = new URL('.', import.meta.url).href
ctx.logger.exporter({ export(message) { console.log(Logger.format(this, message)) } })
await ctx.plugin(Timer)
await ctx.plugin(Server, { host: '127.0.0.1', port: 6778 })
await ctx.plugin(HTTP)
await ctx.plugin(Database, { path: ':memory:' })
await ctx.plugin(Jobs, { pollInterval: 0 })
await ctx.plugin(Decision)
await ctx.plugin(Library)
await ctx.plugin(Metadata)
await ctx.plugin(Downloads)
await ctx.plugin(Import)
await ctx.plugin(Movies)
await ctx.plugin(Series)
await ctx.plugin(WebUI, { devMode: true })
console.log('Import UI smoke server: http://127.0.0.1:6778/import')
setTimeout(() => process.exit(0), 180000)


