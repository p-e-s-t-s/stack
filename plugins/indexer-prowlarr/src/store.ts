import type { Drizzle } from '@magpiejs/database'
import { eq } from 'drizzle-orm'
import type { IndexerResource } from './resource'
import * as schema from './schema'

/** Indexers and tags Prowlarr pushed over the v3 API. */
export class PushStore {
  constructor(private db: Drizzle<typeof schema>) {}

  list(): (IndexerResource & { id: number })[] {
    return this.db
      .select()
      .from(schema.pushed)
      .all()
      .map((r) => this.resource(r))
  }

  get(id: number) {
    const row = this.db.select().from(schema.pushed).where(eq(schema.pushed.id, id)).get()
    return row && this.resource(row)
  }

  add(body: IndexerResource) {
    const row = this.db
      .insert(schema.pushed)
      .values({ name: String(body.name ?? ''), body: JSON.stringify(body) })
      .returning()
      .get()
    return this.resource(row)
  }

  update(id: number, body: IndexerResource) {
    const row = this.db
      .update(schema.pushed)
      .set({ name: String(body.name ?? ''), body: JSON.stringify(body) })
      .where(eq(schema.pushed.id, id))
      .returning()
      .get()
    return row && this.resource(row)
  }

  remove(id: number) {
    return (
      this.db.delete(schema.pushed).where(eq(schema.pushed.id, id)).returning().all().length > 0
    )
  }

  tags() {
    return this.db.select().from(schema.tags).all()
  }

  /** Makes the tag, or finds it: Prowlarr retries. */
  tag(label: string) {
    this.db.insert(schema.tags).values({ label }).onConflictDoNothing().run()
    return this.db.select().from(schema.tags).where(eq(schema.tags.label, label)).get()!
  }

  private resource(row: typeof schema.pushed.$inferSelect) {
    return { ...(JSON.parse(row.body) as IndexerResource), id: row.id }
  }
}
