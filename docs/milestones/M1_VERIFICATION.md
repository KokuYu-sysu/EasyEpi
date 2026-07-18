# EasyEpi M1 工程基础验证记录

> 验证日期：2026-07-18  
> 验证平台：Windows 10.0.26200 x64  
> 分支：`feature/m1-engineering-foundation`  
> 发行者：KokuYu-EasyEpi Team

## 1. 验证结论

M1 工程基础验收通过。项目可从冻结锁文件重建，安全 Electron 应用壳可运行，NSIS 安装版与便携版均可生成；源码态、便携版、安装版窗口及 IPC 连接状态均通过自动化验证，静默卸载可移除已安装程序。

## 2. 工具链版本

| 组件 | 版本 |
|---|---:|
| Node.js | 24.11.1 |
| pnpm | 11.9.0 |
| Electron | 43.1.1 |
| electron-vite | 5.0.0 |
| Vite | 7.3.6 |
| electron-builder | 26.15.3 |
| Playwright | 1.61.1 |
| Vitest | 4.1.10 |

Vite 固定为 electron-vite 5 支持的 Vite 7 系列；React 插件固定为 `@vitejs/plugin-react@5.2.0`。Electron 43 的包安装不会自动准备运行时二进制，因此冻结锁文件安装后显式执行 `pnpm install:electron`。

## 3. 干净状态验证命令

清理前逐项解析并校验 `node_modules`、`out`、`coverage`、`test-results`、`release` 与 `.tmp/m1-install` 的绝对路径位于当前工作树边界内。以下命令均以退出码 `0` 完成：

| 命令/步骤 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 通过；锁文件策略校验通过，511 个包从锁文件恢复 |
| `pnpm install:electron` | 通过；准备 Electron 43.1.1 Windows x64 运行时 |
| `pnpm generate:icon` | 通过；ICO 头有效，目录项为 4，重复生成哈希一致 |
| `pnpm check` | 通过；lint、类型检查、覆盖率与生产构建全部通过 |
| `pnpm test:e2e` | 通过；1/1 源码态 Electron E2E |
| `pnpm build:win` | 通过；生成 NSIS 与 portable x64 产物 |
| 便携版 `pnpm test:e2e:packaged` | 通过；1/1，使用包装器转发的本机 CDP 测试端口 |
| 安装版 `pnpm test:e2e:packaged` | 通过；1/1，安装目录限定为仓库内 `.tmp/m1-install` |
| 静默卸载 | 通过；`EasyEpi.exe` 已移除 |

单元测试结果：5 个测试文件、27 项测试全部通过。覆盖率为 statements 100%、branches 91.17%、functions 100%、lines 100%。

## 4. 最终产物

| 文件 | 字节数 | SHA-256 | Authenticode |
|---|---:|---|---|
| `release/EasyEpi-0.1.0-setup-x64.exe` | 100401515 | `FDE66518EC67B6D0E8D2652705696EE46D6E02A58ABAB9650E992AA8974720E4` | NotSigned |
| `release/EasyEpi-0.1.0-portable-x64.exe` | 100183547 | `DC7D6B024B9C4E1BDABB833342761B8E1BFA4C430E63F9F5AB60843377913A89` | NotSigned |
| `resources/icon.ico` | 285478 | `2AD3A67D84C1A9D56DDCFB379A838344369085D0F8085C142FF3674EEF7CF72E` | 不适用 |

## 5. 已知发行限制

当前没有 Windows 代码签名证书，安装版和便携版均经 `Get-AuthenticodeSignature` 确认为 `NotSigned`。Windows SmartScreen 可能显示“未知发布者”提示；该限制已在项目决策记录和 README 中披露，不阻塞当前批准的 M1 与 v1.0 未签名交付策略。

M1 只证明工程基础、安全边界、测试门和 Windows 打包链已就绪，不代表问卷设计、数据录入、加密存储、统计导出等后续纵向业务里程碑已经完成。
