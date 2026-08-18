# M5 EpiData兼容层设计

> **版本**: v1.0
> **日期**: 2026-07-26
> **状态**: 设计完成，待实现

---

## 1. 概述

M5阶段实现EpiData兼容层，包括.qes和.rec文件解析器、导入服务编排、导入向导UI。采用自底向上实现策略，先实现解析器，再实现导入服务，最后实现UI。

### 1.1 设计目标

- 完整解析EpiData 3.1 .qes问卷定义文件
- 完整解析EpiData .rec二进制数据文件
- 提供用户友好的导入向导界面
- 支持EpiData Manager格式兼容
- 自动检测字符编码（UTF-8/GBK/Latin-1）

### 1.2 核心组件

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| QESParser | 解析.qes问卷定义文件 | `src/main/services/qes-parser.ts` |
| RECParser | 解析.rec二进制数据文件 | `src/main/services/rec-parser.ts` |
| ImportService | 编排导入流程 | `src/main/services/import.service.ts` |
| ImportWizard | 前端导入向导UI | `src/renderer/components/import/` |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    ImportWizard UI                       │
│  (FileSelector → ImportPreview → MappingEditor)         │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│                 ImportService                            │
│  (编排：解析.qes → 创建问卷结构 → 解析.rec → 导入数据)    │
└───────┬───────────────────────┬─────────────────────────┘
        │                       │
┌───────▼──────┐         ┌──────▼──────┐
│   QESParser  │         │   RECParser  │
│ (.qes解析器) │         │ (.rec解析器) │
└──────────────┘         └─────────────┘
```

**数据流：**
1. 用户选择.qes文件
2. 系统自动查找同名.rec文件
3. QESParser解析.qes生成问卷结构
4. RECParser解析.rec生成数据记录
5. ImportService将数据转换为EasyEpi格式
6. 保存到新的EasyEpi项目文件

---

## 3. QES解析器设计

### 3.1 核心接口

```typescript
// 新增文件：src/shared/types/epidata.ts

export enum QESFieldType {
  INTEGER = 'INTEGER',
  DECIMAL = 'DECIMAL',
  TEXT = 'TEXT',
  UPPERCASE = 'UPPERCASE',
  BOOLEAN = 'BOOLEAN',
  DATE_DMY = 'DATE_DMY',
  DATE_MDY = 'DATE_MDY',
  TODAY_DATE = 'TODAY_DATE',
  SOUNDEX = 'SOUNDEX',
  ID_NUMBER = 'ID_NUM'
}

export interface QESField {
  name: string
  label: string
  type: QESFieldType
  length: number
  decimals: number
  comment: string | null
}

export interface QESBlock {
  type: 'LABEL' | 'JUMPS' | 'RANGE' | 'LEGAL' | 'MUSTENTER' | 'COMMENT' | 'TYPE' | 'VALUELABEL' | 'JUMPS' | 'GOTO' | 'END'
  content: string
}

export interface QESParseResult {
  metadata: { title: string; version?: string }
  fields: QESField[]
  blocks: QESBlock[]
}
```

### 3.2 类型映射规则

| EpiData类型 | EasyEpi类型 | 转换规则 |
|------------|------------|----------|
| `##` (整数) | `numeric_range` | 约束类型为`integer` |
| `#.##` (小数) | `numeric_range` | 约束类型为`decimal` |
| `_____` (文本) | `free_text` | 无长度限制 |
| `<A>` (大写) | `fixed_length` | 约束类型为`english` |
| `<Y>` (布尔) | `single_choice` | 选项为"是/否" |
| `<dd/mm/yyyy>` | `date` | 日期格式DMY |
| `<mm/dd/yyyy>` | `date` | 日期格式MDY |

### 3.3 解析流程

1. 读取.qes文件内容
2. 解析文件头（标题）
3. 逐行解析字段定义
4. 解析LABEL/JUMPS/RANGE/LEGAL等块
5. 转换为EasyEpi格式

---

## 4. REC解析器设计

### 4.1 核心接口

```typescript
// 在src/shared/types/epidata.ts中新增

export interface RECHeader {
  fileType: string
  fieldCount: number
  fields: RECFieldInfo[]
}

export interface RECFieldInfo {
  name: string
  type: string
  length: number
  decimals: number
}

export interface RECRecord {
  status: 'normal' | 'deleted'
  fields: Record<string, string>
}

export interface RECParseResult {
  header: RECHeader
  records: RECRecord[]
  deletedCount: number
  encoding: string
}
```

### 4.2 二进制格式结构

```
[Header]
  - File type marker (4 bytes)
  - Field count (2 bytes)
  - For each field:
    - Field name (10 bytes)
    - Field type (1 byte)
    - Field length (2 bytes)
    - Decimal places (1 byte)

[Records]
  - Each record: fixed-width sequence of field values
  - Record status byte (0x20 = normal, other = deleted)
  - Fields are stored as ASCII text, left/right justified

[End of File]
  - EOF marker
```

### 4.3 编码检测策略

1. 尝试UTF-8解码
2. 如果失败，尝试GBK解码
3. 如果仍失败，使用Latin-1作为fallback
4. 允许用户手动选择编码

### 4.4 解析流程

1. 读取.rec文件二进制内容
2. 解析文件头（字段信息）
3. 逐条读取记录
4. 根据字段定义提取字段值
5. 处理字符编码
6. 转换为EasyEpi的RecordData格式

---

## 5. ImportService设计

### 5.1 核心接口

```typescript
// 新增文件：src/main/services/import.service.ts

export interface ImportOptions {
  qesFilePath: string
  recFilePath?: string
  targetProjectPath: string
  encoding?: string
  onProgress?: (progress: ImportProgress) => void
}

export interface ImportProgress {
  stage: 'parsing_qes' | 'parsing_rec' | 'creating_project' | 'importing_data'
  current: number
  total: number
  message: string
}

export interface ImportResult {
  success: boolean
  projectPath: string
  questionnaire: QuestionnaireDef
  recordCount: number
  warnings: string[]
  errors: string[]
}

export class ImportService {
  async importEpiData(options: ImportOptions): Promise<ImportResult>
  async previewImport(qesFilePath: string): Promise<ImportPreview>
  async validateQES(qesFilePath: string): Promise<ValidationResult>
}
```

### 5.2 导入流程

1. **验证阶段**：检查文件是否存在、格式是否正确
2. **解析QES**：调用QESParser解析问卷定义
3. **查找REC**：自动查找同名.rec文件
4. **解析REC**：调用RECParser解析数据记录
5. **创建项目**：创建新的EasyEpi项目文件夹
6. **转换数据**：将EpiData格式转换为EasyEpi格式
7. **保存数据**：加密保存到新的项目文件

### 5.3 错误处理

- 文件不存在或格式错误
- 编码检测失败
- 字段映射冲突
- 数据损坏或截断

### 5.4 进度反馈

- 通过onProgress回调报告进度
- 支持大文件分批处理（>10000条记录）

---

## 6. ImportWizard UI设计

### 6.1 组件结构

```
ImportWizard
├── FileSelector (文件选择)
├── ImportPreview (导入预览)
├── MappingEditor (映射编辑)
└── ProgressBar (进度条)
```

### 6.2 页面流程

1. **文件选择页**：用户选择.qes文件
2. **预览页**：显示解析结果和映射信息
3. **映射编辑页**：允许手动修正映射
4. **导入进度页**：显示导入进度

### 6.3 FileSelector组件

- 文件选择器，筛选.qes文件
- 自动查找同名.rec文件
- 显示文件路径和状态

### 6.4 ImportPreview组件

- 问卷名称、题目总数、变量总数
- 数据记录数、Key字段、跳题规则
- EpiData版本自动检测
- 编码检测结果显示

### 6.5 MappingEditor组件

- 显示字段映射表格
- 变量名、原类型、映射为、状态
- ⚠️标记需要手动确认的题目
- 点击可手动修改映射

### 6.6 UI设计规范

- 遵循现有的设计系统（Tailwind CSS + Radix UI）
- 使用现有的Modal、Button、Table等组件
- 支持键盘导航和无障碍访问

---

## 7. IPC和集成设计

### 7.1 IPC通道定义

```typescript
// 新增文件：src/shared/epidata-contract.ts

export const EPIDATA_IMPORT_CHANNEL = 'epidata:import' as const
export const EPIDATA_PREVIEW_CHANNEL = 'epidata:preview' as const
export const EPIDATA_VALIDATE_CHANNEL = 'epidata:validate' as const

export const ALL_EPIDATA_CHANNELS = [
  EPIDATA_IMPORT_CHANNEL,
  EPIDATA_PREVIEW_CHANNEL,
  EPIDATA_VALIDATE_CHANNEL
] as const

export type EpiDataChannel = (typeof ALL_EPIDATA_CHANNELS)[number]

// 请求/响应类型
export interface EpiDataImportRequest {
  qesFilePath: string
  recFilePath?: string
  targetProjectPath: string
  encoding?: string
}

export interface EpiDataImportResult {
  success: boolean
  projectPath: string
  recordCount: number
  warnings: string[]
  errors: string[]
}

export interface EpiDataPreviewRequest {
  qesFilePath: string
}

export interface EpiDataPreviewResult {
  questionnaire: QuestionnaireDef
  fieldCount: number
  recordCount?: number
  encoding?: string
  version?: string
}
```

### 7.2 IPC处理器

```typescript
// 新增文件：src/main/ipc/epidata.ipc.ts

export function registerEpiDataIpcHandlers(): void {
  ipcMain.handle(EPIDATA_IMPORT_CHANNEL, async (event, request) => {
    assertTrustedSender(event)
    return importService.importEpiData(request)
  })

  ipcMain.handle(EPIDATA_PREVIEW_CHANNEL, async (event, request) => {
    assertTrustedSender(event)
    return importService.previewImport(request.qesFilePath)
  })

  ipcMain.handle(EPIDATA_VALIDATE_CHANNEL, async (event, request) => {
    assertTrustedSender(event)
    return importService.validateQES(request.qesFilePath)
  })
}
```

### 7.3 Preload扩展

```typescript
// 在src/preload/desktop-api.ts中扩展

epidata: {
  import: (request: EpiDataImportRequest) => ipcRenderer.invoke(EPIDATA_IMPORT_CHANNEL, request),
  preview: (request: EpiDataPreviewRequest) => ipcRenderer.invoke(EPIDATA_PREVIEW_CHANNEL, request),
  validate: (request: EpiDataPreviewRequest) => ipcRenderer.invoke(EPIDATA_VALIDATE_CHANNEL, request)
}
```

### 7.4 集成测试

- E2E测试：导入.qes + .rec → 验证问卷结构 + 数据完整性
- 单元测试：.qes解析器、.rec解析器、导入服务

---

## 8. 文件结构

| 文件 | 职责 |
|------|------|
| `src/shared/types/epidata.ts` | EpiData相关类型定义 |
| `src/shared/epidata-contract.ts` | IPC通道定义和解析器 |
| `src/main/services/qes-parser.ts` | .qes文件解析器 |
| `src/main/services/rec-parser.ts` | .rec二进制数据解析器 |
| `src/main/services/import.service.ts` | 导入服务编排 |
| `src/main/ipc/epidata.ipc.ts` | IPC处理器 |
| `src/preload/desktop-api.ts` | Preload扩展（epidata命名空间） |
| `src/renderer/components/import/FileSelector.tsx` | 文件选择组件 |
| `src/renderer/components/import/ImportPreview.tsx` | 导入预览组件 |
| `src/renderer/components/import/MappingEditor.tsx` | 映射编辑组件 |
| `src/renderer/components/import/ImportWizard.tsx` | 导入向导主组件 |
| `src/renderer/pages/ImportPage.tsx` | 导入页面 |
| `tests/unit/main/services/qes-parser.test.ts` | .qes解析器单元测试 |
| `tests/unit/main/services/rec-parser.test.ts` | .rec解析器单元测试 |
| `tests/unit/main/services/import.service.test.ts` | 导入服务单元测试 |
| `tests/e2e/import.spec.ts` | E2E导入测试 |

---

## 9. 实现顺序

### 第1周：QES解析器
1. 创建EpiData类型定义
2. 实现QESParser
3. 编写.qes解析单元测试

### 第2周：REC解析器 + 导入服务
1. 实现RECParser
2. 编写.rec解析单元测试
3. 实现ImportService
4. 实现EpiData IPC处理器

### 第3周：导入UI + 集成测试
1. 实现ImportWizard组件
2. 实现ImportPage
3. 编写E2E导入测试
4. 处理边界情况和错误处理

---

## 10. 验收标准

### 功能验收
- [ ] 能够解析EpiData 3.1 .qes文件
- [ ] 能够解析EpiData .rec文件
- [ ] 能够自动检测字符编码
- [ ] 能够创建EasyEpi项目并导入数据
- [ ] 导入向导UI完整可用

### 测试验收
- [ ] .qes解析器单元测试通过
- [ ] .rec解析器单元测试通过
- [ ] 导入服务单元测试通过
- [ ] E2E导入测试通过

### 性能验收
- [ ] 能够处理>10000条记录的大文件
- [ ] 导入进度反馈正常工作
- [ ] 内存使用合理，无内存泄漏

---

## 11. 风险与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|----------|
| EpiData格式不完全兼容 | 中 | 高 | 广泛收集各版本测试样本，保守解析 |
| 字符编码检测失败 | 中 | 中 | 提供手动编码选择，fallback到Latin-1 |
| 大文件内存溢出 | 低 | 高 | 实现分批处理，流式读取 |
| 字段映射冲突 | 中 | 中 | 提供手动映射修正功能 |

---

*本文档将随项目推进持续更新。*