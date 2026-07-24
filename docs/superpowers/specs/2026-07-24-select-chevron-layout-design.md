# EasyEpi 下拉框箭头布局设计

> 日期：2026-07-24  
> 状态：用户已批准方案 A，待独立规格评审

## 目标

修复共享下拉框中箭头紧贴文字右下角、尺寸过小的问题。所有使用 `Select` 的界面（包括问卷题型与约束类型）应显示一致、清晰的下拉提示。

## 设计

- 使用项目现有 `lucide-react` 的 `ChevronDown`，保持产品图标语言一致。
- 图标尺寸为 20px，线宽为 2，呈现清晰的细线 V 形。
- `Select` Trigger 使用 `flex w-full items-center gap-[var(--space-3)]`；Value 使用 `min-w-0 flex-1 text-left`，使文字占据剩余空间并把图标固定在最右侧。
- 使用 `<R.Icon asChild>` 包裹 `ChevronDown`；图标设置 `size={20}`、`strokeWidth={2}` 和 `className="shrink-0"`。Radix Icon 提供装饰性隐藏语义。
- Value 布局盒与图标之间使用既有 `--space-3`（12px）固定间距；长文字不得压缩图标或把图标推出边框。
- 保留 `min-h-11`（44px）和原有水平内边距，整个下拉框继续作为点击区域。
- 不修改题目弹窗结构、字段间距、选项数据、键盘交互或下拉菜单层级。

## 实现范围

- 生产代码仅修改 `src/renderer/components/ui/Select.tsx`；允许修改对应 unit/E2E 测试文件及测试夹具，不修改其他生产界面。
- 不增加依赖；复用已安装的 `lucide-react`。
- 所有共享 `Select` 使用方自动获得相同布局。

## 验证

- 组件测试先断言 Lucide 图标、20px 尺寸、Trigger/Value 布局类与装饰性语义，并在旧实现上失败。
- Electron E2E 使用真实几何测量证明：图标为 20×20px；图标右缘距 Trigger 右缘 12px（允许 1px 渲染误差）；图标与 Trigger 的纵向中心重合（允许 1px 渲染误差）。同时保留打开菜单、键盘选择和关闭菜单的功能断言。
- 真实界面验证覆盖浅色/暗色、标准/大字体，以及启用/禁用 Trigger；每种状态下图标必须可见、尺寸和右侧定位不变，长选项文字不得把图标推出边框。禁用配色不在本次修改范围，只验证图标继承现有状态并保持可见。
- 依次运行 `pnpm check`、`pnpm test:e2e`、`pnpm build:win`。打包后分别把 `EASYEPI_EXECUTABLE` 设为 `win-unpacked/EasyEpi.exe` 和 portable EXE 的绝对路径，把 `EASYEPI_USER_DATA_DIR` 设为两个相互独立的临时绝对目录，并各运行一次 `pnpm test:e2e:packaged`；两个 EXE 均须生成且 packaged E2E 通过。

## 检查结论

- 人工布局评估确认当前问题来自 Trigger 缺少 Flex/对齐规则和字体字符图标无固定尺寸。
- 机械布局扫描返回零告警；现有任意值均引用项目 spacing/z-index token。
- `Select` 标签间距与 `Input` 存在轻微差异，但与本问题无关，本次不扩大修改范围。
