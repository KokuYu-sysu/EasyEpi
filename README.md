# EasyEpi

EasyEpi 0.8.0 是面向流行病学与社会调查的 Windows 桌面应用，集成问卷设计、问卷录入、数据管理、统计分析和 AI 问卷助手。核心业务离线运行；AI 功能仅在用户主动发送时连接所配置的服务。

AI 问卷助手支持 OpenAI、DeepSeek、Google Gemini、通义千问、Kimi/Moonshot、智谱 GLM、xAI、小米 MiMo，以及自定义 OpenAI-Compatible 服务。普通生成统一使用兼容 Chat Completions；内置联网搜索按厂商能力使用兼容 Chat Completions 或 Responses。DeepSeek、Gemini 和自定义服务当前不启用兼容搜索，仍可正常生成，并明确显示“本次未联网”。

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
