// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SearchBox from '../src/SearchBox.vue'

const mountBox = (props: { modelValue: string; searching?: boolean }) =>
  mount(SearchBox, { props: { placeholder: 'Find…', ...props } })

describe('SearchBox', () => {
  it('disables Search while the term is blank', () => {
    expect(mountBox({ modelValue: '   ' }).find('button').attributes('disabled')).toBeDefined()
    expect(mountBox({ modelValue: 'dune' }).find('button').attributes('disabled')).toBeUndefined()
  })

  it('disables Search and says so while searching', () => {
    const button = mountBox({ modelValue: 'dune', searching: true }).find('button')
    expect(button.text()).toBe('Searching…')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('emits update:modelValue as the user types', async () => {
    const w = mountBox({ modelValue: '' })
    await w.find('input').setValue('dune')
    expect(w.emitted('update:modelValue')).toEqual([['dune']])
  })

  it('emits search on submit without reloading the page', async () => {
    const w = mountBox({ modelValue: 'dune' })
    await w.find('form').trigger('submit')
    expect(w.emitted('search')).toHaveLength(1)
  })
})
