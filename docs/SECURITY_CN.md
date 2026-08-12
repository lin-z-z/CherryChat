# 安全策略与模型

[English](./SECURITY.md) · **简体中文**

[文档索引](./README_CN.md) · [部署指南](./DEPLOYMENT_CN.md) ·
[数据行为](./DATA_CN.md) · [项目首页](../README_CN.md)

## 报告安全漏洞

请通过
[GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new)
私密报告疑似漏洞。不要在公开 Issue 或 Discussion 中包含漏洞细节、凭据、私人对话
或可运行的 Exploit。

报告中请提供受影响的 Commit 或部署形态、简洁的影响说明、复现步骤和经过脱敏的
证据。只使用测试凭据，并从截图或日志中移除 Token、Cookie、私有域名、Prompt
内容和用户数据。

CherryChat v1.0.0 是首个正式稳定版本，但项目不提供安全响应 SLA 或漏洞奖励。安全修复以
最新 `main` 状态为目标，目前不维护旧 Release Branch。如果 GitHub Private
Vulnerability Reporting 暂不可用，请等待仓库所有者启用私密渠道，不要公开细节。

## 威胁模型

CherryChat 是带有可选 Vercel Route Handler 的浏览器本地 AI 客户端。项目不宣称
自己是加密凭据保险库、多租户账号系统、全局限流器或计费平台。

主要信任边界包括：

1. 当前浏览器 Profile 和同源 JavaScript。
2. 浏览器直连 BYOK 流量所选的模型/搜索 Provider。
3. 同源或托管访问流量所经过的 CherryChat 部署及其环境。
4. 用于仓库校验的 GitHub Actions 和依赖安装流程。

## 浏览器凭据与本地数据

BYOK API Key、访问码输入和可选个人 Tavily、Exa 或 Grok 凭据会保存在本地以便使用。CherryChat
不会对它们进行静态加密。恶意扩展、受入侵的依赖、注入的同源脚本，或能够访问
浏览器 Profile 的人员，都可能读取这些数据。

凭据保存在独立连接记录中，完整备份、对话导出、搜索、打印输出和公开配置不会
包含它们。清除全部本地数据会删除 CherryChat IndexedDB 数据、以
`cherrychat.` 开头的 localStorage 记录、内存预览和托管访问 Session Cookie。

准确的删除和导出规则见[数据与备份行为](./DATA_CN.md)。

## 托管访问

托管访问要求同时配置 `OPENAI_API_KEY`、`ACCESS_CODE` 和 `AUTH_SECRET`，并提供
非空的 `MODELS` 白名单。配置不完整时会 Fail Closed。

访问码会经过规范化、限制为最多 256 UTF-8 Byte、使用 HMAC-SHA-256 生成 Digest，
并与所有已配置访问码进行 Timing-safe 比较。Session Cookie 包含过期时间和不可逆
Code Identifier，不包含访问码本身。删除一个访问码会使由该访问码创建的 Session
失效；轮换 `AUTH_SECRET` 会使全部 Session 失效。

身份验证 Mutation 要求同源请求。在 HTTPS/生产环境中，Session Cookie 使用
HttpOnly、Secure 和 SameSite Strict。托管模型 ID 必须属于部署白名单。

单个运行实例会应用有界登录和并发 Guard。Vercel Firewall 可以在 Function 之前
增加区域性 IP 规则。这两层都不是全局一致配额、按用户预算或计费账本。公开托管
部署仍然需要上游消费限额和滥用响应方案。

## 网络边界

CherryChat 有三条相关路径：

1. 绝对 BYOK Base URL 由浏览器直接请求，要求 Provider 支持 CORS。
2. OpenAI-compatible BYOK Base URL 留空时，使用同源路由，并且只能转发到经过校验
   的部署 `BASE_URL`。
3. 托管访问在签名 Session 校验后，通过同一个固定目标使用部署端 API Key。

服务端不接受来自 Query Parameter、Request Body 或目标主机 Header 的上游目标。
系统拒绝重定向。托管聊天会校验严格、有界的请求结构和模型白名单。同源 BYOK 会
保留 OpenAI-compatible 扩展字段，但仍不能改变固定目标。

托管网络搜索使用独立的同源 POST 路由。它要求有效托管 Session，只接受有界
Query 和结果数，并使用部署端固定的 Tavily、Exa 或 Grok 目标及凭据。浏览器不能为
此路由提供 Provider、模型、服务端目标或凭据。

生产环境托管上游必须使用 HTTPS。明确的 Insecure-local 选项只在非生产环境、且
目标为 Loopback Host 时生效；它不允许 LAN、私有地址、元数据地址或普通远程 HTTP
目标。

不要为了绕过浏览器 CORS 添加任意服务端 URL 回退。未来受限代理的最低要求记录在
[路线图](./ROADMAP_CN.md)中。

## 内容边界

- Markdown Renderer 不执行模型返回的原始 HTML、Script、Iframe、Object、Embed、
  Form 或 Inline Event Handler。
- 链接使用明确的 Protocol Policy，外部目标使用安全浏览器属性。
- 远程 Markdown 图片先显示同意控件；只有用户确认后浏览器才会加载第三方 URL，
  且请求不携带 Referrer。
- Mermaid 只为已完成消息加载，并使用 Strict Security Mode。
- Content Security Policy 禁止 Frame、Object 和不受信任 Script。
- Base64 图片请求数据不会写入对话文本或应用日志。

## 请求与响应限制

服务端和浏览器 Transport 会限制 Request Body、文本、图片数据、Tool Payload、
模型列表响应、JSON Completion、上游错误详情和 OpenAI-compatible SSE Event。
Timeout 与取消信号会沿 Transport 传播。超出限制时会返回稳定错误，而不是无限缓冲。

这些限制可以降低意外或机会性滥用，但不能替代 Provider 配额或部署级预算。

## 日志与错误处理

应用代码不得记录 API Key、访问码、访问码 Digest、`AUTH_SECRET`、Authorization
或 Cookie Header、Request/Response Body、私人 Prompt、模型输出、Base64 图片或
用户配置的原始目标 URL。

公开错误使用稳定 Code 和有界、脱敏的 Detail。平台和部署配置可能在仓库外变化，
因此发布前仍需检查 Vercel 日志。空查询或失败的日志查询不能证明没有敏感数据输出。

## CI 与部署边界

校验 Workflow 在普通 Pull Request 和推送到 `main` 时运行，权限为
`contents: read`，Checkout Credential 不会持久化。它会安装依赖、运行仓库质量门、
使用合成 Canary 构建并扫描客户端 Bundle。它不使用部署 Secret、OIDC、Environment、
Preview Deployment 或生产 API。

不要把部署 Secret 加入不受信任的 Pull Request Workflow，也不要用
`pull_request_target` 替代当前边界。未来部署 Workflow 必须独立且受信任。

直接 Vercel CLI 上传由 `.vercelignore` 控制，不能假设 `.gitignore` 一定生效。
分配稳定 Alias 或域名前，请检查实际上传的源文件列表。

## 运维检查清单

- 持续审查 Node、npm、Next.js、浏览器依赖和 Provider SDK。
- 同时运行生产依赖和完整依赖审计，不要强制修复出不兼容的依赖树。
- Bundle 扫描使用合成 Secret，浏览器流程使用测试专用凭据。
- 分别验证 BYOK-only 和托管访问配置。
- Vercel Firewall 规则和上游消费限额应与应用部署分别发布。
- 在真实 Preview 上检查 `/api/config`、浏览器网络路径、Function 日志和客户端
  Bundle 内容。
- 正式公开仓库前启用 GitHub Private Vulnerability Reporting。

## 已知限制

- 受入侵的同源代码可以读取浏览器本地凭据。
- 访问码是共享 Secret，不是独立账号。
- Serverless 进程内 Guard 不是全局配额。
- 浏览器直连绝对 Provider URL 会向该 Provider 暴露浏览器 IP 和请求。
- 第三方 OpenAI-compatible 与 Responses Gateway 可能与审查过的请求和 Stream
  Contract 不同。
- 项目当前不提供云备份、集中审计、组织角色或计费控制。
