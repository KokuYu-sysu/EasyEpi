import { createStore, type StoreApi } from 'zustand/vanilla'

import { DEMO_ADMIN_RECORDS, type AdminDemoRecord } from '@renderer/demo/demo-data'

export interface AdminRecordPatch {
  area?: string
  status?: AdminDemoRecord['status']
}

export interface AdminDataDemoState {
  seedRecords: readonly Readonly<AdminDemoRecord>[]
  filter: string
  page: number
  pageSize: number
  selectedIds: readonly string[]
  edits: Readonly<Record<string, Readonly<AdminRecordPatch>>>
  deletedIds: readonly string[]
  setFilter(filter: string): void
  setPage(page: number): void
  setPageSize(pageSize: number): void
  setSelected(id: string, selected: boolean): void
  setPageSelection(ids: readonly string[], selected: boolean): void
  editRecord(id: string, patch: AdminRecordPatch): void
  deleteRecord(id: string): void
  reset(): void
}

export interface AdminDataView {
  filteredRows: readonly Readonly<AdminDemoRecord>[]
  pagedRows: readonly Readonly<AdminDemoRecord>[]
  page: number
  pageSize: number
  totalRows: number
  totalPages: number
}

export type AdminDataDemoStore = StoreApi<AdminDataDemoState>

function immutableRecords(records: readonly Readonly<AdminDemoRecord>[]) {
  return Object.freeze(records.map((record) => Object.freeze({ ...record })))
}

function safePageSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function visibleRows(state: AdminDataDemoState): readonly Readonly<AdminDemoRecord>[] {
  const deleted = new Set(state.deletedIds)
  return state.seedRecords
    .filter((record) => !deleted.has(record.id))
    .map((record) => Object.freeze({ ...record, ...state.edits[record.id], id: record.id }))
}

function filteredRows(state: AdminDataDemoState): readonly Readonly<AdminDemoRecord>[] {
  const query = state.filter.trim().toLocaleLowerCase('zh-CN')
  const rows = visibleRows(state)
  if (!query) return rows
  return rows.filter((record) =>
    [record.code, record.area, record.status, record.updatedAt].some((value) =>
      value.toLocaleLowerCase('zh-CN').includes(query)
    )
  )
}

function pageCount(state: AdminDataDemoState): number {
  return Math.max(1, Math.ceil(filteredRows(state).length / safePageSize(state.pageSize)))
}

export function selectAdminDataView(state: AdminDataDemoState): AdminDataView {
  const rows = filteredRows(state)
  const pageSize = safePageSize(state.pageSize)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, Math.floor(state.page) || 1), totalPages)
  const start = (page - 1) * pageSize
  return Object.freeze({
    filteredRows: Object.freeze(rows),
    pagedRows: Object.freeze(rows.slice(start, start + pageSize)),
    page,
    pageSize,
    totalRows: rows.length,
    totalPages
  })
}

export function createAdminDataDemoStore(
  seed: readonly Readonly<AdminDemoRecord>[] = DEMO_ADMIN_RECORDS,
  options: { pageSize?: number } = {}
): AdminDataDemoStore {
  const initialRecords = immutableRecords(seed)
  const initialPageSize = safePageSize(options.pageSize ?? 5)
  const initial = {
    filter: '',
    page: 1,
    pageSize: initialPageSize,
    selectedIds: Object.freeze([]) as readonly string[],
    edits: Object.freeze({}) as Readonly<Record<string, Readonly<AdminRecordPatch>>>,
    deletedIds: Object.freeze([]) as readonly string[]
  }

  return createStore<AdminDataDemoState>()((set) => ({
    seedRecords: initialRecords,
    ...initial,
    setFilter: (filter) => set({ filter, page: 1 }),
    setPage: (page) =>
      set((state) => ({ page: Math.min(Math.max(1, Math.floor(page) || 1), pageCount(state)) })),
    setPageSize: (pageSize) =>
      set((state) => {
        const safe = safePageSize(pageSize)
        const next = { ...state, pageSize: safe }
        return { pageSize: safe, page: Math.min(state.page, pageCount(next)) }
      }),
    setSelected: (id, selected) =>
      set((state) => {
        if (!visibleRows(state).some((record) => record.id === id)) return state
        const ids = new Set(state.selectedIds)
        if (selected) ids.add(id)
        else ids.delete(id)
        return { selectedIds: Object.freeze([...ids]) }
      }),
    setPageSelection: (ids, selected) =>
      set((state) => {
        const valid = new Set(visibleRows(state).map((record) => record.id))
        const selectedIds = new Set(state.selectedIds.filter((id) => valid.has(id)))
        for (const id of ids) {
          if (!valid.has(id)) continue
          if (selected) selectedIds.add(id)
          else selectedIds.delete(id)
        }
        return { selectedIds: Object.freeze([...selectedIds]) }
      }),
    editRecord: (id, patch) =>
      set((state) => {
        if (!visibleRows(state).some((record) => record.id === id)) return state
        return {
          edits: Object.freeze({
            ...state.edits,
            [id]: Object.freeze({ ...state.edits[id], ...patch })
          })
        }
      }),
    deleteRecord: (id) =>
      set((state) => {
        if (!visibleRows(state).some((record) => record.id === id)) return state
        const deletedIds = Object.freeze([...new Set([...state.deletedIds, id])])
        const selectedIds = Object.freeze(state.selectedIds.filter((candidate) => candidate !== id))
        const next = { ...state, deletedIds }
        return { deletedIds, selectedIds, page: Math.min(state.page, pageCount(next)) }
      }),
    reset: () => set({ ...initial })
  }))
}
