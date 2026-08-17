# 路线图与暂缓边界

[English](./ROADMAP.md) · **简体中文**

[文档索引](./README_CN.md) · [安全策略](./SECURITY_CN.md) ·
[部署指南](./DEPLOYMENT_CN.md) · [发布政策](./RELEASES_CN.md) ·
[项目首页](../README_CN.md)

## 受限 CORS 代理

当前产品有意不代理任意 BYOK Base URL。如果真实使用表明浏览器 CORS 阻断了
重要 Provider，受限代理必须经过单独安全审查，并至少包含以下能力：

- 由部署方明确管理的 HTTPS 主机名白名单。
- 只允许 `/v1/models` GET 和 `/v1/chat/completions` POST 操作。
- 拒绝 URL 凭据、非标准端口、重定向、Loopback、私有地址、Link-local 地址、
  云元数据地址和非公开 DNS 结果。
- 防御 DNS Rebinding，并验证实际建立连接时使用的地址。
- 请求和响应大小限制、超时、并发与成本控制、最少且脱敏的审计数据，以及滥用
  响应方案。
- 浏览器直连 API Key 改为通过 CherryChat 部署转发前，必须让用户明确选择；不能
  静默回退。

不要通过客户端 URL 参数或 `x-base-url` Header 扩展现有固定目标路由。

## 其他暂缓工作

- 账号、云同步、团队、计费和共享历史。
- 由用户触发且可见的对话压缩与长期记忆。
- 语音、任意插件/MCP、通用自主 Agent 和非图片文件处理。
- 基于共享应用状态、具有全局一致性或账号感知能力的访问码配额；当前区域性
  Vercel WAF 和进程内 Guard 有意不提供此能力。
- 多个具名 BYOK 连接配置和跨设备凭据处理。
- 自定义生产域名以及任何由部署方付费的托管访问配置，包括经过验证的 Firewall、
  消费限额和运维说明。
- 超出当前[发布政策](./RELEASES_CN.md)范围的长期支持分支或兼容性承诺。

每一项都应进入新的需求与安全审查，而不是作为未经测试的开关直接加入当前 Chat
Completions Runtime。

OpenAI Chat Completions、OpenAI Responses、原生 Anthropic 和 Gemini Transport，
以及内置的有界 Tavily、Exa 和 Grok 网络搜索 Provider，都是当前产品能力，而不是
暂缓路线图项目。OpenAI-compatible 图片生成及兼容 Endpoint 的有序参考图编辑同样
属于当前能力。

## 产品边界

CherryChat 当前面向需要专注、可自托管 Web 客户端的个人用户和小型团队。账号、
共享云端状态、组织控制、集中审计和计费需要不同的信任模型与数据模型；当前访问码
功能并不隐含这些能力。
