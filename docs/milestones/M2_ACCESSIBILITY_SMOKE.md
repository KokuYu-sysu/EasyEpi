# M2 可访问性人工冒烟记录

- 日期：2026-07-22
- 被测提交：`78cb2aa`（本记录后续若仅更新文字，不改变被测程序）
- 测试者：Codex computer-use assisted manual observation
- 应用：本工作树 `out/main/index.js` 启动的 source-built EasyEpi Electron 应用
- 说明：本记录中的人工项必须来自 Windows 窗口内的实际观察，不以 Playwright 或 axe 结果代替。

## 视口与字号矩阵

| 视口 | 字号模式 | 状态 |
| --- | --- | --- |
| 1024×700 | normal | PASS — compact 导航、焦点、Tooltip、布局、溢出与完整单题录入均完成人工键盘检查 |
| 1024×700 | large | PASS — compact 导航、大字布局、溢出与完整单题录入均完成人工键盘检查 |
| 1366×768 | normal | PASS — desktop sidebar、toolbar、焦点、Tooltip、布局、溢出与完整单题录入均完成人工键盘检查 |
| 1366×768 | large | PASS — desktop 布局、焦点、Tooltip、Select、偏好重启恢复与完整单题录入均完成人工检查 |
| 1280×800（默认窗口） | normal | PASS — 完整业务键盘流程 |
| 1280×800（默认窗口） | large | PASS — 大字切换、布局、焦点与裁切检查 |

## 人工观察清单

精确四组合的 PASS 表示已执行人工布局、裁切、导航和代表性焦点检查，并在每个组合重复了完整的单题录入键盘流程。自动化 E2E 作为独立回归证据，不替代本表的人工观察。

| 检查项 | 1024×700 normal | 1024×700 large | 1366×768 normal | 1366×768 large | 1280×800 实际观察 | 观察备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 仅用 Tab/Shift+Tab/Enter/Space/方向键/Escape 可达并操作全部顶栏与导航动作 | PASS | PASS | PASS | PASS | PASS | 1024 compact nav 可键盘打开且 9 个目标均可达；1366 desktop sidebar/toolbar 完整 |
| Settings 可打开、操作并关闭；Radio、Checkbox 与主题/字号状态一致 | PASS | PASS | PASS | PASS | PASS | Enter 打开；system 初焦点；ArrowDown 移至 light、Space 选中；大字 Checkbox 可切换；Escape 返回设置触发器 |
| Select 可用方向键选择并关闭 | PASS | PASS | PASS | PASS | PASS | 数据管理 pageSize Select 可用 Enter 打开、方向键改变选项并用 Enter 提交关闭；1366×768 large 复核为 Down 选择 10 条 |
| Modal 打开后焦点进入，Escape 关闭后返回触发器 | PASS | PASS | PASS | PASS | PASS | 欢迎页“新建项目”Modal 初焦点进入关闭按钮，Escape 后返回触发器 |
| ConfirmDialog 打开时取消按钮获得初始焦点，取消后焦点返回触发器 | PASS | PASS | PASS | PASS | PASS | 设计页首题删除 ConfirmDialog 初焦点位于取消按钮，Escape 后返回删除触发器 |
| 完整完成单题录入演示，方向键、Tab、Enter 与错误提示均可用 | PASS | PASS | PASS | PASS | PASS | 四个精确组合均重复完整流程；未答显示 role=alert 文本，完成后“演示完成”状态获焦并明确未保存 |
| Skip link 获焦时可见，并把焦点移至主内容 | PASS | PASS | PASS | PASS | PASS | 修复后 Tab 显示 skip link，Enter 后仍在欢迎路由，main 获焦并显示清晰 outline |
| 所有键盘焦点始终具有清晰可见的非纯颜色轮廓 | PASS | PASS | PASS | PASS | PASS | 精确四组合执行代表性焦点检查；完整业务流中焦点始终清晰可见 |
| 页面无水平溢出、文字与动作无裁切，全部内容可达 | PASS | PASS | PASS | PASS | PASS | 四组合均无文档级横向溢出或操作裁切；数据表仅表格区域局部横向滚动 |
| Tooltip 在键盘聚焦时显示，且不承载完成动作所需的唯一信息 | PASS | PASS | PASS | PASS | PASS | 键盘聚焦侧栏收起按钮时 Tooltip 可见 |
| 状态与错误信息无需依赖颜色即可理解 | PASS | PASS | PASS | PASS | PASS | 录入必答错误具有 role=alert 可见文本；完成状态明确说明演示答案未保存 |
| reduced-motion 状态下无非必要动画，焦点与状态变化仍清晰 | PASS | PASS | PASS | PASS | PASS | 实际 Electron 窗口经 CDP emulateMedia(reduce) 后轮询确认根 `data-motion` 异步更新为 `reduced`；自动化覆盖同一运行时行为 |
| 偏好保存并在应用重启后恢复 | PASS（E2E） | PASS（E2E） | PASS（E2E） | PASS（人工 + E2E） | PASS（E2E） | 1366×768 large 已人工关闭并重启，确认大字偏好恢复；source E2E 另以隔离 userData 验证相同存储路径 |

## 缺陷与复测

| 缺陷 | 修复引用 | 复测 |
| --- | --- | --- |
| 运行中切换 `prefers-reduced-motion` 时根节点 `data-motion` 未更新 | `fb02565` | 自动化 PASS；实际 Electron CDP 复测 PASS |
| Skip link 的 `#main-content` 与 HashRouter 路由 hash 冲突，激活后进入 NotFound | `fb02565` | 自动化回归 PASS；1280×800 人工复测 PASS |
| 响应式 E2E 未实际触发 Toast，且 1024 欢迎页动作可达性断言不足 | `2343c60` | 1024 动作/九目标导航与 1366 可见 Toast 生产 E2E PASS |
| compact 导航菜单按钮缺少可键盘聚焦的补充 Tooltip | `78cb2aa` | AppShell 单测、1024 生产 E2E 与四组合人工 Tooltip 检查 PASS |

Computer Use 完成了默认 1280×800 窗口的完整业务 SendInput 观察，以及精确四视口组合的布局、裁切、导航、Tooltip、代表性焦点和完整单题录入检查。1024×700 的 compact 菜单可键盘打开，九个目标均可达；1366×768 的 desktop sidebar 与 toolbar 完整。Radio 的真实行为为方向键移动焦点、Space 提交选择，符合既定键盘操作流程，因此未修改 Radio。Select、Modal、ConfirmDialog、Entry 必答错误与完成状态均通过键盘观察；状态和错误无需依赖颜色。reduced-motion 通过实际 Electron 窗口 CDP 媒体模拟和根属性轮询观察。1366×768 large 还完成人工偏好保存、关闭与重启恢复复核，并由隔离 userData 的生产 Electron E2E 提供独立覆盖。

## 最终结果

**PASS — 自动化门禁、生产 Electron E2E、axe 与人工可访问性/响应式冒烟均通过。**
