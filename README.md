# EasyEpi

EasyEpi 0.8.0 是面向流行病学与社会调查的 Windows 桌面应用，集成问卷设计、问卷录入、数据管理、统计分析和 AI 问卷助手。核心业务离线运行；AI 功能仅在用户主动发送时连接所配置的服务。

AI 问卷助手只使用 DeepSeek：服务地址固定为 `https://api.deepseek.com`，应用不提供厂商选择、厂商预设或自定义地址，设置页只保留模型名称（默认 `deepseek-v4-flash`，也可填写 `deepseek-v4-pro`）、API Key 和一行只读的服务地址。问卷生成使用 Chat Completions 的 JSON 输出模式，不使用函数调用。每次生成都执行固定的检索流程：先由模型把要求翻译成英文研究问题并判定医学或非医学；医学类请求随后依次检索 PubMed（NCBI E-utilities）、Europe PMC 的预印本关键词检索（bioRxiv/medRxiv 预印本发现，两个预印本服务器本身不提供关键词检索接口）和 bioRxiv/medRxiv 官方详情接口（校验 DOI 与元数据并给出正式落地页），所有请求再由 DeepSeek Responses API 的内置联网搜索补充来源；非医学类请求只使用联网来源。检索结果只作为可核验来源参与生成，医学类请求在没有检索到任何可用来源时停止生成，未使用外部来源时界面明确显示“本次未联网”。NCBI 要求使用 E-utilities 的应用向用户明示其免责声明与版权声明，设置页提供对应链接。

## 开发环境

- Windows 10/11 x64
- Node.js `>=22.12 <25`
- pnpm `>=11 <12`

安装依赖并准备 Electron 运行时：

```powershell
pnpm install --frozen-lockfile
pnpm install:electron
```

## 常用命令

- `pnpm dev`：启动开发模式。
- `pnpm build`：构建主进程、预加载脚本和渲染器。
- `pnpm preview`：预览生产构建。
- `pnpm lint`：运行 ESLint。
- `pnpm typecheck`：运行 Node 与 Web TypeScript 检查。
- `pnpm test` / `pnpm test:unit`：运行单元测试。
- `pnpm test:unit:watch`：监听运行单元测试。
- `pnpm test:coverage`：运行覆盖率门。
- `pnpm test:e2e`：构建并验证桌面应用入口。
- `pnpm test:e2e:packaged`：验证 `EASYEPI_EXECUTABLE` 指向的已打包程序；同时必须用绝对路径设置隔离的 `EASYEPI_USER_DATA_DIR`。
- `pnpm generate:icon`：从原创 SVG 生成多尺寸 Windows ICO。
- `pnpm check`：依次运行 lint、类型检查、覆盖率和生产构建。
- `pnpm build:win`：生成 Windows 安装版与便携版。

## 构建产物

- 编译输出：`out/`
- NSIS 安装包：`release/EasyEpi-0.8.0-setup-x64.exe`
- 便携版：`release/EasyEpi-0.8.0-portable-x64.exe`

M2 的测试数量、覆盖率、打包 E2E、安装/卸载结果和 SHA-256 记录在 [M2 验证报告](docs/milestones/M2_VERIFICATION.md) 中。

应用按离线优先设计，不上传问卷或答卷数据，也不采集遥测。首版产物暂未使用 Windows 代码签名证书，因此下载或首次运行时可能出现 SmartScreen“未知发布者”警告；应仅运行从可信渠道取得并校验哈希的构建。

详细约束参见[架构设计](docs/superpowers/specs/2026-07-18-easyepi-v1-architecture-design.md)和[项目决策记录](docs/PROJECT_DECISIONS.md)。
