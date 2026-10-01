// @vitest-environment happy-dom
/// <reference lib="dom" />
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReleasePicker from '../src/ReleasePicker.vue'
import type { ReleaseRow } from '../src/status'

const row = (over: Partial<ReleaseRow> = {}): ReleaseRow => ({
  guid: 'g1',
  title: 'Some.Release.1080p',
  indexer: 'idx',
  protocol: 'torrent',
  size: 2 * 1024 ** 3,
  seeders: 5,
  leechers: 1,
  quality: '1080p',
  formatScore: 0,
  matchedFormats: [],
  accepted: true,
  rejections: [],
  ...over,
})

type Search = () => Promise<{
  results: ReleaseRow[]
  errors: { indexer: string; message: string }[]
}>

const mountPicker = (search: Search, grab = vi.fn(async () => {}), showUnitColumn = false) =>
  mount(ReleasePicker, { props: { label: 'Dune', search, grab, showUnitColumn } })

beforeEach(() => {
  // happy-dom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ReleasePicker', () => {
  it('shows a searching state, then the results', async () => {
    const w = mountPicker(async () => ({ results: [row()], errors: [] }))
    expect(w.text()).toContain('Searching…')
    await flushPromises()
    expect(w.text()).not.toContain('Searching…')
    expect(w.text()).toContain('Some.Release.1080p')
    expect(w.text()).toContain('2.0 GB')
    expect(w.text()).toContain('5 / 1')
  })

  it('says so when nothing was found, and lists per-indexer errors', async () => {
    const w = mountPicker(async () => ({
      results: [],
      errors: [{ indexer: 'broken', message: 'timed out' }],
    }))
    await flushPromises()
    expect(w.text()).toContain('No releases found.')
    expect(w.text()).toContain('broken: timed out')
  })

  it('shows the error when the search itself fails', async () => {
    const w = mountPicker(async () => {
      throw new Error('boom')
    })
    await flushPromises()
    expect(w.text()).toContain('boom')
    expect(w.find('[data-testid="releases"]').exists()).toBe(false)
  })

  it('shows rejection reasons on rejected releases', async () => {
    const w = mountPicker(async () => ({
      results: [row({ accepted: false, rejections: [{ rule: 'size', reason: 'Too small' }] })],
      errors: [],
    }))
    await flushPromises()
    expect(w.find('tr.rejected').text()).toContain('Too small')
  })

  it('grabs a release once, then marks it Sent', async () => {
    const grab = vi.fn(async () => {})
    const w = mountPicker(async () => ({ results: [row()], errors: [] }), grab)
    await flushPromises()
    const button = w.find('[data-testid="grab-g1"]')
    await button.trigger('click')
    await flushPromises()
    expect(grab).toHaveBeenCalledExactlyOnceWith('g1')
    expect(button.text()).toBe('Sent')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('shows a failed grab and leaves the release grabbable', async () => {
    const grab = vi.fn(async () => {
      throw new Error('client offline')
    })
    const w = mountPicker(async () => ({ results: [row()], errors: [] }), grab)
    await flushPromises()
    await w.find('[data-testid="grab-g1"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('client offline')
    expect(w.find('[data-testid="grab-g1"]').text()).toBe('Download')
  })

  it('shows the covered unit as a column only when asked', async () => {
    const search: Search = async () => ({ results: [row({ unit: 'S01E02' })], errors: [] })
    const inline = mountPicker(search)
    const column = mountPicker(search, undefined, true)
    await flushPromises()
    expect(inline.findAll('th').map((th) => th.text())).not.toContain('Covers')
    expect(inline.text()).toContain('idx · S01E02')
    expect(column.findAll('th').map((th) => th.text())).toContain('Covers')
  })

  it('emits close', async () => {
    const w = mountPicker(async () => ({ results: [], errors: [] }))
    await w.find('.mp-head button').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
