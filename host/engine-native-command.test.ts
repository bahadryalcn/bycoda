import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { HostProvider } from "./providers";

const bridge = vi.hoisted(() => ({ command: "/fake/node", args: ["/fake/host.mjs"] }));
const prepareSkill = vi.hoisted(() =>
  vi.fn(async (text: string) => `Host skill instructions.\n\n${text}`),
);
vi.mock("../src/integrations/harness/core/socialBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/harness/core/socialBridge")>()),
  socialBridge: vi.fn(async () => bridge),
}));
vi.mock("../src/integrations/harness/core/runtimeLogsBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/harness/core/runtimeLogsBridge")>()),
  runtimeLogsBridge: vi.fn(async () => bridge),
}));
vi.mock("../src/integrations/harness/core/conversationToolsBridge", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/integrations/harness/core/conversationToolsBridge")
  >()),
  conversationToolsBridge: vi.fn(async () => bridge),
}));
vi.mock("./prompt-skills", () => ({ prepareHostSkillPrompt: prepareSkill }));

import { HostEngine } from "./engine";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  prepareSkill.mockClear();
});

function setup(harness: "codex" | "claude") {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-native-command-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Native command test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const finish = async () => {
    turns.at(-1)?.finish();
  };
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((resolve) => turns.push({ input, finish: resolve }))),
    cancel: finish,
    stop: finish,
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider, claude: provider });
  cleanups.push(async () => {
    await engine.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const { sessionId } = engine.command({
    type: "create",
    commandId: "create-native-command",
    projectId: project.id,
    harness,
    model: `${harness}:test`,
    runtimeMode: "supervised",
  });
  return { engine, store, turns, sessionId };
}

describe("headless native command guidance", () => {
  it.each([
    "/goal",
    "/goal status",
    "/goal pause",
    "/goal clear",
    "/goal resume",
    "/goal Finish the $review checklist",
  ])("preserves Codex %s with a non-null runtime bridge", async (text) => {
    const { engine, store, turns, sessionId } = setup("codex");
    engine.command({ type: "send", commandId: "send-native-command", sessionId, text });
    // The real checkpoint preparation can exceed one second on Windows.
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10_000 });
    expect(turns[0].input.text).toBe(text);
    expect(turns[0].input.runtimeInstructions).toContain("social_policy_get");
    expect(turns[0].input.runtimeInstructions).toContain("Drafts never authorize sending");
    expect(prepareSkill).not.toHaveBeenCalled();
    expect(
      store.session(sessionId).session.blocks.find((block) => block.role === "user")?.text,
    ).toBe(text);
  });

  it("keeps Codex /goal first and carries pending shell output as runtime context", async () => {
    const { engine, store, turns, sessionId } = setup("codex");
    engine.command({
      type: "shell",
      commandId: "shell-before-goal",
      sessionId,
      line: "echo goal-context",
    });
    await vi.waitFor(
      () =>
        expect(
          store
            .session(sessionId)
            .session.blocks.some((block) => block.shell && !block.shell.running),
        ).toBe(true),
      { timeout: 20_000 },
    );
    engine.command({ type: "send", commandId: "send-goal", sessionId, text: "/goal Ship it" });
    await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10_000 });
    expect(turns[0].input.text).toBe("/goal Ship it");
    expect(turns[0].input.runtimeInstructions).toContain("<user-shell-commands>");
    expect(turns[0].input.runtimeInstructions).toContain("goal-context");
  });

  it.each(["codex", "claude"] as const)(
    "retains %s ordinary prompts and host skill expansion",
    async (harness) => {
      const { engine, store, turns, sessionId } = setup(harness);
      const text = "$review inspect this change";
      engine.command({ type: "send", commandId: "send-skill", sessionId, text });
      await vi.waitFor(() => expect(turns).toHaveLength(1), { timeout: 10_000 });
      const sent = turns[0].input;
      const guidance = harness === "codex" ? sent.runtimeInstructions : sent.text;
      expect(guidance).toContain("runtime_logs_sources");
      expect(guidance).toContain("conversation_tools_list");
      expect(guidance).toContain("skills.search");
      expect(prepareSkill).toHaveBeenCalledOnce();
      expect(sent.text).toContain(`Host skill instructions.\n\n${text}`);
      if (harness === "codex") {
        expect(sent.text).not.toContain("social_policy_get");
        expect(sent.runtimeInstructions).toContain("social_policy_get");
      } else {
        expect(sent.text).toContain("social_policy_get");
        expect(sent.runtimeInstructions).toBeUndefined();
      }
      expect(
        store.session(sessionId).session.blocks.find((block) => block.role === "user")?.text,
      ).toBe(text);
    },
  );
});
