// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TabBar from '../src/TabBar.vue'

const tabs = [
  { key: 'a', label: 'Alpha', testId: 'tab-a' },
  { key: 'b', label: 'Beta' },
]

describe('TabBar', () => {
  it('marks only the tab matching modelValue as active', () => {
    const w = mount(TabBar, { props: { tabs, modelValue: 'b' } })
    expect(w.findAll('button').map((b) => b.classes('active'))).toEqual([false, true])
  })

  it('shows no active tab when modelValue is not in the list', () => {
    const w = mount(TabBar, { props: { tabs, modelValue: null } })
    expect(w.findAll('button.active')).toHaveLength(0)
  })

  it('emits update:modelValue and select with the clicked key', async () => {
    const w = mount(TabBar, { props: { tabs, modelValue: 'a' } })
    await w.findAll('button')[1]?.trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([['b']])
    expect(w.emitted('select')).toEqual([['b']])
  })

  it('exposes testId as data-testid and renders the default slot', () => {
    const w = mount(TabBar, { props: { tabs }, slots: { default: '<span id="extra">+</span>' } })
    expect(w.find('[data-testid="tab-a"]').text()).toBe('Alpha')
    expect(w.find('#extra').exists()).toBe(true)
  })
})
