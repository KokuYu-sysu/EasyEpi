# EasyEpi 0.8.0 多厂商 OpenAI-Compatible 与内置联网设计

日期：2026-09-08

状态：已批准

## 目标

在不引入第三方检索服务、不改变本地 Harness 安全边界的前提下，让 EasyEpi 0.8.0 支持以下厂商提供的 OpenAI-Compatible 接口：

- OpenAI
- DeepSeek
- Google Gemini
- 阿里云百炼／通义千问
- Kimi／Moonshot
- 智谱 GLM
- xAI
- 小米 MiMo
- 用户自定义 OpenAI-Compatible 服务

普通问卷生成优先使用 OpenAI-Compatible Chat Completions。厂商内置联网仅通过该厂商公开的 OpenAI-Compatible Chat Completions 或 Responses 接口完成。某个厂商或模型不支持内置搜索、搜索失败或能力不明时，问卷生成仍可继续，但必须明确显示“本次未联网”，并禁止声称已经检索任何来源。

## 非目标

- 不建设 EasyEpi 自有搜索代理、网页抓取器或文献数据库客户端。
- 不调用 Gemini 原生 GenerateContent、智谱专用 Web Search API 等非 OpenAI-Compatible 接口。
- 不向其他服务商转发用户数据或 API Key。
- 不自动购买、开通或同意任何厂商的收费搜索插件。
- 不承诺所有组网限制、地区限制或厂商账号权限之外的可用性。

## 方案选择

采用“共享传输层 + 声明式厂商能力配置 + 运行时独立协商”。

纯错误驱动探测会误发未知私有参数，也可能导致额外计费；每家厂商复制完整客户端则会造成验证、流式解析和安全错误处理分叉。声明式配置可以复用稳定的 Chat Completions/SSE/Responses 基础实现，同时把端点、请求扩展、思考控制、结构化输出和搜索流程限制在经过审核的厂商配置中。

## 配置模型与迁移

全局 AI 配置升级到 schema version 2：

```ts
type AIProviderId =
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'qwen'
  | 'moonshot'
  | 'glm'
  | 'xai'
  | 'mimo'
  | 'custom'

interface StoredAIConfigV2 {
  schemaVersion: 2
  providerId: AIProviderId
  baseUrl: string
  model: string
  encryptedApiKey?: string
  privacyAcceptedAt?: string
  privacyNoticeVersion?: string
}
```

读取 version 1 配置时，根据规范化主机名匹配已知厂商；匹配不到则迁移为 `custom`。迁移只改变内存表示，下一次保存时原子写入 version 2。Base URL、模型和密钥保持不变，API Key 继续仅由主进程通过 Electron `safeStorage` 加密保存。

设置页新增厂商选择器。选择预设时填入默认 Base URL，模型仍由用户填写或选择；切换厂商会清空尚未保存的 API Key 输入，但不会在未确认保存时覆盖磁盘配置。“自定义服务”保留 Base URL、模型和 API Key 手工输入，并默认关闭所有厂商私有扩展和内置联网。

## 厂商能力配置

新增只含数据和小型请求构建函数的 provider registry。每个 profile 声明：

- 厂商 ID、显示名称、官方默认 Base URL 和允许匹配的官方主机名；
- 普通生成使用的传输类型和端点拼接规则；
- Bearer 鉴权方式；
- 可尝试的结构化输出等级：`json_schema`、`json_object` 或纯文本；
- 思考模式请求扩展及适用模型；
- 联网传输类型、支持模型条件、请求扩展和结果解析器；
- 是否可返回结构化引用、来源 URL 或仅返回模型整理后的文本。

`providerId` 决定是否允许发送厂商私有字段，Base URL 主机名承担第二道约束。只有 profile 与官方主机匹配时才发送 `thinking`、`enable_search`、`$web_search`、GLM/MiMo `web_search` 等字段；自定义域名即使选择了相似模型名也不自动收到这些字段。

## 传输层

现有 OpenAI-Compatible Client 拆为三个协作部分：

1. Chat Completions transport：继续负责普通 JSON、SSE、取消、大小限制、状态码脱敏和 Chat 响应提取。
2. Responses transport：只实现文本输入、内置 `web_search`、流式或非流式最终文本、引用提取和同等安全限制。
3. Provider request policy：依据 profile 和当前能力缓存构建请求，不负责解析问卷。

端点解析接受用户填写到 `/v1`、`/chat/completions` 或 `/responses` 层级，但规范化后不得重复追加路径。仅允许 HTTPS；现有回环测试例外保持不变。

流式解析允许厂商常见的空 `content`、`reasoning_content`、usage-only 终包和工具调用 delta，但只把最终可读助手文本发送到渲染进程。未知字段不得直接穿过 IPC。

## 联网研究流程

一次需要生成或修改问卷的用户请求分为两个逻辑阶段：

1. **研究阶段**：如果所选 profile 和模型支持内置搜索，则通过该厂商兼容接口搜索。提示词优先 PubMed、Web of Science、Cochrane Library、WHO、CDC、国家卫生健康委员会及其他权威学术或公共卫生来源；厂商支持域名约束时同步发送域名限制。
2. **生成阶段**：把经过边界检查的研究摘要、来源元数据和联网状态作为不可信证据上下文交给普通 Chat Completions，请求现有版本化问卷 envelope，并继续由 Harness 校验、修复和落盘。

研究与严格 JSON 生成分开，避免工具调用、引用 annotation 或 Responses output item 破坏问卷结构。研究文本和来源必须有独立大小上限；模型输出中的 URL、DOI、PMID 仍被视为不可信文本，不因来自内置搜索而跳过本地验证。

对于持续多轮会话，只有新的用户问题明显需要外部证据，或用户明确要求联网时才进行研究阶段。相同 Session、provider、model、研究提示哈希的结果可存入现有加密 Session cache；清除 Session cache 同时清除研究结果和能力记录。

## 各厂商联网策略

| 厂商 | 普通生成 | 内置搜索策略 |
| --- | --- | --- |
| OpenAI | Chat Completions | 优先 Responses `web_search`；专用搜索模型可使用 Chat `web_search_options` |
| DeepSeek | Chat Completions | 官方直连 profile 初始标记不支持；继续生成并显示未联网 |
| Gemini | 兼容 Chat Completions | 仅对官方兼容层和官方声明支持的模型发送兼容扩展；拒绝后关闭搜索能力 |
| 通义千问 | 兼容 Chat Completions | `enable_search: true` 与受支持的 `search_options` |
| Kimi／Moonshot | 兼容 Chat Completions | `builtin_function.$web_search`，禁用思考并完成受限工具回传循环 |
| 智谱 GLM | 兼容 Chat Completions | `tools[].type = web_search` |
| xAI | Chat Completions | Responses `web_search` |
| 小米 MiMo | 兼容 Chat Completions | `tools[].type = web_search`，仅支持已开通插件和匹配模型 |
| 自定义 | Chat Completions | 默认关闭，不探测或发送私有搜索参数 |

搜索属于可能额外收费的能力。设置页必须显示说明，并提供默认开启的“使用厂商内置联网（可能产生额外费用）”开关；用户关闭后不发送任何搜索字段。连接测试不触发搜索，避免无意计费。

## 能力协商与降级

能力按 `providerId + normalizedBaseUrl + model` 独立记录：

- `streaming`
- `json_schema`
- `json_object`
- `responses`
- `web_search`
- `reasoning_control`

只有在未收到任何生成文本前，且 400/404/405/422 错误明确指向相应端点、参数、工具或模型能力时，才能关闭单项能力并执行安全降级。认证、额度、限流、网络、超时、服务端错误和已经开始输出后的失败不得伪装成“不支持”。搜索降级不占用 Harness 的三次生成尝试。

用户界面区分：

- 已联网并获得结果；
- 模型判断无需联网；
- 用户关闭联网；
- 厂商／模型不支持；
- 搜索失败后继续离线生成。

只有第一种状态可以显示“已联网”。没有可验证来源时，助手消息必须包含明确披露，且不得出现“根据检索结果”等措辞。

## 错误与安全

- 渲染进程只接收稳定错误码、厂商显示名、HTTP 状态类别和可操作建议，不接收原始响应体、请求体、路径或 API Key。
- 401/403 提示检查密钥、账号区域和 Base URL；404 提示模型或端点；429 提示额度／速率限制；网络与 TLS 错误单独显示，不统一折叠成“无法连接”。
- 厂商返回的 HTML、工具参数、引用和搜索摘要全部按不可信输入处理，并执行现有长度、JSON 深度、重复键和原型污染保护。
- Kimi 工具循环设置最大轮数；只允许回传 `$web_search` 调用的原始 arguments，不执行任意函数或外部 URL。
- URL 仅允许 `https:`，引用在 UI 中显示为可点击链接前必须再次校验。
- 日志、持久化失败记录和遥测均不得包含密钥、完整请求、完整研究内容或原始厂商错误体。

## 用户界面

AI 设置页显示厂商、Base URL、模型、API Key、联网开关和能力状态。预设厂商提供说明文字，不硬编码会快速过时的完整模型下拉列表；模型字段支持手工输入。

连接测试只验证认证、模型和普通 Chat Completions，不启动联网。首次启用联网开关时显示可能额外计费和需要在厂商控制台开通插件的说明。

问卷对话页在每轮结果上方显示紧凑联网状态；有来源时提供来源列表，没有联网时显示明确原因。联网状态不影响草稿预览、Harness 校验、应用问卷和撤销流程。

## 测试与验收

采用测试驱动实现，并为每个 profile 建立确定性的本地 HTTP stub：

- 配置 version 1 到 version 2 迁移、厂商选择和自定义服务；
- 每个厂商的端点、鉴权、搜索扩展、思考扩展和结构化输出策略；
- Chat JSON/SSE、Responses JSON/SSE、空 content、reasoning delta、usage-only chunk；
- Kimi `$web_search` 正常循环、未知工具拒绝和轮数上限；
- 每项能力的精确降级及缓存隔离；
- 搜索成功、无需搜索、关闭、不支持和失败五类 UI 状态；
- 401/403/404/429/5xx、DNS、TLS、超时和取消的用户提示；
- 原始错误体、API Key、研究正文和危险 URL 不越过 IPC 或写入日志；
- 现有 Harness、问卷生成、项目加密和应用问卷回归测试。

完成单元、集成、渲染组件、类型检查、lint、生产构建及本地 stub 端到端验证后，重新构建 Windows x64 安装版和便携版，版本保持 0.8.0，并记录 SHA-256。

真实厂商验证只使用用户已经配置且授权使用的账号。没有相应密钥时，不声明已完成该厂商的在线验证。
