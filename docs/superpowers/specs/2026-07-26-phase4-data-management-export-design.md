# Phase 4: Data Management & Export Design

> **Version**: v1.0
> **Date**: 2026-07-26
> **Status**: Design Complete

---

## 1. Overview

Phase 4 implements the data management and export functionality, including:
- Admin authentication with password protection
- Data table view with CRUD operations
- CSV export with multiple encoding options for multi-choice questions
- Baseline characteristics table generation
- Password management

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Admin Dashboard                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │DataTable │ │ Baseline │ │   CSV    │ │ Settings │       │
│  │   Tab    │ │   Tab    │ │  Export  │ │   Tab    │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       │             │            │             │             │
│  ┌────▼─────────────▼────────────▼─────────────▼─────┐      │
│  │                  Admin Store                       │      │
│  │  (auth, session, data operations)                  │      │
│  └───────────────────────┬─────────────────────────────┘      │
│                          │                                    │
│  ┌───────────────────────▼─────────────────────────────┐      │
│  │                  Data Service                        │      │
│  │  (query, filter, pagination, export, baseline)       │      │
│  └─────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Components

### 3.1 Admin Authentication

**PasswordGate Component:**
- Password input with show/hide toggle
- Lockout after 5 failed attempts (5 minute cooldown)
- Session timeout after 30 minutes of inactivity
- Password strength indicator

**admin.store.ts:**
- `isAuthenticated`: boolean
- `sessionExpiresAt`: timestamp
- `lockoutUntil`: timestamp | null
- `login(password)`: Promise<boolean>
- `logout()`: void
- `checkSession()`: boolean

### 3.2 Data Table

**DataTable Component (TanStack Table):**
- Sortable columns
- Filterable by column
- Pagination (50 rows per page)
- Column width resize
- Row selection for bulk operations
- Edit/Delete actions per row

**Data Service:**
- `getRecords(options)`: PaginatedResult
- `updateRecord(id, data)`: Promise<void>
- `deleteRecords(ids)`: Promise<void>
- `getRecordCount()`: Promise<number>

### 3.3 CSV Export

**ExportDialog Component:**
- Export scope: All records / Filtered records
- Multi-choice encoding options:
  - Multi-category (default): Keep original format
  - One-Hot Encoding: Each option as separate 0/1 column
  - Dummy Encoding: k-1 columns with reference category
- Reference category selection for dummy encoding
- Column count preview
- Export button with progress

**ExportService:**
- `exportCSV(options)`: Promise<ExportResult>
- `generateDataDictionary()`: Promise<string>
- `transformEncoding(data, encoding)`: TransformedData

### 3.4 Baseline Table

**BaselineService:**
- `classifyVariable(variable, data)`: VariableType
- `calculateStatistics(data, type, groups)`: Statistics
- `generateBaselineTable(options)`: BaselineTable

**BaselineTablePage:**
- Group variable selector
- Variable selector (default: all)
- Statistical method selector (auto/manual)
- Table preview
- Export to CSV

---

## 4. Data Flow

### 4.1 Export Flow
```
User clicks Export → ExportDialog opens
  → Select encoding option
  → Preview column count
  → Click Export
  → ExportService.transformEncoding(data, encoding)
  → Generate CSV with UTF-8 BOM
  → Generate data dictionary
  → Save to exports/ folder
```

### 4.2 Baseline Flow
```
User clicks Baseline → BaselineTablePage opens
  → Select group variable (optional)
  → Select variables to include
  → Click Generate
  → BaselineService.classifyVariable() for each
  → BaselineService.calculateStatistics()
  → Render table preview
  → Export to CSV
```

---

## 5. Type Definitions

```typescript
// Export options
interface ExportOptions {
  scope: 'all' | 'filtered'
  encoding: 'multi_category' | 'one_hot' | 'dummy'
  dummyReference?: 'first' | 'last' | string
  filterCriteria?: FilterCriteria
}

// Baseline options
interface BaselineOptions {
  groupVariable?: string
  variables: string[]
  statisticalMethod: 'auto' | 'manual'
}

// Variable types for baseline
enum VariableType {
  CONTINUOUS = 'continuous',
  BINARY = 'binary',
  CATEGORICAL = 'categorical',
  ORDINAL = 'ordinal',
  TEXT = 'text',
  DATE = 'date',
  ID = 'id'
}

// Statistics result
interface Statistics {
  mean?: number
  sd?: number
  median?: number
  iqr?: [number, number]
  counts?: Record<string, number>
  percentages?: Record<string, number>
  pValue?: number
  testUsed?: string
}
```

---

## 6. UI Layout

### 6.1 Admin Dashboard

```
┌──────────────────────────────────────────────────────────────┐
│  管理后台                                          [退出登录] │
├──────────────────────────────────────────────────────────────┤
│  [数据表格]  [基线表]  [导出CSV]  [设置]                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  筛选: [___________]  列: [全部▼]  每页: [50▼]       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  │ ID │ 变量1 │ 变量2 │ ... │ 操作 │                 │   │
│  │  ├────┼───────┼───────┼─────┼──────┤                 │   │
│  │  │ 1  │ data  │ data  │ ... │ 编辑 │                 │   │
│  │  │ 2  │ data  │ data  │ ... │ 编辑 │                 │   │
│  │  └────┴───────┴───────┴─────┴──────┘                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  共 1250 条  [< 1 2 3 ... 25 >]                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [删除选中]  [导出CSV]  [生成基线表]                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Acceptance Criteria

- [ ] Admin can login with password
- [ ] Session expires after 30 minutes
- [ ] Account locks after 5 failed attempts
- [ ] Data table shows all records with pagination
- [ ] Records can be edited and deleted
- [ ] CSV export works with all 3 encoding options
- [ ] Data dictionary is generated with export
- [ ] Baseline table generates correct statistics
- [ ] Baseline table supports grouping variable
- [ ] All data is encrypted at rest

---

*Design document complete.*
