import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatShell } from "@/components/chat-shell";
import { Providers } from "@/components/providers";
import { useChatController } from "@/features/chat/use-chat-controller";
import type {
  ConversationRecord,
  MessageNode,
  MessageStatus,
} from "@/runtime/chat/types";
import {
  createDefaultAssistantSnapshot,
  createDefaultModelPreferences,
  DEFAULT_ASSISTANT_ID,
} from "@/runtime/chat/types";
import { getEndpointProfile } from "@/runtime/models/endpoint-profiles";
import { resolveEffectiveModelCapability } from "@/runtime/models/effective-model-capabilities";
import { resolveModelCapability } from "@/runtime/models/model-capabilities";
import { DEFAULT_REQUEST_TIMEOUT_POLICY } from "@/runtime/transport/request-timeout-policy";
import type { StreamSnapshot } from "@/runtime/streaming/stream-state";

vi.mock("@/features/chat/use-chat-controller", () => ({
  useChatController: vi.fn(),
}));

const conversation: ConversationRecord = {
  id: "conversation-1",
  title: "Terminal state regression",
  titleSource: "local",
  archived: false,
  activeLeafId: "message-1",
  activeModelId: "gpt-4.1-mini",
  contextCutoffId: null,
  assistantId: DEFAULT_ASSISTANT_ID,
  assistantSnapshot: createDefaultAssistantSnapshot(),
  autoTitle: true,
  webSearchEnabled: false,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

const activeStream: StreamSnapshot = {
  state: "connecting",
  reasoningText: "",
  finalText: "",
  reasoningSource: null,
  tagState: "before-content",
  usage: null,
  toolCalls: [],
  contentParts: [],
  providerContextParts: [],
  reasoningDurationMs: null,
  startedAt: 1,
  updatedAt: 1,
};

function createAssistantMessage(status: MessageStatus): MessageNode {
  return {
    id: "message-1",
    conversationId: conversation.id,
    parentId: null,
    role: "assistant",
    parts: [],
    status,
    modelSnapshot: null,
    usage: null,
    error: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

function createUserMessage(): MessageNode {
  return {
    ...createAssistantMessage("completed"),
    role: "user",
    parts: [{ type: "text", text: "User bubble content" }],
  };
}

function createController(
  message?: MessageNode,
  stream: StreamSnapshot | null = null,
): ReturnType<typeof useChatController> {
  const messages = message ? [message] : [];

  return {
    ready: true,
    online: true,
    updateAvailable: false,
    reloadForUpdate: vi.fn(),
    storageDegraded: false,
    publicConfig: {
      appVersion: "1.2.1",
      byokEnabled: true,
      hostedEnabled: true,
      hostedWebSearchEnabled: false,
      hostedWebSearchProvider: null,
      hostedWebSearchProviders: [],
      hostedImageGenerationProfiles: [],
      hostedImageGenerationDefaultProfileId: null,
      models: ["gpt-4.1-mini"],
      defaultModel: "gpt-4.1-mini",
      titleModel: "gpt-4.1-mini",
      authenticated: false,
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    },
    connection: {
      mode: "byok",
      baseUrl: "https://api.openai.com",
      apiKey: "",
      accessCode: "",
      modelId: "gpt-4.1-mini",
      apiType: "openai",
    },
    defaultModel: "gpt-4.1-mini",
    titleModel: "gpt-4.1-mini",
    enabledModels: ["gpt-4.1-mini", "gpt-5-mini"],
    availableModels: ["gpt-4.1-mini", "gpt-5-mini"],
    models: ["gpt-4.1-mini"],
    webSearchConfig: {
      enabled: false,
      maxResults: 5,
      provider: "tavily",
      hostedProvider: null,
      providers: {
        tavily: {
          apiKey: "",
          baseUrl: "https://api.tavily.com",
          hasApiKey: false,
        },
        exa: {
          apiKey: "",
          baseUrl: "https://api.exa.ai",
          hasApiKey: false,
        },
        grok: {
          apiKey: "",
          responsesUrl: "https://api.x.ai/v1/responses",
          model: "grok-4.5",
          xSearch: false,
          hasApiKey: false,
        },
      },
      hasApiKey: false,
    },
    imageGenerationConfig: {
      profiles: [
        {
          id: "default",
          name: "GPT Image 2",
          mode: "byok" as const,
          baseUrl: "https://api.openai.com",
          apiKey: "",
          modelId: "gpt-image-2",
          sizeMode: "auto" as const,
          hasApiKey: false,
        },
      ],
      defaultProfileId: "default",
      activeProfileId: "default",
      activeHostedProfileId: null,
      parametersByProfile: {
        default: {
          resolutionTier: "1K" as const,
          aspectRatio: "1:1" as const,
          size: "1024x1024",
          quality: "auto" as const,
          outputFormat: "png" as const,
          outputCompression: null,
        },
      },
    },
    imageGenerationProfiles: [],
    activeImageGenerationProfile: null,
    imageGenerationParameters: {
      resolutionTier: "1K" as const,
      aspectRatio: "1:1" as const,
      size: "1024x1024",
      quality: "auto" as const,
      outputFormat: "png" as const,
      outputCompression: null,
    },
    composerMode: "chat" as const,
    setComposerMode: vi.fn(),
    webSearchSource: null,
    webSearchEnabled: false,
    webSearchAvailable: false,
    capability: null,
    modelPreferences: createDefaultModelPreferences(),
    reasoningChoice: { mode: "default" as const },
    setReasoningChoice: vi.fn(),
    conversations: message ? [conversation] : [],
    archivedConversations: [],
    assistants: [],
    currentConversation: message ? conversation : null,
    path: messages,
    allMessages: messages,
    draft: "",
    setDraft: vi.fn(),
    pendingAttachments: [],
    imageReferences: [],
    attachmentUrls: {},
    activeGeneration:
      message && stream
        ? {
            id: "generation-1",
            conversationId: conversation.id,
            assistantMessageId: message.id,
            snapshot: stream,
          }
        : null,
    generationStarting: false,
    activeImageGeneration: null,
    imageGenerationStarting: false,
    stream,
    contextStats: null,
    error: null,
    setError: vi.fn(),
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    searchOpen: false,
    setSearchOpen: vi.fn(),
    searchQuery: "",
    searchResults: [],
    createConversation: vi.fn(),
    selectAssistant: vi.fn(),
    saveAssistant: vi.fn(),
    deleteAssistant: vi.fn(),
    loadConversation: vi.fn(),
    saveConnection: vi.fn(async () => undefined),
    saveDefaultModel: vi.fn(async (modelId: string) => modelId),
    saveTitleModel: vi.fn(async (modelId: string) => modelId),
    saveEnabledModels: vi.fn(async (modelIds: readonly string[]) => [
      ...modelIds,
    ]),
    refreshModels: vi.fn(async () => ["gpt-4.1-mini"]),
    saveWebSearchSettings: vi.fn(),
    saveImageGenerationSettings: vi.fn(),
    selectImageGenerationProfile: vi.fn(),
    setImageGenerationParameters: vi.fn(),
    setImageGenerationSize: vi.fn(),
    setImageGenerationQuality: vi.fn(),
    testWebSearch: vi.fn(),
    setConversationWebSearch: vi.fn(async () => undefined),
    send: vi.fn(),
    regenerateAssistant: vi.fn(async () => undefined),
    stop: vi.fn(),
    addImages: vi.fn(),
    removePendingAttachment: vi.fn(),
    addImageReferences: vi.fn(),
    addStoredImageReference: vi.fn(async () => undefined),
    removeImageReference: vi.fn(),
    reorderImageReferences: vi.fn(),
    archiveConversation: vi.fn(),
    renameConversation: vi.fn(),
    restoreConversation: vi.fn(),
    deleteConversation: vi.fn(),
    clearAllConversations: vi.fn(),
    selectModel: vi.fn(),
    resolveModelCapability: vi.fn(async () => null),
    resolveModelExecutionCapability: vi.fn(async () => null),
    resolveModelPreferences: vi.fn(async () => createDefaultModelPreferences()),
    saveModelSettings: vi.fn(),
    resetModelSettings: vi.fn(),
    saveModelCapability: vi.fn(),
    resetModelCapability: vi.fn(),
    saveCapabilityOverride: vi.fn(),
    resetCapabilityOverride: vi.fn(),
    selectVersion: vi.fn(),
    editMessage: vi.fn(async () => undefined),
    editAndRegenerate: vi.fn(async () => undefined),
    generateUserMessage: vi.fn(async () => undefined),
    setContextCutoff: vi.fn(),
    search: vi.fn(),
    openSearchResult: vi.fn(),
    clearAllLocalData: vi.fn(),
    createBackup: vi.fn(),
    inspectBackup: vi.fn(),
    restoreBackup: vi.fn(),
    exportCurrentJson: vi.fn(),
    exportCurrentMarkdown: vi.fn(),
    loadPrintProjection: vi.fn(),
    refreshLists: vi.fn(),
  };
}

function renderShell() {
  return render(
    <Providers initialLanguage="zh-CN">
      <ChatShell />
    </Providers>,
  );
}

describe("ChatShell", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(useChatController).mockReturnValue(createController());
  });

  it("renders the localized shell", () => {
    renderShell();

    expect(
      screen.getByRole("heading", { name: "CherryChat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "今天想聊点什么？" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "给 CherryChat 发消息" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "对话" }).querySelector("svg"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "生图" }).querySelector("svg"),
    ).toBeInTheDocument();
  });

  it("does not announce a model switch before a chat has started", async () => {
    const controller = createController();
    const selectModel = vi.fn().mockResolvedValue(null);
    vi.mocked(useChatController).mockReturnValue({
      ...controller,
      models: ["gpt-4.1-mini", "gpt-5-mini"],
      selectModel,
    });

    renderShell();
    fireEvent.click(
      screen.getByRole("button", { name: "已选择模型：gpt-4.1-mini" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "gpt-5-mini" }));

    await waitFor(() => expect(selectModel).toHaveBeenCalledWith("gpt-5-mini"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a successful model switch inside an active chat", async () => {
    const controller = createController();
    const selectModel = vi.fn().mockResolvedValue({
      conversationId: conversation.id,
      from: "gpt-4.1-mini",
      to: "gpt-5-mini",
    });
    vi.mocked(useChatController).mockReturnValue({
      ...controller,
      currentConversation: conversation,
      models: ["gpt-4.1-mini", "gpt-5-mini"],
      path: [createUserMessage()],
      selectModel,
    });

    renderShell();
    fireEvent.click(
      screen.getByRole("button", { name: "已选择模型：gpt-4.1-mini" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "gpt-5-mini" }));

    expect(selectModel).toHaveBeenCalledWith("gpt-5-mini");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "模型已由 gpt-4.1-mini 切换为 gpt-5-mini",
    );
    expect(screen.getByRole("status").closest(".message-column")).toBeTruthy();
  });

  it("shows the persisted model snapshot on assistant replies", () => {
    const message = {
      ...createAssistantMessage("completed"),
      parts: [{ type: "text" as const, text: "Model-specific answer" }],
      modelSnapshot: {
        modelId: "gpt-5-mini",
        connectionScope: "byok:https://api.openai.com",
      },
    };
    vi.mocked(useChatController).mockReturnValue(createController(message));

    renderShell();

    expect(screen.getByText("模型：gpt-5-mini")).toBeInTheDocument();
  });

  it("keeps settings unavailable until the controller is ready", () => {
    const controller = createController();
    vi.mocked(useChatController).mockReturnValue({
      ...controller,
      ready: false,
    });

    const { container } = renderShell();
    const settingsTriggers = container.querySelectorAll<HTMLButtonElement>(
      "[data-settings-trigger]",
    );

    expect(container.querySelectorAll("aside[aria-label]")).toHaveLength(1);
    expect(settingsTriggers).toHaveLength(1);
    settingsTriggers.forEach((trigger) => expect(trigger).toBeDisabled());
  });

  it("shows stop instead of send while generation is starting", () => {
    const controller = createController();
    vi.mocked(useChatController).mockReturnValue({
      ...controller,
      generationStarting: true,
    });

    renderShell();

    expect(
      screen.getByRole("button", { name: "停止生成" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止生成" })).toHaveClass(
      "stop-button",
    );
    expect(
      screen.queryByRole("button", { name: "发送" }),
    ).not.toBeInTheDocument();
  });

  it("separates the input from the lower composer action row", () => {
    const controller = createController();
    vi.mocked(useChatController).mockReturnValue({
      ...controller,
      capability: {
        modelId: controller.connection.modelId,
        reasoning: true,
        supportedEfforts: ["low", "medium", "high"],
        vision: true,
        tools: true,
        contextWindow: 400_000,
        temperature: "unsupported",
        topP: "unsupported",
        source: "builtin",
        endpoint: {
          apiType: "openai",
          reasoningFormat: "openai-chat",
          reasoning: "supported",
          vision: "supported",
          streaming: "supported",
          temperature: "supported",
          topP: "supported",
          tools: "supported",
        },
        reasoningControl: {
          kind: "effort",
          options: [
            { mode: "default" },
            { mode: "effort", effort: "low" },
            { mode: "effort", effort: "medium" },
            { mode: "effort", effort: "high" },
          ],
        },
        reasoningWireFormat: "openai-chat",
        streaming: "supported",
      },
    });

    const { container } = renderShell();
    const frame = container.querySelector(".composer-frame");
    const frameItems = Array.from(frame?.children ?? []);
    const input = frame?.querySelector(".composer-input-shell");
    const actionRow = frame?.querySelector(".composer-action-row");
    const leftControls = actionRow?.querySelector(".composer-toolbar-left");
    const rightControls = actionRow?.querySelector(".composer-toolbar-right");
    const rightControlItems = Array.from(rightControls?.children ?? []);
    const upload = leftControls?.querySelector(".composer-tool-button");
    const reasoning = rightControls?.querySelector('[name="reasoningEffort"]');
    const send = rightControls?.querySelector(".send-button");

    expect(upload).toBeTruthy();
    expect(upload?.tagName).toBe("BUTTON");
    expect(leftControls).toBeTruthy();
    expect(input).toBeTruthy();
    expect(actionRow).toBeTruthy();
    expect(rightControls).toBeTruthy();
    expect(reasoning).toBeTruthy();
    expect(send).toBeTruthy();
    expect(input?.querySelector("textarea")).toBeTruthy();
    expect(actionRow?.querySelector("textarea")).toBeNull();
    expect(frameItems.indexOf(input as Element)).toBeLessThan(
      frameItems.indexOf(actionRow as Element),
    );
    expect(rightControlItems.indexOf(reasoning as Element)).toBeLessThan(
      rightControlItems.indexOf(send as Element),
    );
  });

  it("toggles Tavily search from the composer when it is configured", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.webSearchAvailable = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(
      screen.getByRole("button", { name: "为当前对话启用网络搜索" }),
    );

    expect(controller.setConversationWebSearch).toHaveBeenCalledWith(true);
  });

  it("allows an enabled chat to turn search off after the key is removed", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.webSearchEnabled = true;
    controller.webSearchAvailable = false;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    const button = screen.getByRole("button", {
      name: "关闭当前对话的网络搜索",
    });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(controller.setConversationWebSearch).toHaveBeenCalledWith(false);
  });

  it("exposes the disabled web-search reason to keyboard users", () => {
    renderShell();

    expect(
      screen.getByRole("note", {
        name: "请先在设置中配置网络搜索",
      }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("does not submit an Enter key while an IME composition is active", () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit");

    renderShell();
    fireEvent.keyDown(screen.getByRole("textbox"), {
      isComposing: true,
      key: "Enter",
      keyCode: 13,
    });

    expect(requestSubmit).not.toHaveBeenCalled();
    requestSubmit.mockRestore();
  });

  it("does not paste an image when the active model lacks vision", () => {
    const controller = createController();
    vi.mocked(useChatController).mockReturnValue(controller);
    const image = new File(["image"], "pasted.png", { type: "image/png" });

    renderShell();
    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        items: [
          {
            getAsFile: () => image,
            kind: "file",
            type: "image/png",
          },
        ],
      },
    });

    expect(controller.addImages).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "添加图片" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('input[name="images"]')).toBeNull();
  });

  it("keeps user message actions outside the visual bubble", () => {
    vi.mocked(useChatController).mockReturnValue(
      createController(createUserMessage()),
    );

    const { container } = renderShell();
    const article = container.querySelector("article.message-user");
    const stack = article?.querySelector(":scope > .message-user-stack");
    const bubble = stack?.querySelector(":scope > .message-bubble");

    expect(bubble).toHaveTextContent("User bubble content");
    expect(
      stack?.querySelector(":scope > .message-actions"),
    ).toBeInTheDocument();
    expect(bubble?.querySelector(".message-actions")).toBeNull();
    expect(article?.querySelector(":scope > .user-mark")).toBeInTheDocument();
  });

  it("saves a user message edit without generating a reply", async () => {
    const controller = createController(createUserMessage());
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    const content = screen.getByRole("textbox", { name: "消息内容" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(content.closest("article")).toHaveClass(
      "message-user",
      "is-editing",
    );
    expect(content).toHaveValue("User bubble content");

    fireEvent.change(content, { target: { value: "Edited user message" } });
    fireEvent.click(screen.getByRole("button", { name: "仅保存" }));

    await waitFor(() =>
      expect(controller.editMessage).toHaveBeenCalledWith(
        "message-1",
        "Edited user message",
      ),
    );
    expect(controller.editAndRegenerate).not.toHaveBeenCalled();
  });

  it("saves and sends an edited user message", async () => {
    const controller = createController(createUserMessage());
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const content = screen.getByRole("textbox", { name: "消息内容" });
    fireEvent.change(content, { target: { value: "Edited and sent" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并发送" }));

    await waitFor(() =>
      expect(controller.editAndRegenerate).toHaveBeenCalledWith(
        "message-1",
        "Edited and sent",
      ),
    );
    expect(controller.editMessage).not.toHaveBeenCalled();
  });

  it("cancels an inline user message edit without changing the message", async () => {
    const controller = createController(createUserMessage());
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    const editButton = screen.getByRole("button", { name: "编辑" });
    fireEvent.click(editButton);
    fireEvent.change(screen.getByRole("textbox", { name: "消息内容" }), {
      target: { value: "Discard this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(
      screen.queryByRole("textbox", { name: "消息内容" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("User bubble content")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "编辑" })).toHaveFocus(),
    );
    expect(controller.editMessage).not.toHaveBeenCalled();
    expect(controller.editAndRegenerate).not.toHaveBeenCalled();
  });

  it("keeps a failed inline edit draft and shows a local error", async () => {
    const controller = createController(createUserMessage());
    controller.editMessage = vi.fn(async () => {
      throw new Error("storage detail must stay hidden");
    });
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const content = screen.getByRole("textbox", { name: "消息内容" });
    fireEvent.change(content, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "仅保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("发生未知错误");
    expect(content).toHaveValue("Keep this draft");
    expect(content).toBeEnabled();
  });

  it("disables blank and duplicate inline edit submissions while pending", async () => {
    let finishSave!: () => void;
    const controller = createController(createUserMessage());
    controller.editMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const content = screen.getByRole("textbox", { name: "消息内容" });
    fireEvent.change(content, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "仅保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存并发送" })).toBeDisabled();

    fireEvent.change(content, { target: { value: "Pending draft" } });
    fireEvent.click(screen.getByRole("button", { name: "仅保存" }));
    await waitFor(() => expect(content).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "仅保存" }));
    expect(controller.editMessage).toHaveBeenCalledTimes(1);

    await act(async () => finishSave());
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "消息内容" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("can send a user leaf that was saved without a reply", async () => {
    const controller = createController(createUserMessage());
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "发送这条消息" }));

    await waitFor(() =>
      expect(controller.generateUserMessage).toHaveBeenCalledWith("message-1"),
    );
  });

  it("uses the seven end-user settings destinations", () => {
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();

    expect(screen.getAllByRole("tab")).toHaveLength(7);
    for (const label of [
      "外观",
      "模型服务",
      "模型管理",
      "网络搜索",
      "图片生成",
      "数据",
      "关于",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "外观" })).toHaveTextContent(
      "设置/外观",
    );
    expect(
      screen.queryByRole("tab", { name: "模型与生成" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "指令与上下文" }),
    ).not.toBeInTheDocument();
  });

  it("switches to image generation and updates request options", async () => {
    const controller = createController();
    controller.imageGenerationConfig = {
      ...controller.imageGenerationConfig,
      profiles: controller.imageGenerationConfig.profiles.map((profile) => ({
        ...profile,
        apiKey: "sk-test-image-key",
        hasApiKey: true,
      })),
    };
    controller.composerMode = "image";
    controller.imageGenerationProfiles =
      controller.imageGenerationConfig.profiles;
    controller.activeImageGenerationProfile =
      controller.imageGenerationProfiles[0] ?? null;
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();

    expect(
      screen.getByRole("textbox", { name: "描述你想生成的图片" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "图片尺寸: 1024x1024" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "2K" }));
    fireEvent.click(screen.getByRole("button", { name: "3:2" }));
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    fireEvent.click(screen.getByRole("combobox", { name: "图片质量" }));
    fireEvent.click(screen.getByRole("option", { name: "高" }));

    expect(controller.setImageGenerationSize).toHaveBeenCalledWith("2160x1440");
    expect(controller.setImageGenerationParameters).toHaveBeenCalledWith(
      expect.objectContaining({ quality: "high" }),
    );
    expect(
      screen.queryByRole("button", { name: "为此会话启用网络搜索" }),
    ).not.toBeInTheDocument();
  });

  it("saves BYOK image generation settings", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.saveImageGenerationSettings = vi.fn(
      async () => controller.imageGenerationConfig,
    );
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "图片生成" }));
    await user.clear(screen.getByLabelText("服务 URL"));
    await user.type(
      screen.getByLabelText("服务 URL"),
      "https://images.example.test",
    );
    await user.type(screen.getByLabelText("API 密钥"), "sk-image-secret");
    expect(screen.queryByLabelText("图片模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("尺寸能力")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新增 Profile" }),
    ).not.toBeInTheDocument();
    const saveButton = screen.getByRole("button", {
      name: "保存图片生成设置",
    });
    expect(saveButton.closest(".settings-ui-panel")).not.toBeNull();
    await user.click(saveButton);

    await waitFor(() =>
      expect(controller.saveImageGenerationSettings).toHaveBeenCalledWith({
        apiKey: "sk-image-secret",
        baseUrl: "https://images.example.test",
      }),
    );
    expect(screen.getByText("图片生成设置已保存。")).toBeInTheDocument();
  });

  it("does not expose image profile or capability management", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    const firstProfile = controller.imageGenerationConfig.profiles[0];
    if (!firstProfile) throw new Error("Missing image profile fixture");
    const secondProfile = {
      ...firstProfile,
      id: "second",
      name: "Second profile",
      modelId: "gpt-image-1.5",
    };
    controller.imageGenerationConfig = {
      ...controller.imageGenerationConfig,
      profiles: [...controller.imageGenerationConfig.profiles, secondProfile],
      parametersByProfile: {
        ...controller.imageGenerationConfig.parametersByProfile,
        second:
          controller.imageGenerationConfig.parametersByProfile[
            firstProfile.id
          ]!,
      },
    };
    controller.imageGenerationProfiles = [firstProfile, secondProfile];
    controller.activeImageGenerationProfile = firstProfile;
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();
    await user.click(screen.getByRole("tab", { name: "图片生成" }));

    expect(screen.queryByLabelText("Profile 名称")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("默认 Profile")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("图片模型")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("尺寸能力")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新增 Profile" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "删除 Profile" }),
    ).not.toBeInTheDocument();
    expect(controller.selectImageGenerationProfile).not.toHaveBeenCalled();
    expect(controller.activeImageGenerationProfile?.id).toBe(firstProfile.id);
  });

  it("adds a generated image to the next reference draft", async () => {
    const user = userEvent.setup();
    const controller = createController({
      ...createAssistantMessage("completed"),
      parts: [
        {
          type: "image_generation",
          modelId: "gpt-image-1.5",
          connectionScope: "image:byok:test",
          size: "1024x1024",
          quality: "high",
          referenceAttachmentIds: [],
        },
        { type: "image_ref", attachmentId: "generated-1", alt: null },
      ],
    });
    controller.attachmentUrls = { "generated-1": "blob:generated-1" };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("button", { name: "作为参考图" }));

    await waitFor(() =>
      expect(controller.addStoredImageReference).toHaveBeenCalledWith(
        "generated-1",
      ),
    );
  });

  it("opens a generated image preview and exposes the original image", async () => {
    const user = userEvent.setup();
    const controller = createController({
      ...createAssistantMessage("completed"),
      createdAt: "2026-07-17T12:34:56.789Z",
      parts: [
        {
          type: "image_generation",
          modelId: "gpt-image-1.5",
          connectionScope: "image:byok:test",
          size: "1024x1024",
          quality: "high",
          referenceAttachmentIds: [],
        },
        { type: "image_ref", attachmentId: "generated-1", alt: "Cherry" },
      ],
    });
    controller.attachmentUrls = { "generated-1": "blob:generated-1" };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    const downloadLink = screen.getByRole("link", { name: "下载原图" });
    expect(downloadLink.getAttribute("download")).toMatch(
      /^CherryChat_\d{8}_\d{6}_789\.png$/u,
    );
    expect(downloadLink).toHaveAttribute("href", "blob:generated-1");
    const trigger = screen.getByRole("button", { name: "查看原图" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "查看原图" });
    expect(within(dialog).getByRole("img", { name: "Cherry" })).toHaveAttribute(
      "src",
      "blob:generated-1",
    );
    expect(within(dialog).queryByRole("link", { name: "下载原图" })).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "查看原图" })).toBeNull(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("saves the selected Tavily settings from the shared controls", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.saveWebSearchSettings = vi.fn(async (input) => ({
      ...input,
      hasApiKey: true,
    }));
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    await user.type(screen.getByLabelText("Tavily API 密钥"), "tvly-test-key");
    await user.clear(screen.getByLabelText("Tavily API 地址"));
    await user.type(
      screen.getByLabelText("Tavily API 地址"),
      "https://search.example/tavily",
    );
    const resultCount = screen.getByRole("slider", {
      name: "每次返回的来源",
    });
    expect(resultCount).toHaveAttribute("aria-valuemin", "1");
    expect(resultCount).toHaveAttribute("aria-valuemax", "50");
    expect(resultCount).toHaveAttribute("aria-valuenow", "5");
    await user.click(screen.getByRole("button", { name: "20" }));
    await user.click(screen.getByRole("switch", { name: "允许网络搜索" }));
    const saveWebSearch = screen.getByRole("button", {
      name: "保存网络搜索",
    });
    expect(saveWebSearch.closest(".settings-ui-panel")).not.toBeNull();
    expect(
      saveWebSearch.closest(".settings-web-search-actions"),
    ).not.toBeNull();
    await user.click(saveWebSearch);

    expect(controller.saveWebSearchSettings).toHaveBeenCalledWith({
      enabled: true,
      maxResults: 20,
      provider: "tavily",
      hostedProvider: null,
      providers: {
        tavily: {
          apiKey: "tvly-test-key",
          baseUrl: "https://search.example/tavily",
        },
        exa: {
          apiKey: "",
          baseUrl: "https://api.exa.ai",
        },
        grok: {
          apiKey: "",
          responsesUrl: "https://api.x.ai/v1/responses",
          model: "grok-4.5",
          xSearch: false,
        },
      },
    });
  });

  it("shows a successful personal-key test before unsaved status", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.testWebSearch = vi.fn(async () => undefined);
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    await user.type(screen.getByLabelText("Tavily API 密钥"), "tvly-test-key");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(screen.getByText("搜索连接正常。")).toBeVisible();
    expect(screen.queryByText("网络搜索有未保存的更改。")).toBeNull();
  });

  it("switches to Grok and saves its model, URL, and X Search settings", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.saveWebSearchSettings = vi.fn(async (input) => ({
      ...input,
      hasApiKey: true,
      providers: {
        tavily: {
          ...input.providers.tavily,
          hasApiKey: false,
        },
        exa: {
          ...input.providers.exa,
          hasApiKey: false,
        },
        grok: {
          ...input.providers.grok,
          hasApiKey: true,
        },
      },
    }));
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    fireEvent.click(screen.getByRole("combobox", { name: "搜索 Provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Grok" }));
    await user.type(screen.getByLabelText("搜索 API 密钥"), "xai-test-key");
    await user.clear(screen.getByLabelText("Grok Responses 地址"));
    await user.type(
      screen.getByLabelText("Grok Responses 地址"),
      "https://proxy.example/v1/responses",
    );
    await user.clear(screen.getByLabelText("Grok 模型"));
    await user.type(screen.getByLabelText("Grok 模型"), "grok-4.5");
    await user.click(screen.getByRole("switch", { name: "同时搜索 X" }));
    await user.click(screen.getByRole("switch", { name: "允许网络搜索" }));
    await user.click(screen.getByRole("button", { name: "保存网络搜索" }));

    expect(controller.saveWebSearchSettings).toHaveBeenCalledWith({
      enabled: true,
      maxResults: 5,
      provider: "grok",
      hostedProvider: null,
      providers: {
        tavily: {
          apiKey: "",
          baseUrl: "https://api.tavily.com",
        },
        exa: {
          apiKey: "",
          baseUrl: "https://api.exa.ai",
        },
        grok: {
          apiKey: "xai-test-key",
          responsesUrl: "https://proxy.example/v1/responses",
          model: "grok-4.5",
          xSearch: true,
        },
      },
    });
  });

  it("keeps Exa credentials while switching search providers", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    const provider = screen.getByRole("combobox", { name: "搜索 Provider" });
    fireEvent.click(provider);
    fireEvent.click(screen.getByRole("option", { name: "Exa" }));
    await user.type(screen.getByLabelText("搜索 API 密钥"), "exa-test-key");
    await user.clear(screen.getByLabelText("Exa API 地址"));
    await user.type(
      screen.getByLabelText("Exa API 地址"),
      "https://exa-proxy.example",
    );

    fireEvent.click(provider);
    fireEvent.click(screen.getByRole("option", { name: "Grok" }));
    fireEvent.click(provider);
    fireEvent.click(screen.getByRole("option", { name: "Exa" }));

    expect(screen.getByLabelText("搜索 API 密钥")).toHaveValue("exa-test-key");
    expect(screen.getByLabelText("Exa API 地址")).toHaveValue(
      "https://exa-proxy.example",
    );
  });

  it("keeps unavailable search disabled and explains access-code requirements", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    if (!controller.publicConfig) throw new Error("Expected public config");
    controller.publicConfig = {
      ...controller.publicConfig,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["tavily"],
      authenticated: false,
    };
    controller.connection = { ...controller.connection, mode: "hosted" };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    expect(screen.getByText("需要访问码")).toBeVisible();
    expect(screen.getByRole("switch", { name: "允许网络搜索" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
    expect(
      screen.getByLabelText("个人 Tavily API 密钥（可选）"),
    ).toBeDisabled();
  });

  it("uses authenticated site search without requiring a personal Tavily key", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    if (!controller.publicConfig) throw new Error("Expected public config");
    controller.publicConfig = {
      ...controller.publicConfig,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["tavily"],
      authenticated: true,
    };
    controller.connection = { ...controller.connection, mode: "hosted" };
    controller.webSearchSource = "hosted";
    controller.saveWebSearchSettings = vi.fn(async (input) => ({
      ...input,
      hasApiKey: false,
    }));
    controller.testWebSearch = vi.fn(async () => undefined);
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    expect(screen.getByText("本站搜索")).toBeVisible();
    expect(screen.getByLabelText("个人 Tavily API 密钥（可选）")).toHaveValue(
      "",
    );
    expect(
      screen.getByLabelText("个人 Tavily API 密钥（可选）"),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(controller.testWebSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        maxResults: 5,
        provider: "tavily",
        providers: expect.objectContaining({
          tavily: expect.objectContaining({
            apiKey: "",
            baseUrl: "https://api.tavily.com",
          }),
        }),
      }),
    );

    await user.click(screen.getByRole("switch", { name: "允许网络搜索" }));
    await user.click(screen.getByRole("button", { name: "保存网络搜索" }));
    expect(controller.saveWebSearchSettings).toHaveBeenCalledWith({
      enabled: true,
      maxResults: 5,
      provider: "tavily",
      hostedProvider: null,
      providers: {
        tavily: {
          apiKey: "",
          baseUrl: "https://api.tavily.com",
        },
        exa: {
          apiKey: "",
          baseUrl: "https://api.exa.ai",
        },
        grok: {
          apiKey: "",
          responsesUrl: "https://api.x.ai/v1/responses",
          model: "grok-4.5",
          xSearch: false,
        },
      },
    });
  });

  it("locks the Hosted provider and Grok options to the server projection", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.publicConfig = {
      ...controller.publicConfig!,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "grok",
      hostedWebSearchProviders: ["grok"],
      authenticated: true,
    };
    controller.connection = { ...controller.connection, mode: "hosted" };
    controller.webSearchSource = "hosted";
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    expect(
      screen.getByRole("combobox", { name: "搜索 Provider" }),
    ).toHaveTextContent("Grok");
    expect(
      screen.getByRole("combobox", { name: "搜索 Provider" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Grok Responses 地址")).toBeDisabled();
    expect(screen.getByLabelText("Grok 模型")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "同时搜索 X" })).toBeDisabled();
    expect(screen.getByText("本站搜索")).toBeVisible();
  });

  it("switches among allowed Hosted providers without changing BYOK selection", async () => {
    const user = userEvent.setup();
    const controller = createController();
    controller.settingsOpen = true;
    controller.publicConfig = {
      ...controller.publicConfig!,
      hostedWebSearchEnabled: true,
      hostedWebSearchProvider: "tavily",
      hostedWebSearchProviders: ["grok", "tavily"],
      authenticated: true,
    };
    controller.connection = { ...controller.connection, mode: "hosted" };
    controller.webSearchSource = "hosted";
    controller.saveWebSearchSettings = vi.fn(async (input) => ({
      ...input,
      providers: {
        tavily: { ...input.providers.tavily, hasApiKey: false },
        exa: { ...input.providers.exa, hasApiKey: false },
        grok: { ...input.providers.grok, hasApiKey: false },
      },
      hasApiKey: false,
    }));
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByRole("tab", { name: "网络搜索" }));
    const provider = screen.getByRole("combobox", { name: "搜索 Provider" });
    expect(provider).toBeEnabled();
    expect(provider).toHaveTextContent("Tavily");
    fireEvent.click(provider);
    expect(screen.queryByRole("option", { name: "Exa" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Grok" }));
    await user.click(screen.getByRole("button", { name: "保存网络搜索" }));

    expect(controller.saveWebSearchSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "tavily",
        hostedProvider: "grok",
      }),
    );
  });

  it("renders persisted web search sources inside the assistant reply", async () => {
    const user = userEvent.setup();
    const message = createAssistantMessage("completed");
    message.parts = [
      {
        type: "tool_call",
        id: "call-1",
        name: "web_search",
        step: 0,
        input: { query: "CherryChat" },
        output: {
          query: "CherryChat",
          results: [
            {
              title: "CherryChat source",
              url: "https://example.com/cherrychat",
              content: "Current information",
            },
          ],
        },
        status: "completed",
        errorCode: null,
        errorStatus: null,
        retryable: false,
      },
      { type: "text", text: "Answer" },
    ];
    const controller = createController(message);
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    await user.click(screen.getByText("已找到 1 个来源"));
    expect(
      screen.getByRole("link", { name: "CherryChat source" }),
    ).toHaveAttribute("href", "https://example.com/cherrychat");
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("presents About as a clear product-information surface", () => {
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    const { container } = renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));

    expect(
      screen.getByRole("heading", { name: "产品信息" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI 对话工作区")).toBeInTheDocument();
    expect(screen.getByText("1.2.1")).toBeInTheDocument();
    expect(screen.getByText("MIT")).toBeInTheDocument();
    expect(screen.getByText("访问码或自定义 API")).toBeInTheDocument();
    expect(screen.getByText("当前浏览器")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开仓库" })).toHaveAttribute(
      "href",
      "https://github.com/lin-z-z/CherryChat",
    );
    expect(
      container.querySelectorAll(".settings-about-list > div"),
    ).toHaveLength(5);
  });

  it("saves Custom API independently of an unavailable empty access code", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.publicConfig = {
      appVersion: "1.2.1",
      byokEnabled: true,
      hostedEnabled: false,
      hostedWebSearchEnabled: false,
      hostedWebSearchProvider: null,
      hostedWebSearchProviders: [],
      models: [],
      defaultModel: null,
      titleModel: null,
      authenticated: false,
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    fireEvent.change(screen.getByLabelText("API 地址"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "user-api-key" },
    });
    expect(controller.saveConnection).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存连接" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    await waitFor(() =>
      expect(controller.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "byok",
          baseUrl: "https://example.com",
          apiKey: "user-api-key",
          accessCode: "",
        }),
      ),
    );
  });

  it("waits for a pending connection save before closing settings", async () => {
    let finishSave!: () => void;
    const controller = createController();
    controller.settingsOpen = true;
    controller.saveConnection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "pending-save-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(controller.saveConnection).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(controller.setSettingsOpen).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "放弃未保存的更改？" }),
    ).not.toBeInTheDocument();

    await act(async () => finishSave());

    await waitFor(() =>
      expect(controller.setSettingsOpen).toHaveBeenCalledWith(false),
    );
    expect(
      screen.queryByRole("heading", { name: "放弃未保存的更改？" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the discard decision after a pending connection save fails", async () => {
    let failSave!: (cause: Error) => void;
    const controller = createController();
    controller.settingsOpen = true;
    controller.saveConnection = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSave = reject;
        }),
    );
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "failed-save-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(controller.saveConnection).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await act(async () => failSave(new Error("save failed")));

    expect(
      await screen.findByRole("heading", { name: "放弃未保存的更改？" }),
    ).toBeVisible();
    expect(controller.setSettingsOpen).not.toHaveBeenCalled();
  });

  it("shows one API type selector and saves OpenAI Responses", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));

    expect(
      screen.getByRole("combobox", { name: "API 类型" }),
    ).toHaveTextContent("OpenAI");
    expect(screen.queryByLabelText("兼容服务")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: "API 类型" }));
    expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "OpenAI Responses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Anthropic" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "New API" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "自定义 OpenAI 兼容" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "OpenRouter" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "阿里云百炼" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "OpenAI Responses" }));
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

    await waitFor(() =>
      expect(controller.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          apiType: "openai-responses",
        }),
      ),
    );
  });

  it("keeps New API and custom OpenAI-compatible services in the API type list", () => {
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    const apiType = screen.getByRole("combobox", { name: "API 类型" });

    fireEvent.click(apiType);
    fireEvent.click(screen.getByRole("option", { name: "New API" }));
    expect(apiType).toHaveTextContent("New API");

    fireEvent.click(apiType);
    fireEvent.click(screen.getByRole("option", { name: "自定义 OpenAI 兼容" }));
    expect(apiType).toHaveTextContent("自定义 OpenAI 兼容");
    expect(screen.queryByLabelText("兼容服务")).not.toBeInTheDocument();
  });

  it("does not show Custom API protocol controls for Hosted connections", () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.connection = { ...controller.connection, mode: "hosted" };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));

    expect(
      screen.queryByRole("combobox", { name: "API 类型" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("兼容服务")).not.toBeInTheDocument();
    expect(screen.getByLabelText("访问码")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(controller.saveEnabledModels).not.toHaveBeenCalled();
  });

  it("saves enabled-model changes immediately without locking models in use", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    const activeModel = screen.getByRole("checkbox", {
      name: "启用 gpt-4.1-mini",
    });
    expect(activeModel).toBeEnabled();
    fireEvent.click(activeModel);

    await waitFor(() =>
      expect(controller.saveEnabledModels).toHaveBeenCalledWith(["gpt-5-mini"]),
    );
    expect(
      screen.queryByRole("button", { name: "保存模型选择" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("已自动保存，启用 1 个模型。"),
    ).toBeVisible();
  });

  it("keeps an unavailable access-code method discoverable without saving it", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.publicConfig = {
      appVersion: "1.2.1",
      byokEnabled: true,
      hostedEnabled: false,
      hostedWebSearchEnabled: false,
      hostedWebSearchProvider: null,
      hostedWebSearchProviders: [],
      models: [],
      defaultModel: null,
      titleModel: null,
      authenticated: false,
      requestTimeouts: DEFAULT_REQUEST_TIMEOUT_POLICY,
    };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "连接方式：自定义 API" }),
      { key: "Enter" },
    );
    const methods = screen.getAllByRole("menuitemradio");
    expect(methods).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /使用访问码/u }));

    expect(
      screen.getByLabelText("访问码", { selector: "input" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("当前 CherryChat 尚未提供使用访问码，暂时无法保存。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(controller.saveConnection).not.toHaveBeenCalled();
  });

  it("resubmits an unchanged hosted access code to re-verify it", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.connection = {
      ...controller.connection,
      mode: "hosted",
      accessCode: "saved-code",
    };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));
    const save = screen.getByRole("button", { name: "保存连接" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(controller.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "hosted", accessCode: "saved-code" }),
      ),
    );
  });

  it("blocks a hosted save while the access code is empty", () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.connection = {
      ...controller.connection,
      mode: "hosted",
      accessCode: "",
    };
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型服务" }));

    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    expect(controller.saveConnection).not.toHaveBeenCalled();
  });

  it("offers a refresh when a newer deployment is published", () => {
    const controller = createController();
    controller.updateAvailable = true;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    expect(screen.getByText(/有新版本发布/u)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新页面" }));

    expect(controller.reloadForUpdate).toHaveBeenCalledTimes(1);
  });

  it("hides the refresh notice when the bundle is current", () => {
    const controller = createController();
    controller.updateAvailable = false;
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    expect(screen.queryByText(/有新版本发布/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "刷新页面" }),
    ).not.toBeInTheDocument();
  });

  it("saves the default model independently", async () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.models = ["gpt-4.1-mini", "gpt-5-mini"];
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型管理" }));
    fireEvent.click(screen.getByRole("button", { name: "默认模型" }));
    fireEvent.click(screen.getByRole("option", { name: "gpt-5-mini" }));
    fireEvent.click(screen.getByRole("button", { name: "保存默认模型" }));

    await waitFor(() =>
      expect(controller.saveDefaultModel).toHaveBeenCalledWith("gpt-5-mini"),
    );
  });

  it("opens model compatibility on the active chat model", () => {
    const controller = createController();
    controller.settingsOpen = true;
    controller.defaultModel = "gpt-4.1-mini";
    controller.connection = {
      ...controller.connection,
      modelId: "gpt-5-mini",
    };
    controller.models = ["gpt-4.1-mini", "gpt-5-mini"];
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型管理" }));

    expect(
      screen.getByRole("button", { name: "选中的模型" }),
    ).toHaveTextContent("gpt-5-mini");
  });

  it("shows when the current API type cannot send an intrinsic model parameter", async () => {
    const controller = createController();
    const modelId = "deepseek-chat";
    const intrinsic = resolveModelCapability(modelId);
    const effective = resolveEffectiveModelCapability({
      modelCapability: intrinsic,
      endpointProfile: getEndpointProfile("openai-compatible"),
    });
    controller.settingsOpen = true;
    controller.connection = {
      ...controller.connection,
      apiType: "openai-compatible",
      modelId,
    };
    controller.models = [modelId];
    controller.resolveModelCapability = vi.fn(async () => intrinsic);
    controller.resolveModelExecutionCapability = vi.fn(async () => effective);
    vi.mocked(useChatController).mockReturnValue(controller);
    renderShell();

    fireEvent.click(screen.getByRole("tab", { name: "模型管理" }));

    expect(
      await screen.findByText(
        "当前 API 类型不支持部分可调参数。模型能力设置会保留，发送时不会使用这些参数。",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("思考方式")).toHaveValue("none, auto");
    expect(
      screen.getByText(
        "当前 API 类型不会发送这些思考参数，但仍可在这里维护模型能力。",
      ),
    ).toBeVisible();
  });

  it.each(["stopped", "error", "completed"] satisfies MessageStatus[])(
    "does not show a generation indicator for an empty %s assistant message",
    (status) => {
      vi.mocked(useChatController).mockReturnValue(
        createController(createAssistantMessage(status)),
      );

      renderShell();

      expect(screen.queryByLabelText("正在生成")).not.toBeInTheDocument();
    },
  );

  it.each(["pending", "streaming"] satisfies MessageStatus[])(
    "shows a generation indicator for an empty active %s assistant message",
    (status) => {
      vi.mocked(useChatController).mockReturnValue(
        createController(createAssistantMessage(status), activeStream),
      );

      renderShell();

      expect(screen.getByLabelText("正在生成")).toBeInTheDocument();
    },
  );

  it("keeps partial output and renders a persisted LLM error inside the assistant message", () => {
    const controller = createController({
      ...createAssistantMessage("error"),
      parts: [{ type: "text", text: "已经生成的部分回答" }],
      error: { code: "RATE_LIMITED", status: 429, retryable: true },
    });
    vi.mocked(useChatController).mockReturnValue(controller);

    renderShell();

    const errorCard = screen.getByRole("alert");
    expect(screen.getByText("已经生成的部分回答")).toBeInTheDocument();
    expect(errorCard).toHaveTextContent("请求过于频繁");
    expect(document.querySelector(".chat-error")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "重新生成" })[0]!);
    expect(controller.regenerateAssistant).toHaveBeenCalledWith("message-1");
  });

  it("shows clipboard failures as a transient notification", async () => {
    const controller = createController({
      ...createAssistantMessage("completed"),
      parts: [{ type: "text", text: "Copy this" }],
    });
    vi.mocked(useChatController).mockReturnValue(controller);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("no"))) },
    });

    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    expect(await screen.findByText("复制失败，请重试。")).toBeInTheDocument();
    expect(document.querySelector(".chat-error")).toBeNull();
  });
});
