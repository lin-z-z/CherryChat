# 变更记录

[English](./CHANGELOG.md) · **简体中文**

本文记录 CherryChat 的可追溯发布版本。英文版本是 Release notes 的基准；简体中文
版本必须保持相同的能力与限制边界。

## [0.1.0] - 2026-08-10

### 摘要

`v0.1.0` 是 CherryChat 首个可追溯的 Beta（预览版）版本。CherryChat 是轻量、
隐私优先、可自托管的 Web AI 对话客户端。Beta 表示文档内工作流已经可用并受到
自动化质量门保护；它不代表 Stable 或企业级支持。

### 主要能力

- 浏览器本地对话、分支、附件、助手、本地搜索、打印和导入导出工作流。
- 支持 OpenAI Chat Completions、OpenAI Responses、原生 Anthropic、原生 Gemini、
  New API Endpoint Metadata 和通用 OpenAI-compatible Chat Endpoint 的 BYOK 连接。
- 模型感知推理控制、流式答案与推理展示、图片输入和有界 Tavily 网络搜索。
- 可选的部署方 Hosted access，通过固定上游、访问码、签名 HttpOnly Session、模型
  白名单和有界服务端路由提供能力。
- Backup v2、经过校验的导入，以及不含凭据的导出。
- 格式、文档、Lint、严格 TypeScript、覆盖率、脚本、生产构建、依赖审计、客户端
  Secret 扫描，以及 Chromium 桌面端和移动端浏览器质量门。

### 已知限制

- 不提供账号、云同步、组织角色、集中审计、全局用量账本或计费控制。
- 浏览器保存的 BYOK 凭据只是便利存储，并非加密密码库；对话和设置保留在当前
  浏览器中。
- Hosted access 只支持部署固定的 OpenAI-compatible Chat Completions 路径。原生
  Provider、OpenAI Responses 和 New API Endpoint Routing 仍属于 BYOK 能力。
- 仓库 CI 通过不能证明某个 Vercel 域名、环境变量、Firewall 规则、消费限额或上游
  Provider 已正确配置。
- 不提供安全响应 SLA、漏洞奖励或旧版本维护分支。

### 升级与备份

本版本不引入新的数据 Schema 迁移。更新部署或浏览器安装前，请创建完整 Backup v2
并保存在浏览器 Profile 之外。备份与普通导出有意排除 API Key、访问码、Cookie 和
凭据摘要。

向已有浏览器 Profile 导入前，请阅读[数据与备份行为](./docs/DATA_CN.md)。

### 部署与安全

BYOK-only 部署不需要在 Vercel 中配置 Provider 凭据。Hosted access 必须使用完整
服务端配置，并由部署者设置 Firewall 与消费控制。Vercel Production Alias 不会
改变产品的 Beta 状态。

发布实例或版本前，请阅读[部署指南](./docs/DEPLOYMENT_CN.md)、
[安全策略](./docs/SECURITY_CN.md)和[发布政策](./docs/RELEASES_CN.md)。
