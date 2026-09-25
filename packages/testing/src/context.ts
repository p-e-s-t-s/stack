import HTTP from '@cordisjs/plugin-http'
import Timer from '@cordisjs/plugin-timer'
import CalendarService from '@magpiejs/calendar'
import DatabaseService from '@magpiejs/database'
import DecisionService from '@magpiejs/decision'
import DownloadsService from '@magpiejs/downloads'
import ImportService from '@magpiejs/import'
import IndexersService from '@magpiejs/indexers'
import JobsService from '@magpiejs/jobs'
import LibraryService from '@magpiejs/library'
import MetadataService from '@magpiejs/metadata'
import { Context } from 'cordis'

export interface TestContextOptions {
  /** Default `:memory:`. */
  db?: string
  /** Default `0` (ticks run jobs immediately, on demand). */
  pollInterval?: number
  /** Set false to skip; every kind's exit test needs it, so it defaults on. */
  metadata?: boolean
  /** Set false to skip. */
  calendar?: boolean
}

/**
 * The plugin stack nearly every exit test boots before its own kind plugin and indexer/download
 * client fakes: Timer, HTTP, an in-memory database, Jobs (with polling off, ticked on demand),
 * Decision, Library, Metadata, Indexers, Downloads, Import and Calendar.
 */
export async function createTestContext(options: TestContextOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(Timer)
  await ctx.plugin(HTTP)
  await ctx.plugin(DatabaseService, { path: options.db ?? ':memory:' })
  await ctx.plugin(JobsService, { pollInterval: options.pollInterval ?? 0 })
  await ctx.plugin(DecisionService)
  await ctx.plugin(LibraryService)
  if (options.metadata !== false) await ctx.plugin(MetadataService)
  await ctx.plugin(IndexersService)
  await ctx.plugin(DownloadsService)
  await ctx.plugin(ImportService)
  if (options.calendar !== false) await ctx.plugin(CalendarService)
  return ctx
}
