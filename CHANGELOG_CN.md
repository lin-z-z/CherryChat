# 变更记录

[English](./CHANGELOG.md) · **简体中文**

本文记录 CherryChat 的可追溯发布版本。英文版本是 Release notes 的基准；简体中文
版本必须保持相同的能力与限制边界。

## [Unreleased]

## [1.1.0] - 2026-08-18

### 摘要

`v1.1.0` 在 `v1.0.0` 建立的浏览器本地、BYOK、Hosted access、搜索、备份和
部署稳定契约上，增加了集成图片生成与参考图编辑能力。

### 主要能力

- 新增独立图片生成模式，内置 `gpt-image-2` BYOK 连接，并提供分辨率、宽高比、
  质量、格式和压缩控制。
- 支持通过兼容的 OpenAI 风格生成/编辑 Endpoint，根据提示词或最多 16 张有序
  参考图生成图片。
- 新增由部署方付费的 Hosted 图片生成，可使用单组旧版配置或服务端 Profile 白名单，
  且不会向访问码用户暴露上游凭据或 URL。
- 图片生成消息会保存生成快照与本地生成图片附件，并支持 Backup v2 往返恢复以及
  JSON/Markdown 导出。

### 变更

- 浏览器 BYOK 图片设置简化为一个服务 URL 和 API Key，模型固定为 `gpt-image-2`；
  多 Profile 仍仅属于 Hosted 部署能力。
- 图片服务 Root 与 `/v1` Base 会规范化为标准 `/v1/images/generations` 和
  `/v1/images/edits` Endpoint，并增加有界图片响应和更严格的 Hosted URL 校验。
- 关于页面改为从 Package 元数据读取应用版本并提供仓库链接；同时优化用户消息
  展示和行内编辑。
- 本地开发改用 Webpack，以提高 Windows 上的启动稳定性。

### 已知限制

- CherryChat 不提供图片生成额度或 Provider 服务。BYOK 用户和部署者需要自行承担
  Provider 可用性、费用、限流和内容政策合规责任。
- 浏览器直连图片生成要求 Provider 支持 CORS。兼容性取决于所配置服务是否支持
  文档约定的 OpenAI 风格 Endpoint 与参数；兼容服务可能只实现其中一部分。
- 生成图片保存在当前浏览器中，可能显著增加 IndexedDB 和 Backup v2 体积。
  CherryChat 仍不提供账号、云同步、全局用量账本、计费控制或托管服务 SLA。

### 升级与备份

本版本没有新增 IndexedDB Schema 迁移。Backup v2 现在可以往返保存生成图片和有序
参考图关系。更新现有部署或浏览器 Profile 前请先创建完整备份；凭据仍会被有意排除。

### 部署与安全

BYOK-only 图片生成不需要部署端凭据。Hosted 图片生成要求完整的 Hosted access
配置，并额外提供一组旧版图片配置或 Profile 白名单。向其他用户开放前，应独立验证
固定上游、消费限额、Firewall 策略、Function 日志和真实生成/编辑行为；仓库 CI
不能证明这些部署属性。

## [1.0.0] - 2026-08-12

### 摘要

`v1.0.0` 是 CherryChat 首个正式稳定版本。CherryChat 是轻量、隐私优先、可自托管
的 Web AI 对话客户端。本版本稳定了文档内的浏览器本地数据、BYOK、Hosted access、
搜索、备份和部署契约，同时保留下列限制。

### 主要能力

- 浏览器本地对话、分支、附件、助手、本地搜索、打印和导入导出工作流。
- 支持 OpenAI Chat Completions、OpenAI Responses、原生 Anthropic、原生 Gemini、
  New API Endpoint Metadata 和通用 OpenAI-compatible Chat Endpoint 的 BYOK 连接。
- 模型感知推理控制、流式答案与推理展示，以及图片输入。
- Tavily、Exa 和 Grok 网络搜索。Grok 默认使用 `grok-4.5`，并支持由部署者配置兼容
  URL、模型和可选的 X Search。
- 可选的部署方 Hosted access，通过固定上游、访问码、签名 HttpOnly Session、模型
  与搜索 Provider 白名单和有界服务端路由提供能力。Hosted 用户可以在已配置的搜索
  Provider 中选择，但不会收到 Provider 凭据或服务端专属选项。
- Backup v2、经过校验的导入，以及不含凭据的导出。
- 格式、文档、Lint、严格 TypeScript、覆盖率、脚本、生产构建、依赖审计、客户端
  Secret 扫描，以及 Chromium 桌面端和移动端浏览器质量门。

### 已知限制

- 不提供账号、云同步、组织角色、集中审计、全局用量账本、计费控制或企业支持承诺。
- 浏览器保存的 BYOK 凭据只是便利存储，并非加密密码库；对话和设置保留在当前
  浏览器中。
- Hosted 模型访问只支持部署固定的 OpenAI-compatible Chat Completions 路径。原生
  Provider、OpenAI Responses 和 New API Endpoint Routing 仍属于 BYOK 能力。
- Hosted 搜索 Provider、凭据、URL、Grok 模型和 X Search 行为由部署者配置；浏览器
  只能选择服务端白名单中的 Provider。
- 仓库 CI 通过不能证明某个 Vercel 域名、环境变量、Firewall 规则、消费限额或上游
  Provider 已正确配置。
- 不提供安全响应 SLA、漏洞奖励、长期支持分支或旧版本维护时间保证。

### 升级与备份

本版本不引入新的数据 Schema 迁移。更新部署或浏览器安装前，请创建完整 Backup v2
并保存在浏览器 Profile 之外。备份与普通导出有意排除 API Key、访问码、Cookie 和
凭据摘要。

向已有浏览器 Profile 导入前，请阅读[数据与备份行为](./docs/DATA_CN.md)。

### 部署与安全

BYOK-only 部署不需要在 Vercel 中配置 Provider 凭据。Hosted access 必须使用完整
服务端配置，并由部署者设置 Firewall 与消费控制。Vercel Production Alias 不代表
项目承诺托管服务可用性、安全响应时限或企业支持。

发布实例或版本前，请阅读[部署指南](./docs/DEPLOYMENT_CN.md)、
[安全策略](./docs/SECURITY_CN.md)和[发布政策](./docs/RELEASES_CN.md)。
