# 发布与版本政策

[English](./RELEASES.md) · **简体中文**

[文档索引](./README_CN.md) · [变更记录](../CHANGELOG_CN.md) ·
[部署指南](./DEPLOYMENT_CN.md) · [安全策略](./SECURITY_CN.md)

## 产品成熟度

CherryChat `v1.0.0` 是首个正式稳定版本。稳定性适用于文档内的产品、数据、配置和
发布契约，但不承诺长期支持、托管服务可用性、安全响应 SLA 或企业支持。

## 版本号

可追溯发布使用 `vMAJOR.MINOR.PATCH` Tag：

- `MAJOR` 表示不兼容的文档契约变更，必须提供明确的迁移与发布说明。
- `MINOR` 增加向后兼容的能力。
- `PATCH` 提供向后兼容的修复、安全加固、文档或发布修正。

`package.json`、`package-lock.json` 根版本、当前 Changelog 段落、Git Tag 和 GitHub
Release 必须一致。公开 Tag 不可移动。

## 发布内容

CherryChat 是 Web 应用，也是设置了 `private: true` 的 npm Package。Release 跟踪
源代码与文档；除非未来政策明确增加，否则不发布 npm 包、桌面/移动安装包、容器或
自定义构建资产。

Release 正文包含经过整理的英文 Changelog 段落、同版本中文 Changelog 链接、目标
Commit，以及 GitHub 自动生成的 Pull Request、贡献者和完整 Changelog 信息。

## 质量门

Release Candidate 必须是已经合入默认分支的确定 Commit，并且相同 SHA 的 `CI`
Push Workflow 必须成功完成，其中包括：

- 格式、文档、零 Warning Lint 和严格 TypeScript；
- 覆盖率和脚本回归测试；
- 生产构建、生产依赖与完整依赖审计，以及许可证清单；
- 客户端 Bundle 敏感值扫描；
- Chromium 桌面端与 Mobile Chrome 浏览器测试。

仓库 CI 不能替代对 Vercel 环境变量、Firewall 规则、消费限额、Function 日志、
域名状态或上游 Provider 行为的独立复核。

## 自动发布流程

`Release` GitHub Actions Workflow 只能在默认分支通过 `workflow_dispatch` 手动
启动。它不接受版本或 Commit 输入，并执行以下步骤：

1. 锁定所选默认分支 SHA，并从 `package.json` 读取版本。
2. 校验 Package Lock 版本、Changelog 段落、分支，以及目标 Tag/Release 不存在。
3. 等待相同 SHA 已有的 `CI` Push Run；Release Workflow 内不重复完整质量门。
4. 生成 GitHub Notes，并组合可审查的 Release 正文。
5. 只发起一次 Create Release 请求，由 GitHub 在锁定 SHA 创建对应 Tag。
6. 回读 Release 与 Tag 目标，并输出经过验证的 URL。

只有该 Workflow 获得 `actions: read` 和 `contents: write`；普通 CI 保持
`contents: read`。流程使用仓库 `GITHUB_TOKEN`，不使用 PAT、部署凭据或第三方发布
Action。

创建的 GitHub Release 是普通正式版而非 prerelease，会直接发布而非保存为 Draft，
并标记为 Latest。

## 失败与恢复

任何校验失败、CI 缺失/失败/取消、等待超时、冲突或 Notes 生成失败，都会在 Create
Release 请求前停止，并且不留下远端 Tag 或 Release。

如果 Create Release 响应结果不明确，Workflow 会回读两个对象：

- Release 和 Tag 都存在且指向锁定 SHA，表示成功；
- 两者都不存在，表示 Workflow 失败，可以重新触发；
- 仅存在一个对象，或 Tag 指向其他 SHA，需要人工复核。

自动化不会删除公开 Release，也不会移动或删除公开 Tag。发布后如有文档错误，可
修正 Release 正文和仓库文档；产品缺陷则发布新的 Patch 版本，例如 `v1.0.1`。

## 操作边界

准备并合入 Workflow 不等于批准发布。每次远端 Release 前，都必须复核候选 SHA、
成功 CI URL、组合后的 Notes 和预期远端写入，并再次明确批准 Workflow Run。
