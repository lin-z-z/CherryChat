# 模型和协议兼容性

[English](./MODEL_COMPATIBILITY.md) · **简体中文**

[文档索引](./README_CN.md) · [部署指南](./DEPLOYMENT_CN.md) ·
[安全策略](./SECURITY_CN.md) · [项目首页](../README_CN.md)

CherryChat 将选中的连接协议与模型能力分开处理。只有当前模型和 Endpoint 都能编码
某项能力时，界面才会显示对应控件。系统不会根据 Provider 名称或 Base URL 主机名
静默猜测另一种 Wire Protocol。

## 协议适配器

| API 类型                | 主要操作                                                             | 可用范围                                    |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| OpenAI Chat Completions | `POST /v1/chat/completions`                                          | BYOK 直连、同源固定代理和托管访问。         |
| OpenAI Responses        | `POST /v1/responses`                                                 | BYOK 直连和 New API Metadata Routing。      |
| Anthropic               | `POST /v1/messages`                                                  | 原生 BYOK 直连和 New API Metadata Routing。 |
| Gemini                  | `POST /v1beta/models/{model}:streamGenerateContent` 或 Generate 操作 | 原生 BYOK 直连和 New API Metadata Routing。 |
| New API                 | `GET /v1/models`，然后按模型选择 Endpoint                            | 仅 BYOK。                                   |
| OpenAI-compatible       | `POST /v1/chat/completions`                                          | BYOK 直连或同源固定代理。                   |

无论浏览器最后保存的 API 类型是什么，托管访问始终使用固定的 OpenAI-compatible
Chat Completions Adapter。

## Base URL 规则

- 填写 Provider Root 或它的 `/v1` Base，不要填写完整操作 URL。
- OpenAI Responses 会规范化 Base，并追加 `/v1/responses`。
- Anthropic 会追加 `/v1/messages`。
- Gemini 会规范化为 Google-compatible API Root，然后构建模型操作路径。
- OpenAI Chat 和通用 Compatible Adapter 会按需追加 `/v1/models` 和
  `/v1/chat/completions`。
- Base URL 留空仅对固定同源 OpenAI-compatible BYOK 路径有意义。

不同 Provider 和 Gateway 可能采用不同 URL 约定。模型列表请求成功并不能证明聊天
路径正确，请先检查浏览器最终发出的请求。

## New API Endpoint Metadata

对于 New API 连接，CherryChat 会读取 `/v1/models` 返回的每个模型中的
`supported_endpoint_types`，并识别以下值：

| Metadata 值               | CherryChat Endpoint          |
| ------------------------- | ---------------------------- |
| `openai`                  | OpenAI Chat Completions      |
| `openai-response`         | OpenAI Responses             |
| `openai-response-compact` | OpenAI Responses             |
| `anthropic`               | 原生 Anthropic Messages      |
| `gemini`                  | 原生 Gemini Generate Content |

缺少 Endpoint Metadata 时，模型回退到 OpenAI Chat Completions。Gateway 需要自行
保证 Metadata 的顺序和准确性。

## 共享能力

当前 Adapter 和测试覆盖：

- 流式文本和用量投影。
- 有界 Tavily、Exa 和 Grok 网络搜索流程共用的模型可见 `web_search` 工具。
- 解析后的模型和 Endpoint 支持时的图片输入。
- 推理展示和 Provider 特定 Continuation Context。
- 按模型保存的 Streaming、Temperature、Top P、Context Window、Vision、Tool 和
  Reasoning 能力覆盖项。
- 消息分支重新生成、对话持久化、备份和导出。

CherryChat 支持某项能力，并不保证每个 Compatible Gateway 都支持它。第三方服务
可能拒绝 Provider 扩展字段、省略 Stream Event，或返回不完整的 Endpoint Metadata。

## OpenAI Responses 边界

OpenAI Responses 通过专用 BYOK Adapter 实现，也可以由 New API Endpoint
Metadata 选中。CherryChat 维护自己的本地对话树，不把 Provider 端对话选择作为
用户工作流暴露。

当前实现以 OpenAI 为优先基准。第三方 Responses-compatible 服务必须逐个验证，
尤其要检查推理 Stream Event 名称、加密推理续传、Tool-call Continuation 和不支持
的请求字段。选择 Responses 不代表所有 DeepSeek、GLM、Qwen、Kimi 或通用 Gateway
变体都完全兼容。

## OpenAI Chat 推理控制

以下 Provider 特定控制只在所选 Endpoint 解析为 OpenAI Chat Completions 时生效。
CherryChat 匹配经过审查的模型 ID，不会根据主机名推断这些合同。

### DeepSeek V4

- DeepSeek V4 Flash：模型默认、关闭、Low、High 和 Max。
- DeepSeek V4 Pro：模型默认、关闭、High 和 Max。
- 模型默认不发送 `thinking` 和 `reasoning_effort`。
- 关闭时发送禁用的 `thinking`。
- 明确选择等级时发送启用的 `thinking` 和对应的 `reasoning_effort`。
- 模型默认和启用推理时不发送 Temperature 与 Top P，因为经过审查的 DeepSeek
  Thinking Contract 会忽略它们。
- 只有具备所需 Tool History 时，才保留有界的 Assistant `reasoning_content`。

### GLM

- GLM-5.2：模型默认、关闭、High 和 Max。
- 经过审查的 GLM-5.1、GLM-5、GLM-5-Turbo 和 GLM-4.5/4.6/4.7 文本变体：
  模型默认、关闭和开启。
- Vision、专用多模态和未经审查的未来变体不会自动获得这些控制。
- 启用推理时发送 `thinking.enabled` 和 `clear_thinking:false`；GLM-5.2 还会发送
  所选 Effort。
- GLM 保留有效的 Temperature 和 Top P 偏好。
- 只有明确启用保留推理并具有 Tool History 时，才保留 `reasoning_content`。

### Qwen

- `qwen3.8-max`：模型默认、关闭、Low、Medium 和 XHigh。
- 经过审查的 Preview 变体不提供关闭选项。
- 其他经过审查的混合推理 Qwen 模型使用模型默认、关闭和开启，不虚构数值 Budget。
- Qwen3.8 发送 `enable_thinking:false` 或经过审查的 Effort；其他 Hybrid Qwen
  只发送 `enable_thinking`。
- 有效的 Temperature 和 Top P 偏好仍然可用。
- Qwen3.8 在推理未关闭时，可以为普通轮次和工具轮次保留 Continuation Context。

### Kimi K3

- 可用选项为模型默认、Low、High 和 Max。
- 不提供关闭状态。
- Adapter 只发送经过审查的 `reasoning_effort`，并省略 Temperature 和 Top P。
- 普通轮次和工具轮次都可以保留有界 Continuation Context。

不同 Provider Family 的 Continuation Context 分别归属并独立校验。CherryChat 不会
把一个 Provider Family 的隐藏数据重放给另一个 Family。

## 报告兼容性问题

报告兼容性问题时，请包含：

- API 类型和连接模式。
- 不含凭据或私有主机名的脱敏 Base URL 形态。
- Provider 返回的精确模型 ID。
- New API `supported_endpoint_types`（如果适用）。
- 模型列表、非流式标题生成、流式聊天、工具和 Continuation 是否分别成功。
- 脱敏 HTTP Status 和稳定的 CherryChat Error Code。

不要在公开 Issue 中附加 API Key、访问码、Cookie、完整私人 Prompt、原始 Vercel
环境输出或未脱敏的 Provider Response。
