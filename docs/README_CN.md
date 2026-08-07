# CherryChat 文档

[English](./README.md) · **简体中文**

[项目首页](../README_CN.md) ·
[在线 Demo](https://cherrychat-xi.vercel.app) ·
[参与贡献（英文）](../CONTRIBUTING.md) · [MIT 许可证](../LICENSE)

CherryChat 是面向个人用户和小型团队的轻量、隐私优先、可自托管 Web AI 客户端。
项目目前处于 Preview（预览版）MVP 阶段。本目录收录不适合全部堆放在主 README
中的技术说明和边界。

## 从这里开始

- [部署与连接模式](./DEPLOYMENT_CN.md) —— 通俗解释 BYOK、托管访问和自托管，并
  说明本地运行、环境变量、Vercel 部署和发布检查。
- [模型和协议兼容性](./MODEL_COMPATIBILITY_CN.md) —— 端点路由、Provider 适配、
  模型推理控制和兼容性限制。
- [安全策略与模型](./SECURITY_CN.md) —— 凭据边界、公开部署风险、内容安全和漏洞
  私密报告渠道。
- [数据与备份行为](./DATA_CN.md) —— 浏览器存储、删除、Backup v2、导入校验和
  单对话导出。
- [路线图与暂缓边界](./ROADMAP_CN.md) —— 当前有意暂缓的产品和安全工作。
- [开源许可证与归属（英文）](../LICENSES.md) —— 主要第三方依赖和许可证信息。

## 项目成熟度

当前仓库已经配置格式检查、Lint、严格 TypeScript、覆盖率、脚本回归、生产构建、
依赖审计、客户端 Bundle 敏感值扫描，以及 Chromium 桌面端和移动端浏览器质量门。
本地或 CI 通过并不能证明某个 Vercel 项目、域名、Firewall 规则、环境变量或上游
Provider 已正确配置；这些内容仍需要独立的真实部署验证。

CherryChat 当前不提供账号、云同步、组织角色、全局用量账本、计费或集中审计。
在这些边界经过专门设计和验证前，不应将项目描述为企业协作平台。

## 文档维护策略

- `README.md` 与 `README_CN.md` 是对等的产品入口。
- 本目录中的每份正式文档均提供英文基准版本和完整简体中文对应版本。如果两者
  出现差异，在修正翻译前以英文版本为准。
- 两种语言必须同步维护相同的导航、产品边界和安全警告。
- 公开陈述必须与当前代码和测试一致；Provider 特定结论必须限定到实际审查过的
  Endpoint 和请求格式。
- 安全漏洞应通过
  [GitHub Security Advisories](https://github.com/lin-z-z/CherryChat/security/advisories/new)
  私密报告，而不是提交公开 Issue。
- 历史内部审查以及本地 Trellis 任务、Journal 和 Session 状态不属于公开文档。
