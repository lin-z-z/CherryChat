# 数据与备份行为

[English](./DATA.md) · **简体中文**

[文档索引](./README_CN.md) · [安全策略](./SECURITY_CN.md) ·
[部署指南](./DEPLOYMENT_CN.md) · [项目首页](../README_CN.md)

## 浏览器存储

IndexedDB 是对话、消息分支、附件、非敏感设置、模型能力覆盖项和元数据的事实来源。
连接凭据保存在独立的连接/凭据记录中，因此普通搜索、导出和备份流程不会读取它们。

当前浏览器 Schema 版本为 7。迁移会删除已废弃的对话级
`contextMessageLimit` 和 `advancedSettings` 属性，同时保留对话标识、Assistant
快照、当前模型状态、消息、分支、附件和网络搜索状态。

如果 IndexedDB 无法打开，CherryChat 会为聊天历史创建页面内存数据库，并且只用
localStorage 保存当前连接 Bundle。界面会显示警告，说明刷新或关闭后聊天会消失。
图片和消息历史不会被强制写入 localStorage。

## 删除操作

- 删除一个对话会移除它的全部分支，并且只释放不再被任何剩余消息引用的附件。
- 清空全部对话会删除所有对话、分支和附件，同时保留凭据与设置。
- 清除全部本地数据会删除 CherryChat 数据库、所有 `cherrychat.*` localStorage
  Key、内存预览和托管访问 Session Cookie；不会清除其他站点或无关 localStorage
  Key。
- 归档只改变可见性，不会删除消息或图片。

所有破坏性界面操作都要求浏览器明确确认。

## 完整备份

版本 2 ZIP 格式包含 `backup.json` 和独立附件文件。Manifest 包含全部分支、图片
元数据、非敏感设置和能力覆盖项，不包含 API Key、访问码、Cookie 或凭据摘要。
新归档不再写入已废弃的对话属性；包含这些属性的既有 v2 归档仍可读取，Importer
会先校验其旧格式，再丢弃这些属性。

完整备份还会保留 Stateless Replay 所需、经过校验的 Provider Continuation
Context，其中包括分别归属 DeepSeek、GLM、Qwen 和 Kimi Chat 的
`reasoning_content`。GLM Context 只在明确启用保留推理时创建；Qwen Context 只在
Qwen3.8 且推理没有关闭时创建；Kimi K3 始终保留结构化推理。DeepSeek/GLM 需要
Tool-call 历史，Qwen3.8/Kimi 还会保留没有工具的普通轮次。每个 Chat Owner 最多
保留五步，每个文本块最多 1 MiB，每条 Assistant 消息的文本最多 4 MiB。这些隐藏
部分可以经过 ID 重映射继续存在，但普通 JSON、Markdown、打印、复制、搜索和消息
渲染均不会输出它们。

导入会在写入前校验格式版本、Schema、各实体数量、JSON 深度和节点数、文件数量、
压缩与解压大小、安全路径、引用完整性、消息树无环性、图片 MIME 类型和 SHA-256
Hash。消息树校验对消息数量保持线性复杂度，不会反复遍历每条 Parent Chain。导入
ID 会重新映射，Merge 在一个 Dexie Transaction 中完成，因此无效或失败的导入不
会部分覆盖现有数据。凭据必须重新输入。

## 单对话导出

- JSON 保留全部消息分支、角色、模型、用量和附件元数据。
- Markdown 导出当前分支。包含图片的对话会生成 ZIP，其中 Markdown 使用相对图片
  路径，而不是 IndexedDB URL 或大型 Base64 值。
- 打印预览使用适合 PDF 的样式渲染当前分支。

三种导出路径使用同一套推理投影。默认不导出推理，只有用户启用导出选项后才会
包含。

## 兼容性

IndexedDB Schema 版本和备份格式版本彼此独立。数据库迁移通过旧 Fixture 测试，
并且必须保留消息 Part 和附件引用。已发布的备份版本必须继续提供兼容 Reader，
不能被不兼容格式静默覆盖。

因此数据库版本 7 不要求 Backup v3：当前 Backup v2 Reader 接受两个已知旧属性，
在写事务前将其移除，并继续拒绝其他未知对话属性。

## 安全提示

浏览器存储仅限当前浏览器 Profile，CherryChat 不会加密这些数据，也不会将其同步
到云端。即使备份不包含凭据，也应把完整备份视为私人对话数据。分享前请检查导入
文件，并使用操作系统保护浏览器 Profile。
