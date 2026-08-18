# 部署与连接模式

[English](./DEPLOYMENT.md) · **简体中文**

[文档索引](./README_CN.md) ·
[在线 Demo](https://cherrychat-xi.vercel.app) ·
[安全策略](./SECURITY_CN.md) ·
[模型兼容性](./MODEL_COMPATIBILITY_CN.md) ·
[图片生成](./IMAGE_GENERATION_CN.md) · [项目首页](../README_CN.md)

CherryChat 作为一个 Next.js 应用运行。BYOK-only 部署不需要 Postgres、Redis、
对象存储或部署方持有的模型凭据。托管访问会增加一个固定的服务端
OpenAI-compatible 上游，并通过访问码和签名浏览器 Session 保护它。

## 通俗术语说明

**自带 API Key（BYOK，Bring Your Own Key）**表示模型 Provider 凭据属于用户。
它不表示可以免费使用模型：Provider 会向签发该 Key 的账号计算用量。CherryChat
只是发送请求的客户端，不会替用户创建 Provider 账号或赠送模型额度。

**托管访问（Hosted access）**是 CherryChat 对另一种凭据安排的称呼。部署者持有
Provider Key，并把它保存在服务端环境变量中；访客只需要填写 CherryChat 访问码。
成功的上游用量由部署者的 Provider 账号承担。这只是共享访问一个固定部署，不是
独立 CherryChat 账号、团队角色或计费系统。

**自托管（Self-hosting）**回答的是 CherryChat 运行在哪里，而不是 Provider Key
属于谁。一个自托管部署可以采用任意一种凭据安排，也可以同时开放两种。不要把
Hosted access 简写为“Host”，因为它还可能表示服务器、域名或部署动作。

| 模式        | 谁提供 Provider Key | 谁承担 Provider 费用 | 访客填写什么                       |
| ----------- | ------------------- | -------------------- | ---------------------------------- |
| 浏览器 BYOK | 每位用户            | 用户自己的账号       | API Key、API 类型、Base URL 和模型 |
| 同源 BYOK   | 每位用户            | 用户自己的账号       | API Key 和模型；Base URL 留空      |
| 托管访问    | 部署者              | 部署者的账号         | CherryChat 访问码                  |
| 自托管      | 不是一种凭据模式    | 取决于连接模式       | 表示由自己运行这个部署             |

在同源 BYOK 中，用户 Key 只会为了访问部署固定的 `BASE_URL` 而经过 CherryChat
Route Handler；它不是从部署环境中读取的部署者凭据。经过验证的公开 Demo 自托管在
Vercel 上，但采用 BYOK-only，因此不持有项目所有者的模型 Key。

## 选择连接模式

### 浏览器 BYOK

用户选择 API 类型，并在当前浏览器中保存 API Key、Base URL 和模型。

- 绝对 Base URL 由浏览器直接请求。Provider 会收到用户的 Key，并且必须允许
  浏览器 CORS。
- CherryChat 不会在 CORS 请求失败后，通过服务端代理静默重试。
- BYOK 支持 OpenAI Responses、原生 Anthropic、原生 Gemini、New API Endpoint
  Routing 和自定义 OpenAI-compatible Chat 连接。
- 浏览器保存的凭据只是便利存储，并非加密保险库。

### 同源 BYOK

对于 OpenAI-compatible Chat 连接，Base URL 留空时会向 CherryChat Origin 发送
`/api/models` 和 `/api/chat` 请求。服务端只能转发到经过校验的部署 `BASE_URL`；
浏览器不能通过 Header、Query Parameter 或 Request Body 提供目标主机。

此模式仍由浏览器持有并发送 BYOK Key。它是固定目标代理，不是任意 CORS Relay。

### 托管访问

托管访问要求完整的部署配置。访客输入访问码后会获得签名 HttpOnly Cookie，随后
服务端为发往固定 OpenAI-compatible Chat Completions 上游的请求注入部署方 API
Key。

托管访问具有以下重要限制：

- 始终使用固定 `/v1/models` 和 `/v1/chat/completions` 服务端边界。
- 不会把访客路由到原生 Anthropic、原生 Gemini、OpenAI Responses 或任意 New API
  Endpoint 类型。
- 托管模型必须存在于部署 `MODELS` 白名单中。
- 删除一个访问码会使由该访问码创建的 Session 失效；轮换 `AUTH_SECRET` 会使
  全部 Session 失效。
- 进程内并发和登录 Guard 会随 Serverless Instance 重置或分散。它们不是全局用户
  配额、每日预算或计费账本。

## 本地开发

环境要求：

- Node.js 22 或更高版本
- npm 11.9.0

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`。本地 BYOK-only 运行不需要环境变量文件。

只有在测试同源 BYOK、托管访问、由部署方付费的网络搜索或图片生成时，才把
`.env.example` 复制为 `.env.local`。不要把真实值写入 Git、日志、截图、Issue 或
浏览器测试产物。

## 最小部署配置

根据部署目标选择最小配置。示例中的 `replace-with-...` 只是填写提示，不是凭据。

### 仅 BYOK

这是首次部署时推荐的方式。保持部署环境变量为空，用户在设置中填写自己的 Provider
凭据。部署方不会承担聊天、搜索或生图用量费用。

### 托管聊天

如果部署方提供一个固定的 OpenAI-compatible 聊天上游，配置下面这一组变量：

```env
OPENAI_API_KEY=replace-with-provider-key
MODELS=gpt-4.1-mini
ACCESS_CODE=replace-with-a-long-random-access-code
AUTH_SECRET=replace-with-at-least-32-random-bytes
```

`BASE_URL` 默认是 `https://api.openai.com`。`DEFAULT_MODEL` 默认取 `MODELS` 的第一项，
`TITLE_MODEL` 默认取 `DEFAULT_MODEL`，`DISABLE_BYOK` 默认是 `false`。只有在不允许访客
使用自己的 Key 时，才设置 `DISABLE_BYOK=true`。

如果需要托管网络搜索，保留上面的托管聊天配置，再添加一个 Provider Key，例如
`TAVILY_API_KEY`。Provider Base URL 和默认 Provider 见下面的参数表。

### 托管图片生成

如果需要由部署方承担生图费用，再完整添加下面这一组变量：

```env
IMAGE_GENERATION_API_KEY=replace-with-image-provider-key
IMAGE_GENERATION_BASE_URL=https://api.openai.com
IMAGE_GENERATION_MODEL=gpt-image-2
```

这三个旧版图片变量必须同时配置；不配置时没有运行时回退值。需要多个图片 Provider
时，改用 `IMAGE_GENERATION_PROFILES`，未指定默认 ID 时使用数组第一项。

图片配置还要求上面的 Hosted access 变量组完整。Profile JSON、浏览器 BYOK 设置、
参数和 Endpoint 兼容性见[图片生成指南](./IMAGE_GENERATION_CN.md)。

## 环境变量

| 变量                               | 是否必需 | 默认值                          | 用途                                                   |
| ---------------------------------- | -------- | ------------------------------- | ------------------------------------------------------ |
| `BASE_URL`                         | 否       | `https://api.openai.com`        | 固定 OpenAI-compatible 上游。                          |
| `ALLOW_INSECURE_LOCAL_UPSTREAM`    | 否       | `false`                         | 精确为 `true` 时允许非生产环境使用 Loopback HTTP。     |
| `OPENAI_API_KEY`                   | 托管访问 | 无                              | 部署方持有的聊天上游 Key。                             |
| `MODELS`                           | 托管访问 | 空                              | 逗号分隔的托管模型白名单。                             |
| `DEFAULT_MODEL`                    | 否       | `MODELS` 第一项                 | 托管默认模型，必须存在于 `MODELS` 中。                 |
| `TITLE_MODEL`                      | 否       | `DEFAULT_MODEL`                 | 部署端标题模型，必须存在于 `MODELS` 中。               |
| `ACCESS_CODE`                      | 托管访问 | 无                              | 逗号分隔的访客访问码，每个最多 256 UTF-8 Byte。        |
| `AUTH_SECRET`                      | 托管访问 | 无                              | 至少 32 UTF-8 Byte 的 HMAC/Session Secret。            |
| `WEB_SEARCH_PROVIDER`              | 否       | `tavily`                        | 默认 Hosted Provider：`tavily`、`exa` 或 `grok`。      |
| `WEB_SEARCH_ALLOWED_PROVIDERS`     | 否       | 仅默认 Provider                 | 访问码用户可选的有序 Provider 列表。                   |
| `TAVILY_API_KEY`                   | 否       | 无                              | 选择 Tavily 时使用的部署方 Key。                       |
| `TAVILY_BASE_URL`                  | 否       | `https://api.tavily.com`        | 托管 Tavily-compatible Base。                          |
| `EXA_API_KEY`                      | 否       | 无                              | 选择 Exa 时使用的部署方 Key。                          |
| `EXA_BASE_URL`                     | 否       | `https://api.exa.ai`            | 托管 Exa-compatible Base。                             |
| `GROK_API_KEY`                     | 否       | 无                              | 选择 Grok 时使用的部署方 xAI-compatible Key。          |
| `GROK_RESPONSES_URL`               | 否       | `https://api.x.ai/v1/responses` | 完整 Grok Responses 地址。                             |
| `GROK_MODEL`                       | 否       | `grok-4.5`                      | Hosted Grok 模型。                                     |
| `GROK_X_SEARCH`                    | 否       | `false`                         | 精确为 `true` 时额外启用 X Search。                    |
| `IMAGE_GENERATION_API_KEY`         | 托管图片 | 无                              | 部署方持有的图片 Provider Key。                        |
| `IMAGE_GENERATION_BASE_URL`        | 托管图片 | 无                              | Provider Base；服务端自动派生 generations/edits 路径。 |
| `IMAGE_GENERATION_MODEL`           | 托管图片 | 无                              | 图片模型 ID，例如 `gpt-image-2`。                      |
| `IMAGE_GENERATION_PROFILES`        | 托管图片 | 无                              | Profile JSON 数组，不能与旧版三变量混用。              |
| `IMAGE_GENERATION_DEFAULT_PROFILE` | 否       | 第一项 Profile ID               | 使用 Profiles 时的默认 Profile。                       |
| `IMAGE_GENERATION_TIMEOUT_SECONDS` | 否       | `300`                           | 图片上游超时；`0` 关闭该 Timer。                       |
| `IMAGE_GENERATION_MAX_REQUEST_MB`  | 否       | `8`                             | 图片请求体上限，使用整数 MiB。                         |
| `DISABLE_BYOK`                     | 否       | `false`                         | 精确为 `true` 时只开放托管访问。                       |
| `MODEL_LIST_TIMEOUT_SECONDS`       | 否       | `30`                            | 模型列表超时秒数。                                     |
| `CHAT_FIRST_BYTE_TIMEOUT_SECONDS`  | 否       | `300`                           | 等待 Response Header 的秒数。                          |
| `CHAT_IDLE_TIMEOUT_SECONDS`        | 否       | `300`                           | Body Chunk 之间的最大空闲秒数。                        |
| `CHAT_TOTAL_TIMEOUT_SECONDS`       | 否       | `1800`                          | 整个聊天请求的超时秒数。                               |

`OPENAI_API_KEY`、`ACCESS_CODE` 和 `AUTH_SECRET` 必须同时配置，托管访问还要求
至少一个 `MODELS` 条目。托管配置不完整时会 Fail Closed。
`DISABLE_BYOK=true` 在缺少完整配置时同样会 Fail Closed。

`ACCESS_CODE` 会经过规范化、Trim、去重和长度限制。为了兼容性，短值仍可使用，但
公开部署应使用较长的随机值。请独立生成 `AUTH_SECRET`，不要复用 API Key 或访问码。

Timeout 值必须是 `0` 到 `86400` 的整数秒。`0` 只会关闭对应的单个 Timer。Total
Timer 在 Streaming 期间不会重置；Idle Timer 会在收到每个 Body Chunk 后重置。

生产环境 OpenAI、Tavily、Exa 和 Grok 上游必须使用 HTTPS。Insecure-local 例外只允许非生产
环境的 Loopback Host，不允许 LAN 或普通远程 HTTP 目标。

## 图片生成默认参数

下面是浏览器端生图参数的默认值，与 Hosted 图片环境变量相互独立：

| UI 参数    | 默认值 | 行为                                             |
| ---------- | ------ | ------------------------------------------------ |
| 分辨率     | `1K`   | 配合默认 `1:1` 比例解析为 `1024x1024`。          |
| 图像比例   | `1:1`  | 所选 Profile 支持自定义尺寸时可以选择其他比例。  |
| 质量       | `auto` | 原样传给所选的 OpenAI-compatible 图片 Provider。 |
| 输出格式   | `png`  | PNG 不发送压缩率字段。                           |
| 输出压缩率 | 无     | JPEG/WebP 可以设置 `0` 到 `100` 的整数。         |
| 参考图     | 无     | 图片编辑最多接收 `16` 张有序参考图。             |

## 部署到 Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flin-z-z%2FCherryChat)

1. 把 `https://github.com/lin-z-z/CherryChat` 导入 Vercel。
2. BYOK-only 部署保持环境变量为空；共享固定上游则添加完整托管访问变量。
3. 先部署到 Preview。
4. 检查 `/api/config`；其中只能包含公开 Feature Flag、允许的模型 ID、身份验证状态
   和 Timeout Policy。
5. 验证所选连接模式的浏览器网络路径。
6. 分配 Production Alias 或自定义域名前，检查 Vercel 源文件列表、Function 日志
   和客户端 Bundle 敏感值扫描结果。

直接使用 Vercel CLI 上传时，以仓库中的 `.vercelignore` 为准。它会排除本地环境
文件、`.vercel` Linkage、Trellis/Agent 工具、依赖、构建输出、报告、Cache 和日志，
同时保留 `.env.example`。

## BYOK-only Demo 配置

已验证的公开 Demo 为
[https://cherrychat-xi.vercel.app](https://cherrychat-xi.vercel.app)。该地址运行
CherryChat `v1.1.0`，并使用稳定的 Vercel Production Alias。
验证时项目没有任何环境变量，`/api/config` 报告 BYOK 已启用、托管访问已禁用、
托管网络搜索已禁用，并且没有部署模型；当时也没有由部署方付费的图片生成能力。

BYOK-only Demo 不得设置：

- `OPENAI_API_KEY`
- `ACCESS_CODE`
- `AUTH_SECRET`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `GROK_API_KEY`
- `IMAGE_GENERATION_API_KEY`
- `IMAGE_GENERATION_BASE_URL`
- `IMAGE_GENERATION_MODEL`
- `IMAGE_GENERATION_PROFILES`

这会让 Demo 始终使用由用户付费的 BYOK 路径，防止匿名访客消耗项目所有者的模型、
搜索或图片生成额度。当前 Demo URL 只有在部署源文件列表、环境变量名称、
`/api/config`、浏览器本地 BYOK 设置流程和客户端 Bundle 边界均验证后才公开。

如果运维方以后增加托管变量或自定义域名，应重新执行托管发布检查，并更新公开 Demo
说明。只要配置了项目方持有的凭据，即使 BYOK 仍然开放，该部署也不再是 BYOK-only。

## 公开托管部署加固

共享托管部署建议：

1. 发布一条只匹配 `POST /api/auth` 的 Vercel Firewall Rate-limit Rule。
2. 以客户端 IP、固定 60 秒窗口、五次匹配请求和一分钟拒绝期作为仓库初始建议。
3. 注意区域 Counter 和共享公网 IP 会影响结果。
4. 设置上游账号消费限额；CherryChat 不提供全局消费账本。
5. 使用较长的随机访问码；需要撤销全部 Session 时轮换 `AUTH_SECRET`。
6. 在真实认证流量后检查不含凭据的日志。

应用还会应用尽力而为的单实例登录与并发 Guard。它们只能作为纵深防御。

## 发布检查清单

### BYOK-only

- 未配置部署方持有的 OpenAI、托管访问、网络搜索或图片生成凭据。
- `/api/config` 报告 BYOK 已启用且托管访问已禁用。
- Provider 直连请求只发送到用户选择的绝对 URL。
- 同源 BYOK 只能访问部署固定的 `BASE_URL`。
- 浏览器保存的凭据不会出现在备份和生成的客户端文件中。

### 托管访问

- 托管变量组完整，模型 ID 均在白名单中。
- 错误、正确、已删除和已轮换访问码场景均已验证。
- Session Cookie 在 HTTPS 下使用 HttpOnly、SameSite Strict 和 Secure。
- Vercel Firewall 与上游消费控制分别发布。
- 托管聊天、搜索和图片生成从不接受浏览器选择的服务端目标。
- `WEB_SEARCH_PROVIDER` 决定默认的 Tavily、Exa 或 Grok；未配置
  `WEB_SEARCH_ALLOWED_PROVIDERS` 时仍锁定该 Provider。
- 显式允许列表必须非空、包含默认 Provider，且每一项都具有完整的部署方配置；
  列表顺序只控制设置页顺序，不改变默认值。列表外已配置的 Key 不会开放使用。
- 访问码用户只能在设置页选择允许的 Provider ID，不能覆盖 Key、URL、Grok
  模型或 X Search 设置。
- Grok 始终提供 Web Search；X Search 是独立开关，默认关闭，开启后可能增加
  xAI 模型和搜索工具费用。
- Hosted 图片生成只公开白名单 Profile 元数据。发布前确认默认 Profile、同源
  Session 要求、请求体与超时策略，以及固定的 generations/edits 上游。
- 生成图片 URL 只能来自配置的上游 Origin；服务端不携带凭据、不跟随重定向，且会
  把结果作为有大小上限的图片重新校验。
- Function 日志和客户端 Bundle 不包含任何已配置 Secret 值。

本地测试不能证明这些 Vercel 设置正确。请分别记录本地、Preview 和 Production
证据。
