# EasyEpi

EasyEpi 是面向流行病学现场调查的离线问卷设计与数据采集桌面软件。当前 M2 里程碑提供 Windows 10/11 x64 的安全 Electron 桌面应用、九个业务路由、持久化界面偏好，以及明确标注为“不保存”的问卷设计、单题录入和数据管理交互演示。

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
- NSIS 安装包：`release/EasyEpi-0.2.0-setup-x64.exe`
- 便携版：`release/EasyEpi-0.2.0-portable-x64.exe`

M2 的测试数量、覆盖率、打包 E2E、安装/卸载结果和 SHA-256 记录在 [M2 验证报告](docs/milestones/M2_VERIFICATION.md) 中。

应用按离线优先设计，不上传问卷或答卷数据，也不采集遥测。首版产物暂未使用 Windows 代码签名证书，因此下载或首次运行时可能出现 SmartScreen“未知发布者”警告；应仅运行从可信渠道取得并校验哈希的构建。

详细约束参见[架构设计](docs/superpowers/specs/2026-07-18-easyepi-v1-architecture-design.md)和[项目决策记录](docs/PROJECT_DECISIONS.md)。
