# M2 验证报告

- 日期：2026-07-22
- 版本：`0.2.0`
- 分支：`feature/m2-design-system`
- 发行者配置：`KokuYu-EasyEpi Team`
- 平台：Windows x64
- 产物：NSIS 安装版、免安装便携版

## 自动化门禁

以下命令在 `D:\EasyEpi\.worktrees\m2-design-system` 执行，退出码均为 `0`：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 依赖锁定，无变更 |
| `pnpm install:electron` | Electron 运行时可用 |
| `pnpm generate:icon` | 生成包含 4 个尺寸的 `resources/icon.ico` |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test:coverage` | 25 个测试文件、271/271 测试通过 |
| `pnpm test:e2e` | source-built Electron E2E 8/8 通过 |
| `pnpm build:win` | NSIS 与 portable x64 构建成功 |

覆盖率：

| 指标 | 覆盖率 | 命中/总数 |
| --- | ---: | ---: |
| Statements | 91.74% | 789/860 |
| Branches | 88.05% | 435/494 |
| Functions | 88.63% | 273/308 |
| Lines | 93.29% | 724/776 |

## 打包程序 E2E

`tests/e2e/packaged.spec.ts` 要求 `EASYEPI_EXECUTABLE` 和 `EASYEPI_USER_DATA_DIR` 都是绝对路径。每个成品均在隔离用户目录中验证：

- 应用标题、一级标题和主内容可见；
- 生产环境 `/#/__components` 只进入 NotFound，不暴露组件展厅；
- `ELECTRON_RENDERER_URL=https://attacker.invalid/easyepi` 被忽略，页面仍从本地 `file:` 加载；
- 大字偏好写入 `preferences.json`，关闭并重启后恢复；
- 测试结束后应用正常关闭。

| 被测产物 | 隔离目录 | 结果 |
| --- | --- | --- |
| `release/EasyEpi-0.2.0-portable-x64.exe` | `.tmp/m2-portable-user-data` | 1/1 PASS，退出码 0 |
| `.tmp/m2-install/EasyEpi.exe` | `.tmp/m2-installed-user-data` | 1/1 PASS，退出码 0 |

## 安装与卸载

- 安装器以 `/S /D=D:\EasyEpi\.worktrees\m2-design-system\.tmp\m2-install` 静默安装，退出码 `0`。
- 安装目录中的 `EasyEpi.exe` 完成上述打包 E2E。
- `Uninstall EasyEpi.exe /S` 静默卸载，退出码 `0`。
- 卸载后 `EasyEpi.exe` 不存在，安装目录已移除。

## 可访问性与响应式

- axe WCAG 2.1 A/AA 自动检查包含欢迎页、问卷设计、单题录入、数据管理和设置对话框，source E2E 通过。
- 1024×700 与 1366×768 的 normal/large 自动响应式检查通过。
- 人工键盘、焦点、Tooltip、Modal、ConfirmDialog、Select、错误/状态文本和 reduced-motion 证据见 [M2 可访问性人工冒烟记录](M2_ACCESSIBILITY_SMOKE.md)。
- 精确四组合的最终完整录入复核尚在收口；完成前不以本报告代替人工证据。

## 产物与完整性

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `EasyEpi-0.2.0-setup-x64.exe` | 102,670,762 bytes（97.91 MiB） | `B9D8F9412AF79F4153D99014FD7CA50D28A865F7B0C1DCEBC3A559DDBF02F511` |
| `EasyEpi-0.2.0-portable-x64.exe` | 102,452,696 bytes（97.71 MiB） | `FAAFFEC22BE282E918B9E052449D18B331D5F7A84204154C4386B08BB2472CA4` |

两个文件的 `Get-AuthenticodeSignature` 状态均为 `NotSigned`。因此 Windows 可能显示 SmartScreen“未知发布者”警告；`KokuYu-EasyEpi Team` 是当前应用元数据中的发行者配置，不等同于受信任的代码签名身份。发布时必须通过可信渠道同时提供本表 SHA-256。
