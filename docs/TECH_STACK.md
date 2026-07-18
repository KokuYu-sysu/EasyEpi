# EasyEpi — 技术栈文档

> **版本**: v1.1  
> **日期**: 2026-07-17  
> **状态**: 已更新（新增衍生变量公式引擎、多选题编码导出引擎）  

---

## 目录

1. [技术选型总览](#1-技术选型总览)
2. [技术选型理由](#2-技术选型理由)
3. [系统架构](#3-系统架构)
4. [前端架构](#4-前端架构)
5. [后端架构（主进程）](#5-后端架构主进程)
6. [数据层设计](#6-数据层设计)
7. [安全架构](#7-安全架构)
8. [EpiData 文件解析方案](#8-epidata-文件解析方案)
9. [基线表生成引擎](#9-基线表生成引擎)
10. [衍生变量公式引擎](#10-衍生变量公式引擎)
11. [多选题编码导出引擎](#11-多选题编码导出引擎)
12. [项目结构与目录规范](#12-项目结构与目录规范)
13. [开发环境与工具链](#13-开发环境与工具链)
14. [测试策略](#14-测试策略)
15. [构建与发布](#15-构建与发布)

---

## 1. 技术选型总览

| 层级 | 技术 | 版本要求 | 用途 |
|------|------|----------|------|
| **桌面框架** | Electron | ≥ 28.x | 跨平台桌面容器 |
| **前端框架** | React | 18.x | UI 渲染 |
| **类型系统** | TypeScript | 5.x | 全栈类型安全 |
| **样式方案** | Tailwind CSS | 3.x | 原子化 CSS |
| **UI 组件库** | Radix UI (Headless) | latest | 无样式无障碍组件 |
| **状态管理** | Zustand | 4.x | 轻量级状态管理 |
| **本地数据库** | SQLite (via better-sqlite3) | 3.x | 项目配置与索引存储 |
| **加密库** | Node.js `crypto` (内置) | — | AES-256-GCM, PBKDF2 |
| **密码哈希** | `@noble/hashes` (argon2) | latest | Argon2id 密码哈希 |
| **图标库** | Lucide React | latest | 线性图标 |
| **表格组件** | TanStack Table (React Table) | 8.x | 数据表格（管理后台） |
| **图表/流程图** | D3.js | 7.x | 条件逻辑流程图 |
| **CSV 生成** | `json2csv` | latest | 数据导出 |
| **文件解析** | 自定义解析器 | — | .qes / .rec 二进制解析 |
| **构建工具** | Electron Vite | latest | 打包与构建 |
| **测试框架** | Vitest + Playwright | latest | 单元测试 + E2E |
| **代码质量** | ESLint + Prettier | latest | 代码规范 |
| **包管理** | pnpm | 8.x | 依赖管理 |

---

## 2. 技术选型理由

### 2.1 桌面框架: Electron（而非 Tauri / PyQt / WPF）

| 维度 | Electron | Tauri | PyQt | WPF | 结论 |
|------|----------|-------|------|-----|------|
| Windows 兼容 | ✅ 优秀 | ✅ 良好 | ⚠️ 打包复杂 | ✅ 原生 | — |
| macOS 兼容 | ✅ 优秀 | ✅ 良好 | ⚠️ 打包复杂 | ❌ 不支持 | — |
| 生态成熟度 | ✅ 非常成熟 | ⚠️ 快速发展中 | ✅ 成熟 | ✅ 成熟 | — |
| 应用体积 | ❌ 150MB+ | ✅ ~10MB | ⚠️ ~80MB | ✅ ~50MB | Tauri 胜 |
| 内存占用 | ⚠️ 150-200MB | ✅ ~80MB | ✅ 低 | ✅ 低 | Tauri 胜 |
| 开发者可得性 | ✅ 前端开发者多 | ⚠️ 需 Rust | ⚠️ Python+Qt 人才少 | ⚠️ C# 人才有限 | **Electron 胜** |
| Node.js 生态 | ✅ npm 极其丰富 | ⚠️ Rust 生态较小 | ❌ pip 受限 | ❌ NuGet 受限 | **Electron 胜** |
| Crypto 能力 | ✅ Node.js 内置 | ⚠️ 需 Rust crate | ✅ PyCryptodome | ✅ .NET 内置 | — |
| SQLite 绑定 | ✅ better-sqlite3 | ✅ 内置 | ✅ sqlite3 | ✅ System.Data | — |
| UI 开发效率 | ✅ React 生态 | ✅ React 生态 | ⚠️ Qt Designer | ⚠️ XAML | — |

**选型结论**: **Electron** 在第一阶段是最务实的选择。尽管包体积和内存占用不如 Tauri，但：
1. 流行病学研究者通常使用性能不差的电脑（16GB+ 内存标准），200MB 内存占用可接受
2. Node.js 加密模块 `crypto` 是经过审计的内置模块，安全性有保障
3. 前端开发者招聘更容易，降低长期维护成本
4. 应用体积（~150MB）在现代宽带下可接受

**远期考虑**: 若产品成熟后对体积和性能有更高要求，可将渲染层迁移至 **Tauri**。前端 React 代码可复用，仅需重写主进程逻辑（TypeScript → Rust）。

### 2.2 前端框架: React + TypeScript

- **React 18**: 生态最丰富的 UI 框架，组件化开发适合问卷这种表单密集型应用
- **TypeScript**: 问卷数据结构复杂（变量定义、条件规则、值标签映射），类型安全可显著减少运行时错误
- **Zustand**: 比 Redux 轻量得多，API 简洁，适合中等复杂度的状态管理（问卷设计状态、录入状态）

### 2.3 数据库: SQLite

- **零配置**: 不需要安装数据库服务
- **单文件存储**: 适合项目文件管理的场景
- **better-sqlite3**: 同步 API，比异步 sqlite3 更适合 Electron 主进程（无回调地狱）
- **加密**: SQLite 文件本身存储非敏感索引数据（题目顺序、用户偏好），敏感数据通过应用层加密后存储为独立二进制文件

> **关键设计决策**: SQLite 仅存储非敏感的**元数据与索引**（问卷结构、题目顺序、最近项目列表、用户偏好）。**核心数据（问卷答案）以 AES-256-GCM 加密的二进制文件独立存储**，不经过 SQLite。这样即使 SQLite 文件被直接读取，也无法获取任何敏感信息。

### 2.4 加密方案: Node.js `crypto` 模块

选择 Node.js 内置模块而非第三方库的理由：
- **审计**: Node.js `crypto` 使用 OpenSSL，经过 FIPS 140-2 认证
- **零依赖**: 不引入额外的 native module 依赖
- **维护性**: 随 Node.js 版本升级自动获得安全补丁

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron 应用                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   渲染进程 (Renderer)                  │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────────┐   │  │
│  │  │  React  │  │ Zustand  │  │ React Router        │   │  │
│  │  │ 组件树  │  │ 状态管理  │  │ (页面路由)         │   │  │
│  │  └────┬────┘  └────┬─────┘  └─────────┬──────────┘   │  │
│  │       │            │                   │               │  │
│  │       └────────────┼───────────────────┘               │  │
│  │                    │                                   │  │
│  │         ┌──────────▼──────────────┐                    │  │
│  │         │     Service Layer       │                    │  │
│  │         │  (API 调用封装, 缓存)    │                    │  │
│  │         └──────────┬──────────────┘                    │  │
│  └────────────────────┼──────────────────────────────────┘  │
│                       │                                     │
│           contextBridge / IPC (进程间通信)                   │
│                       │                                     │
│  ┌────────────────────┼──────────────────────────────────┐  │
│  │                    ▼                                   │  │
│  │                 主进程 (Main Process)                   │  │
│  │                                                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │  │
│  │  │ 文件管理  │  │ 加密模块  │  │ EpiData 解析器   │    │  │
│  │  │ (fs/path) │  │ (crypto) │  │ (.qes/.rec)      │    │  │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘    │  │
│  │       │             │                  │              │  │
│  │       └─────────────┼──────────────────┘              │  │
│  │                     │                                 │  │
│  │         ┌───────────▼──────────────┐                  │  │
│  │         │      Data Access Layer    │                  │  │
│  │         │  ┌─────────┐ ┌─────────┐ │                  │  │
│  │         │  │ SQLite  │ │ Encrypt │ │                  │  │
│  │         │  │ (元数据) │ │ File IO │ │                  │  │
│  │         │  └─────────┘ └─────────┘ │                  │  │
│  │         └───────────┬──────────────┘                  │  │
│  └─────────────────────┼─────────────────────────────────┘  │
│                        │                                    │
└────────────────────────┼────────────────────────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
    ┌──────────────┐         ┌──────────────┐
    │ 项目文件系统  │         │  应用配置     │
    │              │         │              │
    │ .easyepi     │         │ ~/AppData/   │
    │ .easyepi_data│         │ Roaming/     │
    │ .easyepi_db  │         │ EasyEpi/     │
    └──────────────┘         └──────────────┘
```

### 3.2 进程通信协议

Electron 主进程与渲染进程通过 `contextBridge` + `ipcRenderer/ipcMain` 通信，定义严格的类型化 API：

```typescript
// 类型定义: src/shared/ipc-api.ts

// 渲染进程 → 主进程（异步调用）
interface IPCApi {
  // 项目管理
  'project:create': (name: string, folderPath: string) => Promise<ProjectMeta>;
  'project:open': (filePath: string) => Promise<ProjectData>;
  'project:save': (data: ProjectData) => Promise<void>;

  // 问卷设计
  'qnaire:addQuestion': (question: QuestionDef) => Promise<QuestionDef>;
  'qnaire:updateQuestion': (id: string, q: Partial<QuestionDef>) => Promise<void>;
  'qnaire:deleteQuestion': (id: string) => Promise<void>;
  'qnaire:reorderQuestions': (ids: string[]) => Promise<void>;
  'qnaire:addConditionRule': (rule: ConditionRule) => Promise<void>;

  // EpiData 导入
  'epidata:parseQES': (filePath: string) => Promise<QESParseResult>;
  'epidata:parseREC': (filePath: string, schema: QESSchema) => Promise<RECParseResult>;
  'epidata:import': (qesPath: string, targetFolder: string) => Promise<ImportResult>;

  // 数据录入
  'entry:saveAnswer': (questionId: string, value: AnswerValue) => Promise<void>;
  'entry:submitRecord': (record: RecordData) => Promise<SubmitResult>;
  'entry:getProgress': () => Promise<EntryProgress>;

  // 加密与安全
  'auth:setPassword': (password: string) => Promise<void>;
  'auth:verifyPassword': (password: string) => Promise<boolean>;
  'auth:changePassword': (oldPw: string, newPw: string) => Promise<void>;

  // 数据导出
  'export:toCSV': (options: ExportOptions) => Promise<string>;
  'export:baselineTable': (options: BaselineOptions) => Promise<BaselineResult>;

  // 衍生变量
  'derived:addVariable': (variable: DerivedVarDef) => Promise<DerivedVarDef>;
  'derived:updateVariable': (id: string, v: Partial<DerivedVarDef>) => Promise<void>;
  'derived:deleteVariable': (id: string) => Promise<void>;
  'derived:validateFormula': (formula: string, variables: VariableDef[]) => Promise<FormulaValidation>;
  'derived:previewResult': (formula: string, testRecord: RecordData) => Promise<PreviewResult>;
  'derived:computeAll': (record: RecordData) => Promise<Record<string, unknown>>;

  // 数据导出（扩展）
  'export:toCSV': (options: ExportOptions) => Promise<string>;
  'export:getMultiChoiceColumns': (questionId: string, encoding: EncodingType) => Promise<ColumnInfo[]>;
  'export:baselineTable': (options: BaselineOptions) => Promise<BaselineResult>;

  // 数据管理
  'data:getRecords': (filters: DataFilter, pagination: Pagination) => Promise<PaginatedRecords>;
  'data:updateRecord': (recordId: string, updates: Record<string, AnswerValue>) => Promise<void>;
  'data:deleteRecords': (recordIds: string[]) => Promise<void>;
}

// 主进程 → 渲染进程（事件推送）
interface IPCEvents {
  'auto-save': () => void;
  'backup-complete': (backupPath: string) => void;
  'session-locked': () => void;
}
```

---

## 4. 前端架构

### 4.1 组件树

```
App
├── WelcomePage (欢迎页)
│   ├── NewProjectCard
│   ├── OpenProjectCard
│   ├── ImportEpiDataCard
│   └── RecentProjectsList
│       └── RecentProjectItem × N
│
├── DesignerPage (问卷设计页)
│   ├── DesignerToolbar (工具栏)
│   │   ├── AddQuestionButton
│   │   ├── ImportButton
│   │   └── KeyIndicator (Key 计数)
│   ├── QuestionList (题目列表)
│   │   └── QuestionRow × N (可拖拽排序)
│   │       ├── KeyBadge (条件)
│   │       ├── ConditionBadge
│   │       └── QuestionTypeIcon
│   ├── QuestionActionBar (操作栏)
│   ├── ConditionPreview (条件预览)
│   └── QuestionEditDialog (编辑对话框 - Modal)
│       ├── TypeSelector (题型选择器)
│       ├── OptionListEditor (选项编辑器)
│       └── ConstraintEditor (约束编辑器)
│
├── EntryPage (录入模式)
│   ├── EntryTopBar (顶栏)
│   │   └── BatchCounter (已录入计数)
│   ├── ProgressBar (进度条)
│   ├── QuestionCard (题目卡片 - 根据题型动态渲染)
│   │   ├── SingleChoiceInput
│   │   ├── MultiChoiceInput
│   │   ├── FixedLengthInput
│   │   ├── FreeTextInput
│   │   └── NumericRangeInput
│   ├── EntryNavBar (底部导航)
│   ├── SubmitConfirmPage (提交确认)
│   └── WorkEndPage (工作结束/循环页)
│       ├── BatchStats (批次统计)
│       └── RecordList (本批次记录列表)
│
├── AdminPage (管理后台)
│   ├── PasswordGate (密码验证)
│   ├── AdminTabs (标签导航)
│   │   ├── DataTableView (数据表格)
│   │   │   └── TanStackTable
│   │   ├── BaselineTablePage (基线表)
│   │   │   ├── VariableSelector
│   │   │   ├── MethodSelector
│   │   │   └── BaselinePreview (表格预览)
│   │   ├── ExportPage (导出)
│   │   └── SettingsPage (设置/修改密码)
│   └── LockTimer (锁定倒计时)
│
├── ImportWizard (EpiData导入向导)
│   ├── FileSelector
│   ├── ImportPreview
│   └── MappingEditor (映射编辑)
│
├── DerivedVariableEditor (衍生变量编辑器)
│   ├── VariableChipList (可用变量卡片列表)
│   ├── DerivedVarCard (已定义衍生变量卡片)
│   │   ├── FormulaBuilder (可视化公式构建器)
│   │   └── FormulaTextEditor (高级文本公式编辑器 + KaTeX 预览)
│   └── FormulaPreview (公式实时预览)
│
├── ExportDialog (CSV导出对话框)
│   ├── ExportRangeSelector (导出范围选择)
│   ├── EncodingSelector (多选题编码方式选择器)
│   │   ├── EncodingOption (编码选项 Radio 组)
│   │   └── ReferenceSelector (哑变量参照类别选择)
│   └── ColumnPreview (导出列数预览)
│
└── Common (通用组件)
    ├── Modal
    ├── Toast / ToastContainer
    ├── ConfirmDialog
    ├── PasswordInput
    ├── EmptyState
    ├── LoadingSkeleton
    ├── Skeleton (骨架屏)
    ├── CountUp (数字递增动画)
    ├── Shimmer (闪烁扫光效果)
    └── ErrorBoundary
```

### 4.2 路由设计

```typescript
// src/renderer/router.tsx
const routes = [
  { path: '/',              component: WelcomePage },
  { path: '/designer',      component: DesignerPage },
  { path: '/entry',         component: EntryPage },
  { path: '/entry/confirm', component: SubmitConfirmPage },
  { path: '/entry/end',     component: WorkEndPage },
  { path: '/admin',         component: PasswordGate },   // 密码验证
  { path: '/admin/dashboard', component: AdminPage },
  { path: '/import',        component: ImportWizard },
];
```

### 4.3 状态管理 (Zustand)

```typescript
// 核心 Store 设计

// 问卷定义 store
interface QnaireStore {
  project: ProjectMeta | null;
  questions: QuestionDef[];
  conditionRules: ConditionRule[];
  // actions
  addQuestion: (q: QuestionDef) => void;
  updateQuestion: (id: string, data: Partial<QuestionDef>) => void;
  deleteQuestion: (id: string) => void;
  reorderQuestions: (fromIdx: number, toIdx: number) => void;
  addConditionRule: (rule: ConditionRule) => void;
}

// 录入状态 store
interface EntryStore {
  currentIndex: number;           // 当前题目在可见列表中的索引（跳过被跳转的题）
  visibleQuestions: QuestionDef[];// 考虑条件逻辑后的可见题目列表
  answers: Map<string, AnswerValue>;
  recordCount: number;            // 本批次已录入
  startTime: number;              // 批次开始时间
  // actions
  goNext: () => void;
  goPrev: () => void;
  setAnswer: (qid: string, value: AnswerValue) => void;
  submitRecord: () => Promise<void>;
  resetForNext: () => void;
}

// 管理员状态 store
interface AdminStore {
  isAuthenticated: boolean;
  lastActivity: number;
  records: RecordData[];
  filters: DataFilter;
  pagination: Pagination;
  // actions
  verifyPassword: (pw: string) => Promise<boolean>;
  lock: () => void;
}
```

---

## 5. 后端架构（主进程）

### 5.1 模块划分

```
src/main/
├── index.ts                    # 主进程入口，窗口管理
├── ipc/
│   ├── project.ipc.ts          # 项目管理相关 IPC 处理
│   ├── qnaire.ipc.ts           # 问卷设计相关 IPC 处理
│   ├── entry.ipc.ts            # 数据录入相关 IPC 处理
│   ├── epidata.ipc.ts          # EpiData 导入相关 IPC 处理
│   ├── derived.ipc.ts          # 衍生变量相关 IPC 处理
│   ├── auth.ipc.ts             # 认证与加密相关 IPC 处理
│   ├── export.ipc.ts           # 数据导出相关 IPC 处理（含编码设置）
│   └── data.ipc.ts             # 数据管理相关 IPC 处理
├── services/
│   ├── project.service.ts      # 项目文件创建/读取/验证
│   ├── qnaire.service.ts       # 问卷结构 CRUD + 逻辑冲突检测
│   ├── entry.service.ts        # 录入数据写入 + 进度管理
│   ├── epidata/
│   │   ├── qes-parser.ts       # .qes 文件解析器
│   │   ├── rec-parser.ts       # .rec 二进制数据解析器
│   │   └── import.service.ts   # 导入编排与映射
│   ├── derived/
│   │   ├── formula-parser.ts   # 公式词法分析 + 语法分析 (AST)
│   │   ├── formula-evaluator.ts# AST 执行引擎 + 类型推断
│   │   └── builtin-functions.ts# 内建函数库 (IF, ROUND, SQRT, DATE_DIFF...)
│   ├── export/
│   │   ├── export.service.ts   # CSV 转换与导出编排
│   │   └── encoding-transformer.ts # 多选题编码转换器
│   ├── auth.service.ts         # 密码哈希/验证、密钥派生
│   ├── crypto.service.ts       # AES-256-GCM 加密/解密
│   ├── baseline.service.ts     # 基线表统计计算
│   └── backup.service.ts       # 自动备份管理
├── db/
│   ├── connection.ts           # SQLite 连接管理
│   ├── migrations/             # 数据库迁移
│   └── repositories/          # 数据访问层
│       ├── qnaire.repo.ts
│       ├── record.repo.ts
│       └── config.repo.ts
├── utils/
│   ├── file-lock.ts            # 文件锁（防止多实例）
│   ├── encoding.ts             # 字符编码检测（UTF-8/GBK/Latin-1）
│   ├── validation.ts           # 通用校验工具
│   └── logger.ts               # 日志（electron-log）
└── preload/
    └── index.ts                # contextBridge 暴露 API
```

### 5.2 关键服务实现要点

#### 5.2.1 CryptoService

```typescript
// 加密服务核心逻辑
class CryptoService {
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_DERIVE_ALGORITHM = 'pbkdf2';
  private readonly PBKDF2_ITERATIONS = 600_000;
  private readonly SALT_LENGTH = 32;
  private readonly IV_LENGTH = 16;
  private readonly TAG_LENGTH = 16;

  /**
   * 从密码派生加密密钥
   */
  deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      password, salt,
      this.PBKDF2_ITERATIONS,
      32, // 256-bit key
      'sha256'
    );
  }

  /**
   * 加密数据: AES-256-GCM
   * 返回: IV(16) + AuthTag(16) + Ciphertext
   */
  encrypt(plaintext: Buffer, key: Buffer): Buffer {
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * 解密数据
   */
  decrypt(ciphertext: Buffer, key: Buffer): Buffer {
    const iv = ciphertext.subarray(0, this.IV_LENGTH);
    const authTag = ciphertext.subarray(this.IV_LENGTH, this.IV_LENGTH + this.TAG_LENGTH);
    const encrypted = ciphertext.subarray(this.IV_LENGTH + this.TAG_LENGTH);
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}
```

#### 5.2.2 AuthService

```typescript
// 密码验证服务
class AuthService {
  /**
   * 设置管理员密码（首次或重置）
   * 使用 Argon2id 哈希密码
   */
  async setPassword(password: string): Promise<void> {
    const salt = crypto.randomBytes(32);
    const hash = await argon2id(password, salt, {
      memoryCost: 65536,  // 64 MB
      timeCost: 3,        // 3 iterations
      parallelism: 4,
    });
    // 存储: salt + hash 到项目配置文件（加密后）
    const storedData = { salt: salt.toString('hex'), hash };
    this.savePasswordData(storedData);
  }

  /**
   * 验证管理员密码
   */
  async verifyPassword(password: string): Promise<boolean> {
    const stored = this.loadPasswordData();
    const hash = await argon2id(password, Buffer.from(stored.salt, 'hex'), { ... });
    return timingSafeEqual(hash, stored.hash);
  }
}
```

---

## 6. 数据层设计

### 6.1 文件格式

#### 6.1.1 项目文件 `.easyepi`（加密）

```
[easyepi_project 文件结构 — AES-256-GCM 加密]
┌──────────────────────────────────────┐
│ Header (64 bytes)                    │
│  - Magic: 0x45 0x50 0x49 0x01       │
│  - Version: uint32                   │
│  - Encrypted JSON payload length     │
│  - Created timestamp                 │
│  - Last modified timestamp           │
│  - Reserved                          │
├──────────────────────────────────────┤
│ Encrypted JSON payload (variable)    │
│  解密后为 JSON:                       │
│  {                                   │
│    "projectName": "...",             │
│    "questions": [                    │
│      {                               │
│        "id": "uuid",                 │
│        "content": "您的性别是？",     │
│        "variableName": "sex",        │
│        "type": "single_choice",      │
│        "options": [                  │
│          {"value": "1", "label":"男"},│
│          {"value": "2", "label":"女"}│
│        ],                            │
│        "constraint": { ... },        │
│        "isKey": false,               │
│        "allowSkip": false,           │
│        "skipValue": null             │
│      }, ...                          │
│    ],                                │
│    "conditionRules": [               │
│      {                               │
│        "id": "uuid",                 │
│        "sourceQuestionId": "uuid",   │
│        "conditions": [               │
│          {                           │
│            "questionId": "uuid",     │
│            "operator": "equals",     │
│            "value": "2"             │
│          }                           │
│        ],                            │
│        "logic": "AND",              │
│        "action": "skip",            │
│        "targetQuestionIds": ["..."] │
│      }                               │
│    ],                                │
│    "keyQuestionIds": ["uuid", ...],  │
│    "passwordHash": { ... },          │
│    "recoveryKeyHash": "...",         │
│    "settings": { ... }               │
│  }                                   │
└──────────────────────────────────────┘
```

#### 6.1.2 数据文件 `.easyepi_data`（加密）

```
[easyepi_data 文件结构 — AES-256-GCM 加密]
┌──────────────────────────────────────┐
│ Header (64 bytes)                    │
│  - Magic: 0x45 0x50 0x44 0x01       │
│  - Version: uint32                   │
│  - Record count: uint32              │
│  - Variable count: uint16            │
│  - Created timestamp                 │
│  - Last modified timestamp           │
│  - Reserved                          │
├──────────────────────────────────────┤
│ Variable schema (variable * N)       │
│  For each variable:                  │
│  - Name length: uint8                │
│  - Name: char[name_length]           │
│  - Type: uint8 (enum)                │
│  - Label length: uint8               │
│  - Label (UTF-8)                     │
├──────────────────────────────────────┤
│ Encrypted Records (variable)         │
│  解密后为 CSV 文本:                   │
│  var1,var2,var3,...                  │
│  "value1","value2","value3",...      │
│  "value1","value2","value3",...      │
│  ...                                 │
│  (使用 GCM 认证防止篡改)              │
└──────────────────────────────────────┘
```

#### 6.1.3 SQLite 数据库 `.easyepi_db`（明文，仅元数据）

```sql
-- 项目配置表
CREATE TABLE project_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 如: key='last_entry_question_id', value='uuid-xxx'
-- 如: key='entry_batch_count', value='15'

-- 最近项目表（全局，存储在 appData 中非项目文件夹）
CREATE TABLE recent_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  last_opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_pinned INTEGER DEFAULT 0
);

-- 录入会话表（断点续录用）
CREATE TABLE entry_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,
  current_question_index INTEGER DEFAULT 0,
  batch_count INTEGER DEFAULT 0,
  batch_start_time INTEGER,
  auto_saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. 安全架构

### 7.1 安全层次

```
Layer 1 — 密码保护
  └── Argon2id 哈希 (memory=64MB, iterations=3, parallelism=4)

Layer 2 — 密钥派生
  └── PBKDF2-HMAC-SHA256 (iterations ≥ 600,000, 随机32字节盐)

Layer 3 — 数据加密
  └── AES-256-GCM (每文件独立随机IV, 认证标签防篡改)

Layer 4 — 文件层保护
  └── Magic Header 校验 + Version 校验 + 文件完整性校验 (GCM)

Layer 5 — 应用层保护
  └── 管理员会话超时 (15分钟无操作自动锁定)
  └── 密码错误锁定 (3次错误 → 5分钟锁定)
  └── 内存安全 (解密数据使用后立即从内存清除)
```

### 7.2 密钥生命周期

```
用户设置密码 → 生成随机盐 (32字节)
  密码 + 盐 → Argon2id → 密码哈希 (存储)
  密码 + 盐 → PBKDF2 → AES 加密密钥 (仅内存中)
    AES 密钥 → 加密项目文件 + 数据文件
    工作完成后: AES 密钥从内存中擦除

下次打开项目:
  用户输入密码 → 读取存储的盐 → Argon2id 验证
  密码验证通过 → 密码 + 盐 → PBKDF2 → 重新派生 AES 密钥
    AES 密钥 → 解密文件到内存
    管理员会话结束/超时 → AES 密钥从内存中擦除

修改密码:
  旧密码验证 → 旧密钥解密所有数据
  新密码 → 生成新盐 → Argon2id 新哈希
  新密码 + 新盐 → PBKDF2 → 新 AES 密钥
  新密钥加密所有数据 → 保存
```

### 7.3 文件安全验证

```typescript
class FileIntegrityChecker {
  /**
   * 验证加密文件完整性
   * GCM 模式自带认证标签, 解密失败 = 文件被篡改
   */
  async verifyIntegrity(filePath: string, key: Buffer): Promise<boolean> {
    try {
      const encrypted = await fs.readFile(filePath);
      const decrypted = this.cryptoService.decrypt(encrypted, key);
      // 额外验证 JSON 结构是否合法
      JSON.parse(decrypted.toString('utf-8'));
      return true;
    } catch (e) {
      // GCM 认证失败或 JSON 解析失败 → 文件已损坏或篡改
      return false;
    }
  }
}
```

---

## 8. EpiData 文件解析方案

### 8.1 .qes 文件格式

`.qes` 是一个纯文本格式的问卷定义文件，结构如下：

```text
This is the heading of the qes file
"问卷标题"
  VARIABLE_NAME  "Question text / field label"  {COMMENT}  {BLOCK}
  ...
END
```

关键解析规则：

| 元素 | 语法 | 示例 | 解析为 |
|------|------|------|--------|
| 整数变量 | `##` | `## age` | 2位数字，最小值 |
| 浮点变量 | `#.##` | `##.## bmi` | 2位整数+2位小数 |
| 文本变量 | `_` | `_____ name` | 5字符文本（下划线数=长度）|
| 大写文本 | `<A >` | `<A > code` | 仅大写字母，`<A>`间空格数=长度|
| 布尔 | `<Y>` | `<Y> is_smoker` | 是/否 (1/0) |
| 声明的key | `{key}` 或 unique key | `{key}` 块 | Key 定义 |
| 值标签 | `LABEL` 块 | `LABEL sex 1 "男" 2 "女"` | 选项值 ↔ 标签映射 |
| 跳题 | `JUMPS` 块 | `JUMPS 4 (smoke=2)>6` | 条件跳过逻辑 |
| 范围 | `RANGE` 块 | `RANGE age 0 120` | 数值范围约束 |
| 合法值 | `LEGAL` 块 | `LEGAL sex 1 2` | 合法值枚举 |
| 必填 | `MUSTENTER` 块 | `MUSTENTER age sex name` | 必填变量列表 |

#### 解析器设计

```typescript
enum QESFieldType {
  INTEGER = 'INTEGER',
  DECIMAL = 'DECIMAL',
  TEXT = 'TEXT',
  UPPERCASE = 'UPPERCASE',
  BOOLEAN = 'BOOLEAN',
  DATE_DMY = 'DATE_DMY',      // <dd/mm/yyyy>
  DATE_MDY = 'DATE_MDY',      // <mm/dd/yyyy>
  TODAY_DATE = 'TODAY_DATE',  // <today-dmy> etc.
  SOUNDEX = 'SOUNDEX',
  ID_NUMBER = 'ID_NUM',
}

interface QESField {
  name: string;           // 变量名
  label: string;          // 问题文本 / 标签
  type: QESFieldType;     // EpiData 原始类型
  length: number;         // 存储长度
  decimals: number;       // 小数位数（仅DECIMAL）
  comment: string | null; // COMMENT 注释
}

interface QESBlock {
  type: 'LABEL' | 'JUMPS' | 'RANGE' | 'LEGAL' | 'MUSTENTER' |
        'COMMENT' | 'TYPE' | 'VALUELABEL' | 'JUMPS' | 'GOTO' | 'END';
  content: string;
}

class QESParser {
  parse(fileContent: string): {
    metadata: { title: string; version?: string };
    fields: QESField[];
    blocks: QESBlock[];
  };
}
```

### 8.2 .rec 文件格式

`.rec` 是定长记录二进制文件，结构为：

```
[Header]
  - File type marker
  - Field count (N)
  - For each field:
    - Field name
    - Field type
    - Field length
    - Decimal places

[Records]
  - Each record: fixed-width sequence of field values
  - Record status byte (0x20 = normal, other = deleted)
  - Fields are stored as ASCII text, left/right justified

[End of File]
  - EOF marker
```

#### 解析器设计

```typescript
class RECParser {
  /**
   * 解析 .rec 文件为记录数组
   * @param filePath - .rec 文件路径
   * @param encoding - 字符编码 (默认检测 UTF-8/GBK/Latin-1)
   * @param fields - 从 .qes 解析的字段定义（提供长度和类型信息）
   */
  parse(
    filePath: string,
    encoding: string | null,
    fields: QESField[]
  ): {
    recordCount: number;
    deletedCount: number;
    records: Array<Record<string, string>>;
    encoding: string;  // 实际检测到的编码
  };
}
```

---

## 9. 基线表生成引擎

### 9.1 架构

```
记录数据 (解密后) → VariableClassifier → StatEngine → TableRenderer
                                        (类型判定)    (统计计算)    (表格格式化)
```

### 9.2 变量分类逻辑

```typescript
enum VariableType {
  CONTINUOUS = 'continuous',      // 连续数值 → Mean±SD / Median(IQR)
  BINARY = 'binary',             // 二分类 → n(%)
  CATEGORICAL = 'categorical',   // 多分类（无序）→ n(%)
  ORDINAL = 'ordinal',           // 有序分类 → n(%) 或 Mean±SD
  TEXT = 'text',                 // 文本 → 不纳入计算
  DATE = 'date',                 // 日期 → 可转换为年龄
  ID = 'id',                     // 标识符 → 不纳入计算
}

class VariableClassifier {
  classify(variable: VariableDef, data: string[]): VariableType {
    // 逻辑:
    // - 唯一值数量 ≤ 2 → BINARY
    // - 唯一值数量 ≤ 10 且非数值 → CATEGORICAL
    // - 唯一值数量 ≤ 10 且为数值且有顺序 → ORDINAL
    // - 数值且连续分布 → CONTINUOUS
    // - 文本长度 ≥ 20 → TEXT
    // - 标记为 Key → ID
  }
}
```

### 9.3 统计方法自动选择

| 变量类型 | 如果分组变量为二分类 | 如果分组变量为多分类 | 无分组 |
|----------|---------------------|---------------------|--------|
| 连续 (正态) | 独立样本 t 检验 | 单因素 ANOVA | — |
| 连续 (非正态) | Mann-Whitney U 检验 | Kruskal-Wallis 检验 | — |
| 二分类 | 卡方检验 / Fisher精确检验 | 卡方检验 | — |
| 有序分类 | Mann-Whitney U 检验 | Kruskal-Wallis 检验 | — |
| 多分类 | 卡方检验 | 卡方检验 | — |

```typescript
class StatEngine {
  /**
   * 正态性检验 (Shapiro-Wilk 简化实现)
   * n > 50: 使用 Kolmogorov-Smirnov
   * n ≤ 50: 使用 Shapiro-Wilk
   */
  testNormality(data: number[]): { isNormal: boolean; pValue: number };

  /**
   * 计算连续变量的描述统计
   */
  describeContinuous(data: number[]): {
    mean: number;
    sd: number;
    median: number;
    q1: number;
    q3: number;
    min: number;
    max: number;
    missing: number;
  };

  /**
   * 假设检验选择
   */
  selectTest(varType: VariableType, groupLevels: number): TestMethod;
}

class BaselineTableRenderer {
  generateTable(
    records: RecordData[],
    variables: VariableDef[],
    groupVariable: string | null,
    methods: StatMethodOption
  ): BaselineTableOutput;
}
```

---

---

## 10. 衍生变量公式引擎

### 10.1 架构

```
问卷变量定义 → FormulaParser → AST → FormulaEvaluator → 计算结果
                    │                          │
                    ▼                          ▼
            语法校验 + 错误提示          录入完成后自动批量计算
```

### 10.2 公式解析器 (FormulaParser)

```typescript
// src/main/services/derived/formula-parser.ts

enum TokenType {
  VARIABLE,      // {var_name}
  NUMBER,        // 123, 3.14
  STRING,        // "老年"
  OPERATOR,      // + - * / ^
  LPAREN,        // (
  RPAREN,        // )
  FUNCTION,      // IF, ROUND, ABS, SQRT, ...
  COMPARISON,    // > < >= <= == !=
  COMMA,         // ,
  QUESTION_MARK, // ? (ternary - future)
  COLON,         // : (ternary - future)
}

interface ASTNode {
  type: 'binary_op' | 'unary_op' | 'function_call' | 'literal' | 'variable_ref';
  // ...
}

class FormulaParser {
  /**
   * 将公式字符串解析为 AST
   * @param formula - 用户输入的公式字符串
   * @param availableVars - 可用变量定义列表（用于验证变量引用）
   * @returns AST 或解析错误
   */
  parse(
    formula: string,
    availableVars: VariableDef[]
  ): { success: true; ast: ASTNode } | { success: false; errors: ParseError[] };

  /**
   * 将 AST 转换回人类可读的公式字符串（用于可视化模式展示）
   */
  astToFormula(ast: ASTNode): string;

  /**
   * 将公式字符串转换为 KaTeX 可渲染的 LaTeX 字符串
   */
  toLatex(formula: string): string;
}
```

### 10.3 公式求值器 (FormulaEvaluator)

```typescript
// src/main/services/derived/formula-evaluator.ts

class FormulaEvaluator {
  /**
   * 在给定变量值上下文中执行 AST，返回计算结果
   * @param ast - 公式解析器输出的 AST
   * @param context - 变量名到值的映射 (如 { age: 35, weight: 70 })
   */
  evaluate(ast: ASTNode, context: Record<string, unknown>): EvaluationResult;

  /**
   * 推断公式的结果类型（用于自动设置衍生变量的类型）
   */
  inferResultType(ast: ASTNode, variables: VariableDef[]): 'numeric' | 'categorical' | 'date';
}

interface EvaluationResult {
  type: 'number' | 'string' | 'boolean' | 'date';
  value: unknown;
}
```

### 10.4 支持的函数库实现

```typescript
// src/main/services/derived/builtin-functions.ts

const BUILTIN_FUNCTIONS: Record<string, FunctionImpl> = {
  IF: (cond: boolean, trueVal: any, falseVal: any) => cond ? trueVal : falseVal,
  ROUND: (x: number, n: number) => {
    const factor = Math.pow(10, n);
    return Math.round(x * factor) / factor;
  },
  ABS: (x: number) => Math.abs(x),
  SQRT: (x: number) => Math.sqrt(x),
  LOG: (x: number) => Math.log10(x),
  LN: (x: number) => Math.log(x),
  EXP: (x: number) => Math.exp(x),
  POW: (x: number, n: number) => Math.pow(x, n),
  DATE_DIFF: (d1: string, d2: string, unit: 'year' | 'month' | 'day') => {
    const date1 = new Date(d1);
    const date2 = d2 === 'TODAY()' ? new Date() : new Date(d2);
    // 计算差值...
  },
  CONCAT: (...args: string[]) => args.join(''),
  SUBSTR: (s: string, start: number, len?: number) => s.substring(start, len ? start + len : undefined),
  TODAY: () => new Date().toISOString().slice(0, 10),
};
```

### 10.5 前端公式编辑器

```typescript
// src/renderer/components/derived/FormulaBuilder.tsx

// 可视化模式: 点击变量卡片 + 运算符按钮构建公式
// 高级模式: Monaco Editor / CodeMirror 轻量编辑器 + 语法高亮 + KaTeX 预览

// KaTeX 渲染 (预览区):
// import katex from 'katex';
// katex.renderToString(latexString, { throwOnError: false, displayMode: true });
```

### 10.6 录入时自动计算

衍生变量在录入完成（提交确认）时自动计算并存储:

```typescript
// src/main/services/entry.service.ts

async function submitRecord(answers: Record<string, AnswerValue>): Promise<SubmitResult> {
  // 1. 验证 Key 重复
  // 2. 将所有衍生变量公式在 answers 上下文中求值
  const derivedValues = await computeDerivedVariables(answers);
  // 3. 合并原始答案 + 衍生变量值
  const fullRecord = { ...answers, ...derivedValues };
  // 4. 加密写入数据文件
}
```

---

## 11. 多选题编码导出引擎

### 11.1 架构

```
加密数据文件 → 解密 → 记录数组 → EncodingTransformer → CSV 行生成 → 写入 CSV 文件
                                    │
                              [多分类/独热/哑变量]
                                    │
                              每道多选题独立设置
```

### 11.2 编码转换器

```typescript
// src/main/services/export/encoding-transformer.ts

enum MultiChoiceEncoding {
  MULTI_CLASS = 'multi_class',    // 多分类变量（原始格式）
  ONE_HOT = 'one_hot',           // 独热编码
  DUMMY = 'dummy',               // 哑变量编码
}

interface EncodingConfig {
  questionId: string;
  encoding: MultiChoiceEncoding;
  referenceOption?: string;      // 哑变量参照选项（仅 DUMMY 模式）
}

class EncodingTransformer {
  /**
   * 将多选题的原始值转换为指定编码格式的列值映射
   */
  transform(
    rawValue: string,                    // 原始值: "1,3,5"
    options: QuestionOption[],           // 选项定义
    encoding: MultiChoiceEncoding,
    referenceOption?: string
  ): Record<string, string | number>;

  /**
   * 为指定编码方式生成列名列表（用于 CSV 首行和导出预览）
   */
  getColumnNames(
    variableName: string,
    options: QuestionOption[],
    encoding: MultiChoiceEncoding,
    referenceOption?: string
  ): string[];

  /**
   * 批量转换所有记录
   */
  transformRecords(
    records: RecordData[],
    configs: EncodingConfig[],
    allQuestions: QuestionDef[]
  ): {
    headers: string[];
    rows: string[][];
  };
}
```

### 11.3 导出服务集成

```typescript
// src/main/services/export.service.ts

async function exportToCSV(options: ExportOptions): Promise<string> {
  // 1. 解密数据文件
  // 2. 解析记录
  // 3. 应用筛选条件
  // 4. 对每道多选题应用编码配置
  //    - 多分类: 保留原始 "1,3,5" 格式
  //    - 独热: 展开为 k 列 0/1
  //    - 哑变量: 展开为 k-1 列 0/1
  // 5. 衍生变量列追加
  // 6. 生成 CSV 文本 (UTF-8 BOM)
  // 7. 写入文件
  // 8. 同步生成数据词典文件
}
```

### 11.4 前端编码选择器组件

```typescript
// src/renderer/components/export/EncodingSelector.tsx

// 每道多选题显示为一个编码选择卡片:
// - Radio 组: 多分类 / 独热 / 哑变量
// - 选项数 >10 时显示黄色提示
// - 哑变量模式下显示参照类别下拉
// - 实时显示将产生的列数
```


## 12. 项目结构与目录规范

```
EasyEpi/
├── docs/                           # 项目文档
│   ├── PRD.md                      # 产品需求文档
│   ├── UI_DESIGN.md                # UI 设计文档
│   └── TECH_STACK.md               # 技术栈文档（本文档）
│
├── src/
│   ├── main/                       # Electron 主进程
│   │   ├── index.ts                # 入口：窗口管理、应用生命周期
│   │   ├── preload/
│   │   │   └── index.ts            # contextBridge 预加载脚本
│   │   ├── ipc/                    # IPC 处理器
│   │   │   ├── project.ipc.ts
│   │   │   ├── qnaire.ipc.ts
│   │   │   ├── entry.ipc.ts
│   │   │   ├── epidata.ipc.ts
│   │   │   ├── auth.ipc.ts
│   │   │   ├── export.ipc.ts
│   │   │   └── data.ipc.ts
│   │   ├── services/               # 业务服务层
│   │   │   ├── project.service.ts
│   │   │   ├── qnaire.service.ts
│   │   │   ├── entry.service.ts
│   │   │   ├── epidata/
│   │   │   │   ├── qes-parser.ts
│   │   │   │   ├── qes-grammar.ts  # .qes 语法标记定义
│   │   │   │   ├── rec-parser.ts
│   │   │   │   └── import.service.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── crypto.service.ts
│   │   │   ├── export.service.ts
│   │   │   ├── baseline.service.ts
│   │   │   └── backup.service.ts
│   │   ├── db/                     # 数据库层
│   │   │   ├── connection.ts
│   │   │   ├── migrations/
│   │   │   └── repositories/
│   │   └── utils/
│   │       ├── file-lock.ts
│   │       ├── encoding.ts
│   │       ├── validation.ts
│   │       └── logger.ts
│   │
│   ├── renderer/                   # React 渲染进程
│   │   ├── index.html
│   │   ├── main.tsx                # React 入口
│   │   ├── App.tsx                 # 根组件
│   │   ├── router.tsx              # 路由配置
│   │   ├── pages/                  # 页面组件
│   │   │   ├── WelcomePage.tsx
│   │   │   ├── DesignerPage.tsx
│   │   │   ├── EntryPage.tsx
│   │   │   ├── SubmitConfirmPage.tsx
│   │   │   ├── WorkEndPage.tsx
│   │   │   ├── AdminPage.tsx
│   │   │   ├── BaselinePage.tsx
│   │   │   └── ImportWizardPage.tsx
│   │   ├── components/             # 可复用组件
│   │   │   ├── ui/                 # 基础 UI 组件
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   └── ...
│   │   │   ├── qnaire/             # 问卷设计相关组件
│   │   │   │   ├── QuestionRow.tsx
│   │   │   │   ├── QuestionEditDialog.tsx
│   │   │   │   ├── TypeSelector.tsx
│   │   │   │   ├── OptionListEditor.tsx
│   │   │   │   └── ConditionRuleEditor.tsx
│   │   │   ├── entry/              # 录入相关组件
│   │   │   │   ├── QuestionCard.tsx
│   │   │   │   ├── SingleChoiceInput.tsx
│   │   │   │   ├── MultiChoiceInput.tsx
│   │   │   │   ├── FixedLengthInput.tsx
│   │   │   │   ├── FreeTextInput.tsx
│   │   │   │   └── ProgressBar.tsx
│   │   │   ├── admin/              # 管理后台组件
│   │   │   │   ├── DataTable.tsx
│   │   │   │   ├── PasswordGate.tsx
│   │   │   │   └── BaselinePreview.tsx
│   │   │   └── common/             # 通用组件
│   │   │       ├── ConfirmDialog.tsx
│   │   │       ├── EmptyState.tsx
│   │   │       ├── PasswordInput.tsx
│   │   │       └── ErrorBoundary.tsx
│   │   ├── stores/                 # Zustand 状态
│   │   │   ├── qnaire.store.ts
│   │   │   ├── entry.store.ts
│   │   │   └── admin.store.ts
│   │   ├── hooks/                  # 自定义 Hooks
│   │   ├── styles/                 # 全局样式
│   │   │   └── globals.css         # Tailwind 指令 + 自定义主题
│   │   └── lib/                    # 工具函数
│   │       ├── api.ts              # IPC 调用封装
│   │       ├── validators.ts       # 前端校验
│   │       └── constants.ts
│   │
│   └── shared/                     # 主进程/渲染进程共享
│       ├── ipc-api.ts              # IPC 接口类型定义（核心）
│       ├── types/
│       │   ├── qnaire.ts           # 问卷定义类型
│       │   ├── record.ts           # 记录/答案类型
│       │   ├── epidata.ts          # EpiData 相关类型
│       │   ├── baseline.ts         # 基线表相关类型
│       │   └── project.ts          # 项目配置类型
│       └── constants.ts            # 共享常量
│
├── tests/
│   ├── unit/                       # 单元测试 (Vitest)
│   │   ├── main/
│   │   │   ├── services/
│   │   │   │   ├── crypto.service.test.ts
│   │   │   │   ├── qes-parser.test.ts
│   │   │   │   ├── rec-parser.test.ts
│   │   │   │   ├── baseline.service.test.ts
│   │   │   │   └── ...
│   │   └── renderer/
│   │       ├── components/
│   │       └── stores/
│   ├── e2e/                        # E2E 测试 (Playwright)
│   │   ├── designer.spec.ts
│   │   ├── entry.spec.ts
│   │   ├── admin.spec.ts
│   │   └── import.spec.ts
│   └── fixtures/                   # 测试数据
│       ├── sample.qes
│       ├── sample.rec
│       └── sample-project.easyepi
│
├── resources/                      # 应用资源
│   ├── icons/                      # 应用图标
│   │   ├── icon.ico
│   │   ├── icon.icns
│   │   └── icon.png
│   └── templates/                  # 问卷模板
│       ├── phq9.json
│       └── gad7.json
│
├── electron-builder.yml            # 打包配置
├── electron.vite.config.ts         # 构建配置
├── tailwind.config.ts              # Tailwind 配置
├── tsconfig.json                   # TypeScript 基础配置
├── tsconfig.main.json              # 主进程 TS 配置
├── tsconfig.renderer.json          # 渲染进程 TS 配置
├── package.json
├── pnpm-lock.yaml
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

---

## 13. 开发环境与工具链

### 11.1 环境要求

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | ≥ 20.x LTS | 运行时 |
| pnpm | 8.x | 包管理器（节省磁盘空间） |
| Git | ≥ 2.40 | 版本控制 |
| Visual Studio Code | latest | 推荐 IDE |

### 11.2 推荐 VS Code 扩展

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- GitHub Copilot
- Playwright Test for VS Code
- Electron Support

### 11.3 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式运行（热重载）
pnpm dev

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 格式化代码
pnpm format

# 单元测试
pnpm test:unit

# E2E 测试
pnpm test:e2e

# 构建生产版本
pnpm build

# 构建 Windows 安装包
pnpm build:win

# 构建 macOS 安装包
pnpm build:mac
```

---

## 14. 测试策略

### 12.1 测试金字塔

```
         ┌─────┐
         │ E2E │  (Playwright) — 关键用户流程
         ├─────┤
         │集成 │  (Vitest) — IPC 通信 + 数据库操作
         ├─────┤
         │单元 │  (Vitest) — 加密、解析器、统计算法
         └─────┘
```

### 12.2 测试覆盖目标

| 测试层级 | 工具 | 覆盖目标 | 重点内容 |
|----------|------|----------|----------|
| **单元测试** | Vitest | ≥ 80% | 加密/解密、密码哈希验证、.qes/.rec 解析器、基线表统计算法、条件逻辑引擎 |
| **集成测试** | Vitest | 关键路径 | IPC 调用链路、SQLite CRUD、数据文件读写、加解密完整性 |
| **E2E 测试** | Playwright | 核心流程 | 问卷设计→保存→录入→提交→导出CSV、EpiData导入流程、基线表生成 |

### 12.3 关键测试用例

```typescript
// 加密模块测试 (高优先级)
describe('CryptoService', () => {
  it('should encrypt and decrypt correctly');
  it('should produce different ciphertexts for same plaintext (unique IV)');
  it('should fail on tampered data (GCM auth tag)');
  it('should derive different keys for different passwords');
  it('should handle empty input');
  it('should handle Unicode (Chinese) content');
});

// .qes 解析测试 (高优先级)
describe('QESParser', () => {
  it('should parse field definitions correctly');
  it('should parse LABEL blocks');
  it('should parse JUMPS blocks');
  it('should handle EpiData 3.1 format');
  it('should handle EpiData Manager format');
  it('should detect encoding (UTF-8 vs GBK)');
  it('should reject malformed files gracefully');
});

// 基线表测试 (高优先级)
describe('BaselineService', () => {
  it('should classify variables correctly');
  it('should select appropriate statistical tests');
  it('should generate correct n(%) for categorical variables');
  it('should generate correct Mean±SD for continuous variables');
  it('should handle missing values');
  it('should produce renderable table output');
});

// 条件逻辑测试 (高优先级)
describe('ConditionEngine', () => {
  it('should calculate visible questions correctly');
  it('should handle AND logic');
  it('should handle OR logic');
  it('should detect circular dependencies');
  it('should handle cascading skip rules');
});
```

---

## 15. 构建与发布

### 13.1 构建工具链

```
TypeScript 源码 → Electron Vite 构建 → electron-builder 打包 → 安装包
```

### 13.2 electron-builder 配置 (关键项)

```yaml
# electron-builder.yml
appId: com.easyepi.app
productName: EasyEpi
copyright: Copyright © 2026 EasyEpi

directories:
  output: dist
  buildResources: resources

win:
  target:
    - nsis
    - portable  # 便携版（无需安装）
  icon: resources/icons/icon.ico
  artifactName: EasyEpi-${version}-Setup.${ext}

mac:
  target:
    - dmg
  icon: resources/icons/icon.icns
  category: public.app-category.medical

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true

extraResources:
  # 可选的打包模板
  - from: resources/templates
    to: templates

# 签名（生产环境必须）
# win: certificateFile + certificatePassword
# mac: hardenedRuntime + gatekeeperAssess
```

### 13.3 版本管理策略

采用 **SemVer** (major.minor.patch)：
- **Major**: 数据文件格式不兼容变更、重大架构调整
- **Minor**: 新功能（新题型、新导出格式）、EpiData 新版本兼容
- **Patch**: Bug 修复、安全补丁、性能优化

### 13.4 自动更新

使用 `electron-updater` 实现应用内自动更新：
- 检查 GitHub Releases 获取新版本
- 增量更新（delta）减少下载大小
- 更新前创建数据备份（安全措施）

---

## 附录 A: 技术风险与缓解

| 风险 | 风险等级 | 影响 | 缓解措施 |
|------|----------|------|----------|
| EpiData 格式不兼容 | 中 | 导入失败/数据损坏 | 广泛收集各版本 .qes/.rec 测试样本，保守解析（宁可报错不猜测） |
| 加密实现缺陷 | 高 | 数据泄露/丢失 | 使用 Node.js 内置 crypto，经过审计的算法；安全代码审查；恢复密钥机制 |
| 大项目性能 | 中 | 10000+ 条记录时卡顿 | 分页加载、虚拟滚动、数据分级（摘要 + 详情按需加载） |
| Electron 安全漏洞 | 中 | 应用被攻击 | 保持 Electron 版本更新，最小化 preload 暴露面，禁用 nodeIntegration |
| Electron 包体积 | 低 | 下载慢 | 首次约150MB，后续增量更新仅数MB |
| 不同平台文件路径差异 | 低 | 路径解析错误 | 使用 Node.js `path` 模块，避免硬编码路径分隔符 |
| 字符编码问题 (EpiData) | 中 | 中文乱码 | 实现编码自动检测（UTF-8 → GBK → Latin-1 fallback），允许用户手动选择 |
| 公式注入安全 | 中 | 恶意公式导致代码执行 | 公式解析器仅支持白名单函数，使用 AST 沙箱执行，严禁 eval() |
| 复杂公式性能 | 低 | 10000条记录批量计算衍生变量耗时 | 增量计算（仅新录入记录）；可配置的求值超时 |

---

## 附录 B: 关键依赖版本清单

```json
{
  "dependencies": {
    "@noble/hashes": "^1.3.0",
    "better-sqlite3": "^11.0.0",
    "electron-log": "^5.0.0",
    "electron-updater": "^6.0.0",
    "json2csv": "^6.0.0",
    "katex": "^0.16.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "@tailwindcss/forms": "^0.5.0",
    "@types/better-sqlite3": "^7.6.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "electron-vite": "^2.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0",
    "zustand": "^4.5.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "@tanstack/react-table": "^8.10.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-checkbox": "^1.0.0",
    "@radix-ui/react-radio-group": "^1.0.0",
    "@radix-ui/react-select": "^1.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@radix-ui/react-tooltip": "^1.0.0",
    "@radix-ui/react-toast": "^1.0.0"
  }
}
```

---

*本文档将随着项目推进持续更新。技术决策需经过架构评审后确定。*
