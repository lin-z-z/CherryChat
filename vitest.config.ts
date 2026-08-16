import { defineConfig } from "vitest/config";
import path from "node:path";

const allTests = ["src/**/*.test.{ts,tsx}"];
const domTests = [
  "src/components/chat/assistant-selector.test.tsx",
  "src/components/chat/model-enablement-list.test.tsx",
  "src/components/chat/model-selector.test.tsx",
  "src/components/chat/image-generation-parameter-control.test.tsx",
  "src/components/chat/image-generation-profile-selector.test.tsx",
  "src/components/chat/reasoning-effort-control.test.tsx",
  "src/components/chat/theme-switcher.test.tsx",
  "src/components/chat-shell.test.tsx",
  "src/components/message-markdown.test.tsx",
  "src/components/settings/settings-controls.test.tsx",
  "src/features/chat/use-chat-controller.test.tsx",
  "src/storage/clear-local-data.test.ts",
  "src/storage/connection-store.test.ts",
];
const indexedDbTests = [
  "src/storage/**/*.test.ts",
  "src/runtime/models/model-capabilities.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: allTests,
          exclude: [...indexedDbTests, ...domTests],
        },
      },
      {
        extends: true,
        test: {
          name: "indexeddb",
          environment: "node",
          include: indexedDbTests,
          exclude: domTests,
          setupFiles: ["./tests/setup-indexeddb.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: domTests,
          setupFiles: ["./tests/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/**"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
        "src/proxy.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/features/chat/use-chat-controller.ts": {
          statements: 40,
          branches: 60,
          functions: 75,
          lines: 40,
        },
        "src/features/chat/connection-controller.ts": {
          statements: 90,
          branches: 75,
          functions: 100,
          lines: 90,
        },
      },
    },
  },
});
