import { isValidElement } from 'react'
import { vi } from 'vitest'

import { createAppRoutes } from '@renderer/app/routes'
import { EntryPage } from '@renderer/pages/EntryPage'
import { createEntryDemoStore } from '@renderer/stores/entry-demo-store'

describe('entry demo store', () => {
  it('validates required answers and preserves them while moving between questions', () => {
    const store = createEntryDemoStore()

    expect(store.getState().index).toBe(0)
    expect(store.getState().next()).toBe(false)
    expect(store.getState().index).toBe(0)
    expect(store.getState().validationError).toMatch(/必答/)

    store.getState().answer('visit', 'yes')
    expect(store.getState().validationError).toBeNull()
    expect(store.getState().next()).toBe(true)
    store.getState().answer('location', '东城区')
    store.getState().previous()
    expect(store.getState().answers).toEqual({ visit: 'yes', location: '东城区' })
    expect(store.getState().index).toBe(0)
  })

  it('marks only memory completion on the final question and supports reset', () => {
    const store = createEntryDemoStore()
    store.getState().answer('visit', 'no')
    store.getState().next()
    store.getState().answer('location', '朝阳区')

    expect(store.getState().next()).toBe(true)
    expect(store.getState().completed).toBe(true)
    expect(store.getState().answers.location).toBe('朝阳区')

    store.getState().reset()
    expect(store.getState()).toMatchObject({
      index: 0,
      answers: {},
      validationError: null,
      completed: false
    })
  })

  it('rejects radio values that are not one of the declared options', () => {
    const store = createEntryDemoStore()

    store.getState().answer('visit', 'forged-value')

    expect(store.getState().answers).toEqual({})
    expect(store.getState().next()).toBe(false)
    expect(store.getState().validationError).toMatch(/必答/)
  })
})

describe('production entry page', () => {
  it('keeps entry and administration on final M2 pages', () => {
    const childRoutes = createAppRoutes({ isDevelopment: false })[0]?.children ?? []
    const entry = childRoutes.find((route) => route.path === '/entry')
    const adminData = childRoutes.find((route) => route.path === '/admin/data')

    expect(entry?.handle).not.toHaveProperty('placeholder')
    expect(adminData?.handle).not.toHaveProperty('placeholder')
    expect(isValidElement(entry?.element) && entry.element.type).toBe(EntryPage)
  })
})
