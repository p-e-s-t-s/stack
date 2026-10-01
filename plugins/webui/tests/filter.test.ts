import { DeltaState, type Mutation, apply, observe } from '@cordisjs/muon'
import { describe, expect, it } from 'vitest'
import { filterMutation, omitKeys } from '../src/filter'

const hidden = new Set(['clients', 'secret'])
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function fixture() {
  return {
    queue: [{ id: 1, progress: 0 }],
    clients: [{ name: 'qbittorrent', host: 'a' }],
    secret: { token: 'x' },
    label: 'one',
    counts: { done: 1 },
  }
}

/** Each edit is written the way plugins write theirs: through `entry.mutate`. */
const edits: [string, (d: ReturnType<typeof fixture>) => void][] = [
  ['sets a visible field', (d) => void (d.label = 'two')],
  ['sets a nested visible field', (d) => void (d.queue[0]!.progress = 50)],
  ['appends to a visible array', (d) => void d.queue.push({ id: 2, progress: 0 })],
  ['sets a hidden field', (d) => void (d.secret = { token: 'y' })],
  ['changes inside a hidden array', (d) => void (d.clients[0]!.host = 'b')],
  ['appends to a hidden array', (d) => void d.clients.push({ name: 'tx', host: 'c' })],
  ['replaces a hidden array', (d) => void (d.clients = [])],
  ['shortens a visible array', (d) => void d.queue.pop()],
  ['deletes a visible key', (d) => void delete (d.counts as { done?: number }).done],
  [
    'changes visible and hidden fields together',
    (d) => Object.assign(d, { label: 'three', clients: [{ name: 'x', host: 'z' }], secret: {} }),
  ],
  [
    'changes only hidden fields together',
    (d) => Object.assign(d, { clients: [], secret: { token: 'q' } }),
  ],
  [
    'edits visible and hidden arrays in one go',
    (d) => (d.queue.push({ id: 3, progress: 1 }), d.clients.push({ name: 'n', host: 'h' })),
  ],
]

describe('filtering console data', () => {
  it('omits hidden keys from a snapshot', () => {
    expect(omitKeys(fixture(), hidden)).toEqual({
      queue: [{ id: 1, progress: 0 }],
      label: 'one',
      counts: { done: 1 },
    })
    const data = fixture()
    expect(omitKeys(data, new Set())).toBe(data)
  })

  it('keeps a browser that sees only some keys in step with the data', () => {
    const data = fixture()
    // what the server sends this browser, and what the browser rebuilds from it
    const server = new DeltaState()
    const browser = new DeltaState()
    const mirror: any = clone(omitKeys(data, hidden))
    for (const [name, edit] of edits) {
      const mutation = observe(data, edit)
      const visible = mutation && filterMutation(mutation, hidden)
      if (visible) apply(mirror, browser.load(server.dump(visible)))
      expect(mirror, name).toEqual(clone(omitKeys(data, hidden)))
      // and never carries a hidden key
      for (const key of hidden) expect(mirror, name).not.toHaveProperty(key)
    }
  })

  it('sends nothing for a change that is wholly hidden', () => {
    const data = fixture()
    const mutation = observe(data, (d) => void d.clients.push({ name: 'x', host: 'y' }))!
    expect(filterMutation(mutation, hidden)).toBeUndefined()
    const batch = observe(data, (d) => Object.assign(d, { clients: [], secret: {} }))!
    expect(filterMutation(batch, hidden)).toBeUndefined()
  })

  it('passes everything through when nothing is hidden', () => {
    const mutation = observe(fixture(), (d) => void (d.label = 'x'))!
    expect(filterMutation(mutation, new Set())).toBe(mutation)
  })

  it('drops a mutation aimed at the root that it cannot read', () => {
    const odd: Mutation = { path: [], kind: { type: 'delete' } }
    expect(filterMutation(odd, hidden)).toBeUndefined()
    const replaced: Mutation = { path: [], kind: { type: 'replace', value: fixture() } }
    expect(filterMutation(replaced, hidden)).toEqual({
      path: [],
      kind: { type: 'replace', value: omitKeys(fixture(), hidden) },
    })
  })
})
