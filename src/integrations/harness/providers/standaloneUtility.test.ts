import { expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tauri-apps/api/core")>(),
  isTauri: () => true,
}));

it.each([
  ["Codex", async () => (await import("./codex/codexText")).runCodexTextPrompt],
  ["Claude", async () => (await import("./claude/claudeText")).runClaudeTextPrompt],
] as const)("%s standalone utility refuses a prior conversation", async (_name, load) => {
  const run = await load();
  await expect(run({ cwd: "/repo", prompt: "private request", ephemeral: false, threadId: "old-thread" }))
    .rejects.toThrow("Standalone text generation requires a new ephemeral thread.");
});
