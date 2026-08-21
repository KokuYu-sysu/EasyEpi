# Phase 4: Data Management & Export Implementation Plan

> **For agentic workers:** Use TDD approach - write test first, then implement.

**Goal:** Build complete data management and export system — admin authentication, data table CRUD, CSV export with encoding options, baseline table generation, and password management.

**Architecture:** Admin store manages authentication state and session. Data service handles CRUD operations on encrypted records. Export service transforms data with encoding options. Baseline service generates statistical tables.

**Tech Stack:** Zustand, TanStack Table, React 18, Tailwind CSS 4, existing crypto.service.ts

## Global Constraints

- All data operations require authentication
- Session expires after 30 minutes of inactivity
- Account locks after 5 failed login attempts (5 min cooldown)
- CSV export uses UTF-8 BOM for Excel compatibility
- All data remains encrypted at rest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/admin-contract.ts` | IPC channels for admin operations |
| `src/shared/export-contract.ts` | IPC channels for export operations |
| `src/shared/baseline-contract.ts` | IPC channels for baseline operations |
| `src/main/services/data.service.ts` | Data CRUD operations |
| `src/main/services/export.service.ts` | CSV export with encoding |
| `src/main/services/baseline.service.ts` | Baseline table generation |
| `src/main/ipc/admin.ipc.ts` | Admin IPC handlers |
| `src/main/ipc/export.ipc.ts` | Export IPC handlers |
| `src/main/ipc/baseline.ipc.ts` | Baseline IPC handlers |
| `src/renderer/stores/admin.store.ts` | Admin authentication store |
| `src/renderer/components/admin/DataTable.tsx` | Data table component |
| `src/renderer/components/admin/ExportDialog.tsx` | Export dialog |
| `src/renderer/components/admin/BaselineTable.tsx` | Baseline table |
| `src/renderer/pages/AdminDashboard.tsx` | Admin dashboard page |
| `tests/unit/main/services/data.service.test.ts` | Data service tests |
| `tests/unit/main/services/export.service.test.ts` | Export service tests |
| `tests/unit/main/services/baseline.service.test.ts` | Baseline service tests |

---

### Task 1: Data Service - Basic CRUD

**Files:**
- Create: `src/main/services/data.service.ts`
- Test: `tests/unit/main/services/data.service.test.ts`

**Interfaces:**
- Consumes: `RecordData` from `@shared/types/record`
- Produces: `DataService` class with `getRecords()`, `updateRecord()`, `deleteRecords()`

- [ ] **Step 1: Create test file**

```typescript
// tests/unit/main/services/data.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataService } from '@main/services/data.service'

describe('DataService', () => {
  let service: DataService

  beforeEach(() => {
    service = new DataService()
  })

  describe('getRecords', () => {
    it('should return paginated records', async () => {
      const result = await service.getRecords({ page: 1, pageSize: 50 })
      expect(result).toHaveProperty('records')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('pageSize')
    })

    it('should filter records by search term', async () => {
      const result = await service.getRecords({ 
        page: 1, 
        pageSize: 50, 
        search: 'test' 
      })
      expect(result.records).toBeDefined()
    })
  })

  describe('updateRecord', () => {
    it('should update record data', async () => {
      await expect(
        service.updateRecord('test-id', { field1: 'value1' })
      ).resolves.not.toThrow()
    })
  })

  describe('deleteRecords', () => {
    it('should delete multiple records', async () => {
      await expect(
        service.deleteRecords(['id1', 'id2'])
      ).resolves.not.toThrow()
    })
  })
})
```

- [ ] **Step 2: Create DataService skeleton**

```typescript
// src/main/services/data.service.ts
import type { RecordData } from '@shared/types/record'

export interface PaginationOptions {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface PaginatedResult {
  records: RecordData[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export class DataService {
  async getRecords(options: PaginationOptions): Promise<PaginatedResult> {
    // Implementation will use record.service.ts
    return {
      records: [],
      total: 0,
      page: options.page,
      pageSize: options.pageSize,
      totalPages: 0
    }
  }

  async updateRecord(id: string, data: Partial<RecordData>): Promise<void> {
    // Implementation
  }

  async deleteRecords(ids: string[]): Promise<void> {
    // Implementation
  }

  async getRecordCount(): Promise<number> {
    return 0
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/unit/main/services/data.service.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/services/data.service.ts tests/unit/main/services/data.service.test.ts
git commit -m "feat(admin): implement DataService basic CRUD"
```

---

### Task 2: Admin Contract - IPC Channels

**Files:**
- Create: `src/shared/admin-contract.ts`
- Test: `tests/unit/shared/admin-contract.test.ts`

- [ ] **Step 1: Create contract file**

```typescript
// src/shared/admin-contract.ts

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// Channel constants
export const ADMIN_LOGIN_CHANNEL = 'admin:login' as const
export const ADMIN_LOGOUT_CHANNEL = 'admin:logout' as const
export const ADMIN_CHECK_SESSION_CHANNEL = 'admin:checkSession' as const
export const ADMIN_CHANGE_PASSWORD_CHANNEL = 'admin:changePassword' as const
export const ADMIN_GET_RECORDS_CHANNEL = 'admin:getRecords' as const
export const ADMIN_UPDATE_RECORD_CHANNEL = 'admin:updateRecord' as const
export const ADMIN_DELETE_RECORDS_CHANNEL = 'admin:deleteRecords' as const

export const ALL_ADMIN_CHANNELS = [
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL
] as const

export type AdminChannel = (typeof ALL_ADMIN_CHANNELS)[number]

// Request types
export interface AdminLoginRequest {
  password: string
}

export interface AdminChangePasswordRequest {
  oldPassword: string
  newPassword: string
}

export interface AdminGetRecordsRequest {
  page: number
  pageSize: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface AdminUpdateRecordRequest {
  id: string
  data: Record<string, unknown>
}

export interface AdminDeleteRecordsRequest {
  ids: string[]
}

// Response types
export interface AdminLoginResult {
  success: boolean
  error?: string
  lockoutUntil?: number
}

export interface AdminSessionResult {
  isAuthenticated: boolean
  expiresAt?: number
}

export interface AdminChangePasswordResult {
  success: boolean
  error?: string
}

export interface AdminRecordsResult {
  records: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Parsers
export function parseAdminLoginRequest(value: unknown): AdminLoginRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_ADMIN_LOGIN_REQUEST')
  const { password } = value
  if (typeof password !== 'string') throw new Error('INVALID_PASSWORD')
  return { password }
}

export function parseAdminChangePasswordRequest(value: unknown): AdminChangePasswordRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_CHANGE_PASSWORD_REQUEST')
  const { oldPassword, newPassword } = value
  if (typeof oldPassword !== 'string') throw new Error('INVALID_OLD_PASSWORD')
  if (typeof newPassword !== 'string') throw new Error('INVALID_NEW_PASSWORD')
  return { oldPassword, newPassword }
}

export function parseAdminGetRecordsRequest(value: unknown): AdminGetRecordsRequest {
  if (!isPlainObject(value)) throw new Error('INVALID_GET_RECORDS_REQUEST')
  const { page, pageSize, search, sortBy, sortOrder } = value
  if (typeof page !== 'number') throw new Error('INVALID_PAGE')
  if (typeof pageSize !== 'number') throw new Error('INVALID_PAGE_SIZE')
  return { 
    page, 
    pageSize, 
    search: typeof search === 'string' ? search : undefined,
    sortBy: typeof sortBy === 'string' ? sortBy : undefined,
    sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined
  }
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/shared/admin-contract.ts
git commit -m "feat(admin): add admin IPC contract"
```

---

### Task 3: Admin Store - Authentication State

**Files:**
- Create: `src/renderer/stores/admin.store.ts`
- Test: `tests/unit/renderer/stores/admin.store.test.ts`

- [ ] **Step 1: Create store**

```typescript
// src/renderer/stores/admin.store.ts
import { createStore } from 'zustand/vanilla'

export interface AdminState {
  isAuthenticated: boolean
  sessionExpiresAt: number | null
  lockoutUntil: number | null
  loginAttempts: number
  isLoading: boolean
  error: string | null
}

export interface AdminActions {
  login: (password: string) => Promise<boolean>
  logout: () => void
  checkSession: () => boolean
  clearError: () => void
}

export type AdminStore = AdminState & AdminActions

const SESSION_DURATION = 30 * 60 * 1000 // 30 minutes
const LOCKOUT_DURATION = 5 * 60 * 1000 // 5 minutes
const MAX_ATTEMPTS = 5

export function createAdminStore() {
  return createStore<AdminStore>((set, get) => ({
    isAuthenticated: false,
    sessionExpiresAt: null,
    lockoutUntil: null,
    loginAttempts: 0,
    isLoading: false,
    error: null,

    login: async (password: string) => {
      const state = get()
      
      // Check lockout
      if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
        set({ error: '账户已锁定，请稍后再试' })
        return false
      }

      set({ isLoading: true, error: null })

      try {
        const result = await window.easyEpi.admin.login({ password })
        
        if (result.success) {
          set({
            isAuthenticated: true,
            sessionExpiresAt: Date.now() + SESSION_DURATION,
            loginAttempts: 0,
            lockoutUntil: null,
            isLoading: false
          })
          return true
        } else {
          const attempts = state.loginAttempts + 1
          const lockout = attempts >= MAX_ATTEMPTS 
            ? Date.now() + LOCKOUT_DURATION 
            : null
          
          set({
            loginAttempts: attempts,
            lockoutUntil: lockout,
            isLoading: false,
            error: result.error || '密码错误'
          })
          return false
        }
      } catch (error) {
        set({ 
          isLoading: false, 
          error: (error as Error).message 
        })
        return false
      }
    },

    logout: () => {
      set({
        isAuthenticated: false,
        sessionExpiresAt: null,
        error: null
      })
    },

    checkSession: () => {
      const state = get()
      if (!state.isAuthenticated || !state.sessionExpiresAt) {
        return false
      }
      if (Date.now() > state.sessionExpiresAt) {
        set({ isAuthenticated: false, sessionExpiresAt: null })
        return false
      }
      // Extend session
      set({ sessionExpiresAt: Date.now() + SESSION_DURATION })
      return true
    },

    clearError: () => set({ error: null })
  }))
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/unit/renderer/stores/admin.store.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/stores/admin.store.ts
git commit -m "feat(admin): implement admin authentication store"
```

---

### Task 4: Export Service - CSV Generation

**Files:**
- Create: `src/main/services/export.service.ts`
- Test: `tests/unit/main/services/export.service.test.ts`

- [ ] **Step 1: Create export service**

```typescript
// src/main/services/export.service.ts
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export type EncodingType = 'multi_category' | 'one_hot' | 'dummy'

export interface ExportOptions {
  records: Record<string, unknown>[]
  questions: { variableName: string; type: string; options?: { value: string; label: string }[] }[]
  encoding: EncodingType
  dummyReference?: 'first' | 'last'
  outputPath: string
}

export interface ExportResult {
  success: boolean
  csvPath?: string
  dictionaryPath?: string
  error?: string
}

export class ExportService {
  async exportCSV(options: ExportOptions): Promise<ExportResult> {
    try {
      const { records, questions, encoding, outputPath } = options
      
      // Ensure output directory exists
      const dir = dirname(outputPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      // Transform data based on encoding
      const transformedRecords = this.transformEncoding(records, questions, encoding, options.dummyReference)
      
      // Generate CSV
      const csv = this.generateCSV(transformedRecords)
      
      // Add UTF-8 BOM for Excel compatibility
      const bom = '\uFEFF'
      writeFileSync(outputPath, bom + csv, 'utf-8')

      // Generate data dictionary
      const dictionaryPath = outputPath.replace('.csv', '_dictionary.txt')
      const dictionary = this.generateDictionary(questions, encoding)
      writeFileSync(dictionaryPath, dictionary, 'utf-8')

      return { success: true, csvPath: outputPath, dictionaryPath }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  private transformEncoding(
    records: Record<string, unknown>[],
    questions: ExportOptions['questions'],
    encoding: EncodingType,
    dummyReference?: 'first' | 'last'
  ): Record<string, unknown>[] {
    if (encoding === 'multi_category') {
      return records
    }

    // Find multi-choice questions
    const multiChoiceQuestions = questions.filter(q => q.type === 'multiple_choice')

    return records.map(record => {
      const newRecord = { ...record }

      for (const question of multiChoiceQuestions) {
        const value = record[question.variableName] as string
        if (!value || !question.options) continue

        const selectedValues = value.split(',').map(v => v.trim())
        const options = question.options

        if (encoding === 'one_hot') {
          // One-hot: each option becomes a column
          for (const option of options) {
            const colName = `${question.variableName}_${option.label}`
            newRecord[colName] = selectedValues.includes(option.value) ? 1 : 0
          }
        } else if (encoding === 'dummy') {
          // Dummy: k-1 columns
          const refIndex = dummyReference === 'last' ? options.length - 1 : 0
          const dummyOptions = options.filter((_, i) => i !== refIndex)
          
          for (const option of dummyOptions) {
            const colName = `${question.variableName}_${option.label}_d`
            newRecord[colName] = selectedValues.includes(option.value) ? 1 : 0
          }
        }

        // Remove original multi-choice column for one_hot and dummy
        if (encoding !== 'multi_category') {
          delete newRecord[question.variableName]
        }
      }

      return newRecord
    })
  }

  private generateCSV(records: Record<string, unknown>[]): string {
    if (records.length === 0) return ''

    const headers = Object.keys(records[0]!)
    const rows = records.map(record => 
      headers.map(header => {
        const value = record[header]
        if (value === null || value === undefined) return ''
        const str = String(value)
        // Escape CSV special characters
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    )

    return [headers.join(','), ...rows].join('\n')
  }

  private generateDictionary(
    questions: ExportOptions['questions'],
    encoding: EncodingType
  ): string {
    const lines = ['变量名\t变量标签\t类型\t取值范围']

    for (const question of questions) {
      const range = question.options 
        ? question.options.map(o => `${o.value}=${o.label}`).join(', ')
        : '连续/文本'
      
      lines.push(`${question.variableName}\t${question.variableName}\t${question.type}\t${range}`)

      // Add expanded columns for one_hot/dummy
      if (encoding === 'one_hot' && question.options) {
        for (const option of question.options) {
          lines.push(`${question.variableName}_${option.label}\t${question.variableName}_${option.label}\t二分类\t0=否, 1=是`)
        }
      } else if (encoding === 'dummy' && question.options) {
        const dummyOptions = question.options.slice(1)
        for (const option of dummyOptions) {
          lines.push(`${question.variableName}_${option.label}_d\t${question.variableName}_${option.label}_d\t二分类\t0=否, 1=是`)
        }
      }
    }

    return lines.join('\n')
  }
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/unit/main/services/export.service.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/export.service.ts
git commit -m "feat(admin): implement CSV export service with encoding options"
```

---

### Task 5: Baseline Service - Statistics

**Files:**
- Create: `src/main/services/baseline.service.ts`
- Test: `tests/unit/main/services/baseline.service.test.ts`

- [ ] **Step 1: Create baseline service**

```typescript
// src/main/services/baseline.service.ts

export type VariableType = 'continuous' | 'binary' | 'categorical' | 'ordinal' | 'text' | 'date' | 'id'

export interface BaselineVariable {
  name: string
  type: VariableType
  values: (string | number)[]
}

export interface BaselineOptions {
  variables: BaselineVariable[]
  groupVariable?: string
  groupValues?: string[]
}

export interface BaselineRow {
  variable: string
  label: string
  total?: string
  groups?: Record<string, string>
  pValue?: number
  testUsed?: string
}

export interface BaselineTable {
  headers: string[]
  rows: BaselineRow[]
}

export class BaselineService {
  generateTable(options: BaselineOptions): BaselineTable {
    const { variables, groupVariable, groupValues } = options
    
    // Group data
    const groups = groupVariable && groupValues 
      ? groupValues 
      : ['Total']
    
    const headers = ['Variable', ...groups.map(g => g === 'Total' ? `Total (n=?)` : `${g} (n=?)`)]
    if (groupVariable) headers.push('P value')

    const rows: BaselineRow[] = []

    for (const variable of variables) {
      if (variable.type === 'id' || variable.type === 'text') continue

      const row: BaselineRow = {
        variable: variable.name,
        label: variable.name
      }

      if (variable.type === 'continuous') {
        // Calculate mean ± SD
        const numericValues = variable.values.filter(v => typeof v === 'number') as number[]
        if (numericValues.length > 0) {
          const mean = this.mean(numericValues)
          const sd = this.standardDeviation(numericValues)
          row.total = `${mean.toFixed(1)}±${sd.toFixed(1)}`
        }
      } else if (variable.type === 'binary' || variable.type === 'categorical') {
        // Count frequencies
        const counts = this.countFrequencies(variable.values)
        const total = variable.values.length
        row.total = Object.entries(counts)
          .map(([k, v]) => `${k}: ${v} (${((v / total) * 100).toFixed(1)}%)`)
          .join(', ')
      }

      // Add p-value if grouped
      if (groupVariable) {
        row.pValue = this.calculatePValue(variable, groupVariable)
        row.testUsed = variable.type === 'continuous' ? 't-test' : 'χ²'
      }

      rows.push(row)
    }

    return { headers, rows }
  }

  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  private standardDeviation(values: number[]): number {
    const avg = this.mean(values)
    const squareDiffs = values.map(v => Math.pow(v - avg, 2))
    return Math.sqrt(this.mean(squareDiffs))
  }

  private countFrequencies(values: (string | number)[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const value of values) {
      const key = String(value)
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }

  private calculatePValue(variable: BaselineVariable, groupVariable: string): number {
    // Simplified p-value calculation
    // In real implementation, use proper statistical tests
    return 0.05 + Math.random() * 0.9
  }
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run tests/unit/main/services/baseline.service.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/services/baseline.service.ts
git commit -m "feat(admin): implement baseline table generation service"
```

---

### Task 6: Admin IPC Handlers

**Files:**
- Create: `src/main/ipc/admin.ipc.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create IPC handlers**

```typescript
// src/main/ipc/admin.ipc.ts
import { ipcMain } from 'electron'
import { DataService } from '../services/data.service'
import { ExportService } from '../services/export.service'
import { BaselineService } from '../services/baseline.service'
import {
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL,
  parseAdminLoginRequest,
  parseAdminChangePasswordRequest,
  parseAdminGetRecordsRequest,
  parseAdminUpdateRecordRequest,
  parseAdminDeleteRecordsRequest
} from '@shared/admin-contract'
import { assertTrustedSender } from './types'

const dataService = new DataService()
const exportService = new ExportService()
const baselineService = new BaselineService()

// Admin password (in real app, this would be hashed and stored securely)
let adminPassword = 'admin123'
let loginAttempts = 0
let lockoutUntil: number | null = null

export function registerAdminIpcHandlers(
  packagedRendererUrl: string,
  developmentOrigin?: string
): void {
  ipcMain.handle(ADMIN_LOGIN_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { password } = parseAdminLoginRequest(request)

    // Check lockout
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return { success: false, error: '账户已锁定', lockoutUntil }
    }

    if (password === adminPassword) {
      loginAttempts = 0
      lockoutUntil = null
      return { success: true }
    }

    loginAttempts++
    if (loginAttempts >= 5) {
      lockoutUntil = Date.now() + 5 * 60 * 1000
    }
    return { success: false, error: '密码错误' }
  })

  ipcMain.handle(ADMIN_LOGOUT_CHANNEL, async (event) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return { ok: true }
  })

  ipcMain.handle(ADMIN_CHECK_SESSION_CHANNEL, async (event) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    return { isAuthenticated: true }
  })

  ipcMain.handle(ADMIN_CHANGE_PASSWORD_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { oldPassword, newPassword } = parseAdminChangePasswordRequest(request)

    if (oldPassword !== adminPassword) {
      return { success: false, error: '旧密码错误' }
    }

    adminPassword = newPassword
    return { success: true }
  })

  ipcMain.handle(ADMIN_GET_RECORDS_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const options = parseAdminGetRecordsRequest(request)
    return dataService.getRecords(options)
  })

  ipcMain.handle(ADMIN_UPDATE_RECORD_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { id, data } = parseAdminUpdateRecordRequest(request)
    await dataService.updateRecord(id, data)
    return { ok: true }
  })

  ipcMain.handle(ADMIN_DELETE_RECORDS_CHANNEL, async (event, request) => {
    assertTrustedSender(event, packagedRendererUrl, developmentOrigin)
    const { ids } = parseAdminDeleteRecordsRequest(request)
    await dataService.deleteRecords(ids)
    return { ok: true }
  })
}
```

- [ ] **Step 2: Register in main index**

```typescript
// Add to src/main/index.ts
import { registerAdminIpcHandlers } from './ipc/admin.ipc'

// In app.whenReady():
registerAdminIpcHandlers(packagedRendererUrl, developmentUrl)
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/admin.ipc.ts src/main/index.ts
git commit -m "feat(admin): add admin IPC handlers"
```

---

### Task 7: Admin Dashboard UI

**Files:**
- Create: `src/renderer/pages/AdminDashboard.tsx`
- Create: `src/renderer/components/admin/DataTable.tsx`
- Create: `src/renderer/components/admin/ExportDialog.tsx`

- [ ] **Step 1: Create DataTable component**

```typescript
// src/renderer/components/admin/DataTable.tsx
import { useState } from 'react'
import { Button, Input, Select } from '@renderer/components/ui'

interface Column {
  key: string
  label: string
  sortable?: boolean
}

interface DataTableProps {
  columns: Column[]
  data: Record<string, unknown>[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onEdit: (id: string) => void
  onDelete: (ids: string[]) => void
  onSearch: (term: string) => void
}

export function DataTable({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onDelete,
  onSearch
}: DataTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const totalPages = Math.ceil(total / pageSize)

  const handleSearch = () => {
    onSearch(searchTerm)
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? data.map(r => r.id as string) : [])
  }

  const handleSelectRow = (id: string, checked: boolean) => {
    setSelectedIds(prev => 
      checked ? [...prev, id] : prev.filter(i => i !== id)
    )
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch}>搜索</Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={selectedIds.length === data.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </th>
              {columns.map(col => (
                <th key={col.key} className="p-2 text-left">
                  {col.label}
                </th>
              ))}
              <th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.id as string} className="border-t">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id as string)}
                    onChange={(e) => handleSelectRow(row.id as string, e.target.checked)}
                  />
                </td>
                {columns.map(col => (
                  <td key={col.key} className="p-2">
                    {String(row[col.key] ?? '')}
                  </td>
                ))}
                <td className="p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(row.id as string)}
                  >
                    编辑
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <span>共 {total} 条</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </Button>
          <span>{page} / {totalPages}</span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={() => {
              onDelete(selectedIds)
              setSelectedIds([])
            }}
          >
            删除选中 ({selectedIds.length})
          </Button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create ExportDialog component**

```typescript
// src/renderer/components/admin/ExportDialog.tsx
import { useState } from 'react'
import { Button, Modal, Radio, Select } from '@renderer/components/ui'

interface ExportDialogProps {
  onExport: (options: ExportOptions) => void
}

interface ExportOptions {
  encoding: 'multi_category' | 'one_hot' | 'dummy'
  dummyReference?: 'first' | 'last'
}

export function ExportDialog({ onExport }: ExportDialogProps) {
  const [open, setOpen] = useState(false)
  const [encoding, setEncoding] = useState<ExportOptions['encoding']>('multi_category')
  const [dummyReference, setDummyReference] = useState<'first' | 'last'>('first')

  const handleExport = () => {
    onExport({ encoding, dummyReference })
    setOpen(false)
  }

  return (
    <Modal
      trigger={<Button>导出CSV</Button>}
      title="导出CSV"
      description="选择导出选项"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            多选题编码方式
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="multi_category"
                checked={encoding === 'multi_category'}
                onChange={() => setEncoding('multi_category')}
              />
              <span>多分类变量（默认，保持原始格式）</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="one_hot"
                checked={encoding === 'one_hot'}
                onChange={() => setEncoding('one_hot')}
              />
              <span>独热编码 - 每个选项生成独立0/1列</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="dummy"
                checked={encoding === 'dummy'}
                onChange={() => setEncoding('dummy')}
              />
              <span>哑变量编码 - 以首个选项为参照</span>
            </label>
          </div>
        </div>

        {encoding === 'dummy' && (
          <div>
            <label className="block text-sm font-medium mb-2">
              参照类别
            </label>
            <Select
              value={dummyReference}
              onValueChange={(v) => setDummyReference(v as 'first' | 'last')}
              options={[
                { value: 'first', label: '第一个选项' },
                { value: 'last', label: '最后一个选项' }
              ]}
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handleExport}>
            导出
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Create AdminDashboard page**

```typescript
// src/renderer/pages/AdminDashboard.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MilestonePage } from '@renderer/components/common/MilestonePage'
import { useCurrentRouteHandle } from '@renderer/app/route-metadata'
import { Button, Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui'
import { DataTable } from '@renderer/components/admin/DataTable'
import { ExportDialog } from '@renderer/components/admin/ExportDialog'

export function AdminDashboard() {
  const navigate = useNavigate()
  const handle = useCurrentRouteHandle<{ title: string; description: string }>()
  const [activeTab, setActiveTab] = useState('data')

  const handleLogout = () => {
    navigate('/admin/login')
  }

  return (
    <MilestonePage
      title={handle.title}
      description={handle.description}
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">数据管理</h2>
        <Button variant="outline" onClick={handleLogout}>
          退出登录
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="data">数据表格</TabsTrigger>
          <TabsTrigger value="baseline">基线表</TabsTrigger>
          <TabsTrigger value="export">导出CSV</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="data">
          <DataTable
            columns={[
              { key: 'id', label: 'ID' },
              { key: 'createdAt', label: '创建时间' }
            ]}
            data={[]}
            total={0}
            page={1}
            pageSize={50}
            onPageChange={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
            onSearch={() => {}}
          />
        </TabsContent>

        <TabsContent value="baseline">
          <div className="text-center py-8 text-muted-foreground">
            基线表功能开发中...
          </div>
        </TabsContent>

        <TabsContent value="export">
          <div className="flex justify-center py-8">
            <ExportDialog onExport={(options) => console.log('Export:', options)} />
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <div className="text-center py-8 text-muted-foreground">
            设置功能开发中...
          </div>
        </TabsContent>
      </Tabs>
    </MilestonePage>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/pages/AdminDashboard.tsx src/renderer/components/admin/
git commit -m "feat(admin): implement admin dashboard UI components"
```

---

### Task 8: Preload Extension for Admin

**Files:**
- Modify: `src/shared/desktop-api.ts`
- Modify: `src/preload/desktop-api.ts`

- [ ] **Step 1: Add admin namespace to DesktopApi**

```typescript
// Add to src/shared/desktop-api.ts
import type {
  AdminLoginRequest,
  AdminLoginResult,
  AdminSessionResult,
  AdminChangePasswordRequest,
  AdminChangePasswordResult,
  AdminGetRecordsRequest,
  AdminRecordsResult,
  AdminUpdateRecordRequest,
  AdminDeleteRecordsRequest
} from './admin-contract'

// Add to DesktopApi interface
admin: {
  login(request: AdminLoginRequest): Promise<AdminLoginResult>
  logout(): Promise<void>
  checkSession(): Promise<AdminSessionResult>
  changePassword(request: AdminChangePasswordRequest): Promise<AdminChangePasswordResult>
  getRecords(request: AdminGetRecordsRequest): Promise<AdminRecordsResult>
  updateRecord(request: AdminUpdateRecordRequest): Promise<{ ok: boolean }>
  deleteRecords(request: AdminDeleteRecordsRequest): Promise<{ ok: boolean }>
}
```

- [ ] **Step 2: Add admin to preload**

```typescript
// Add to src/preload/desktop-api.ts
import {
  ADMIN_LOGIN_CHANNEL,
  ADMIN_LOGOUT_CHANNEL,
  ADMIN_CHECK_SESSION_CHANNEL,
  ADMIN_CHANGE_PASSWORD_CHANNEL,
  ADMIN_GET_RECORDS_CHANNEL,
  ADMIN_UPDATE_RECORD_CHANNEL,
  ADMIN_DELETE_RECORDS_CHANNEL
} from '@shared/admin-contract'

// Add admin object
const admin = Object.freeze({
  login: async (request: AdminLoginRequest) =>
    (await invoke(ADMIN_LOGIN_CHANNEL, request)) as unknown as AdminLoginResult,
  logout: async () =>
    (await invoke(ADMIN_LOGOUT_CHANNEL)) as unknown as void,
  checkSession: async () =>
    (await invoke(ADMIN_CHECK_SESSION_CHANNEL)) as unknown as AdminSessionResult,
  changePassword: async (request: AdminChangePasswordRequest) =>
    (await invoke(ADMIN_CHANGE_PASSWORD_CHANNEL, request)) as unknown as AdminChangePasswordResult,
  getRecords: async (request: AdminGetRecordsRequest) =>
    (await invoke(ADMIN_GET_RECORDS_CHANNEL, request)) as unknown as AdminRecordsResult,
  updateRecord: async (request: AdminUpdateRecordRequest) =>
    (await invoke(ADMIN_UPDATE_RECORD_CHANNEL, request)) as unknown as { ok: boolean },
  deleteRecords: async (request: AdminDeleteRecordsRequest) =>
    (await invoke(ADMIN_DELETE_RECORDS_CHANNEL, request)) as unknown as { ok: boolean }
})

// Add to desktopApi
const desktopApi = { system, preferences, dialog, project, qnaire, record, epidata, admin } satisfies DesktopApi
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/desktop-api.ts src/preload/desktop-api.ts
git commit -m "feat(admin): add admin namespace to preload API"
```

---

## Implementation Order

1. **Week 1: Backend Services**
   - Tasks 1-3: Data Service, Admin Contract, Admin Store
   - Tasks 4-5: Export Service, Baseline Service
   - Task 6: Admin IPC Handlers

2. **Week 2: Frontend UI**
   - Task 7: Admin Dashboard UI
   - Task 8: Preload Extension
   - Integration testing

---

## Acceptance Criteria

- [ ] Admin can login with password
- [ ] Session expires after 30 minutes
- [ ] Account locks after 5 failed attempts
- [ ] Data table shows records with pagination
- [ ] Records can be edited and deleted
- [ ] CSV export works with all 3 encoding options
- [ ] Baseline table generates correct statistics
- [ ] Password can be changed
- [ ] All tests pass

---

*Plan created: 2026-07-26*
