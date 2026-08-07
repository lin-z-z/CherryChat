# 部署与连接模式

[English](./DEPLOYMENT.md) · **简体中文**

[文档索引](./README_CN.md) ·
[在线 Demo](https://cherrychat-xi.vercel.app) ·
[安全策略](./SECURITY_CN.md) ·
[模型兼容性](./MODEL_COMPATIBILITY_CN.md) · [项目首页](../README_CN.md)

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

只有在测试同源 BYOK、托管访问或由部署方付费的 Tavily 搜索时，才把
`.env.example` 复制为 `.env.local`。不要把真实值写入 Git、日志、截图、Issue 或
浏览器测试产物。

## 环境变量

| 变量                              | 是否必需 | 用途                                                           |
| --------------------------------- | -------- | -------------------------------------------------------------- |
| `BASE_URL`                        | 否       | 固定 OpenAI-compatible 上游；默认为 `https://api.openai.com`。 |
| `ALLOW_INSECURE_LOCAL_UPSTREAM`   | 否       | 精确设为 `true` 时，允许非生产环境使用 Loopback HTTP。         |
| `OPENAI_API_KEY`                  | 托管访问 | 部署方持有的上游 Key。                                         |
| `MODELS`                          | 托管访问 | 逗号分隔的托管模型白名单。                                     |
| `DEFAULT_MODEL`                   | 否       | 托管默认模型；必须存在于 `MODELS` 中。                         |
| `TITLE_MODEL`                     | 否       | 部署端标题模型；必须存在于 `MODELS` 中。                       |
| `ACCESS_CODE`                     | 托管访问 | 逗号分隔的访客访问码，每个最多 256 UTF-8 Byte。                |
| `AUTH_SECRET`                     | 托管访问 | 至少 32 UTF-8 Byte 的 HMAC/Session Secret。                    |
| `TAVILY_API_KEY`                  | 否       | 为已登录托管访客提供搜索额度的部署方 Tavily Key。              |
| `TAVILY_BASE_URL`                 | 否       | 托管 Tavily-compatible Base；默认为 `https://api.tavily.com`。 |
| `DISABLE_BYOK`                    | 否       | 精确设为 `true` 时只开放托管访问。                             |
| `MODEL_LIST_TIMEOUT_SECONDS`      | 否       | 模型列表时限；默认 30 秒。                                     |
| `CHAT_FIRST_BYTE_TIMEOUT_SECONDS` | 否       | 等待 Response Header 的时限；默认 300 秒。                     |
| `CHAT_IDLE_TIMEOUT_SECONDS`       | 否       | Body Chunk 之间的最大空闲时间；默认 300 秒。                   |
| `CHAT_TOTAL_TIMEOUT_SECONDS`      | 否       | 整个聊天请求时限；默认 1800 秒。                               |

`OPENAI_API_KEY`、`ACCESS_CODE` 和 `AUTH_SECRET` 必须同时配置，托管访问还要求
至少一个 `MODELS` 条目。托管配置不完整时会 Fail Closed。
`DISABLE_BYOK=true` 在缺少完整配置时同样会 Fail Closed。

`ACCESS_CODE` 会经过规范化、Trim、去重和长度限制。为了兼容性，短值仍可使用，但
公开部署应使用较长的随机值。请独立生成 `AUTH_SECRET`，不要复用 API Key 或访问码。

Timeout 值必须是 `0` 到 `86400` 的整数秒。`0` 只会关闭对应的单个 Timer。Total
Timer 在 Streaming 期间不会重置；Idle Timer 会在收到每个 Body Chunk 后重置。

生产环境 OpenAI 和 Tavily 上游必须使用 HTTPS。Insecure-local 例外只允许非生产
环境的 Loopback Host，不允许 LAN 或普通远程 HTTP 目标。

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
[https://cherrychat-xi.vercel.app](https://cherrychat-xi.vercel.app)。虽然
CherryChat 仍是 Preview 阶段产品，该地址使用稳定的 Vercel Production Alias。
验证时项目没有任何环境变量，`/api/config` 报告 BYOK 已启用、托管访问已禁用、
托管网络搜索已禁用，并且没有部署模型。

BYOK-only Demo 不得设置：

- `OPENAI_API_KEY`
- `ACCESS_CODE`
- `AUTH_SECRET`
- `TAVILY_API_KEY`

这会让 Demo 始终使用由用户付费的 BYOK 路径，防止匿名访客消耗项目所有者的模型
或搜索额度。当前 Demo URL 只有在部署源文件列表、环境变量名称、`/api/config`、
浏览器本地 BYOK 设置流程和客户端 Bundle 边界均验证后才公开。

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

- 未配置部署方持有的 OpenAI、托管访问或 Tavily 凭据。
- `/api/config` 报告 BYOK 已启用且托管访问已禁用。
- Provider 直连请求只发送到用户选择的绝对 URL。
- 同源 BYOK 只能访问部署固定的 `BASE_URL`。
- 浏览器保存的凭据不会出现在备份和生成的客户端文件中。

### 托管访问

- 托管变量组完整，模型 ID 均在白名单中。
- 错误、正确、已删除和已轮换访问码场景均已验证。
- Session Cookie 在 HTTPS 下使用 HttpOnly、SameSite Strict 和 Secure。
- Vercel Firewall 与上游消费控制分别发布。
- 托管聊天和搜索从不接受浏览器选择的服务端目标。
- Function 日志和客户端 Bundle 不包含任何已配置 Secret 值。

本地测试不能证明这些 Vercel 设置正确。请分别记录本地、Preview 和 Production
证据。
