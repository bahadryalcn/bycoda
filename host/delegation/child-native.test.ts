import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  DELEGATION_CHAT_ONLY_KEY,
  DELEGATION_PARENT_KEY,
  DELEGATION_PROVIDER_HISTORY_KEY,
} from "../../src/shared/model/host-contracts/delegation";
import {
  bycodaMcpOnly,
  leanContext,
  nativeReadOnly,
} from "../../src/integrations/harness/core/nativeToolLimits";
import {
  delegatedChatOnlyHistory,
  delegatedChildInput,
  privateDelegateDirectory,
  privateDelegateReplay,
} from "./child-native";
import { newSession } from "../../src/features/sessions/model/session";

const child = { [DELEGATION_PARENT_KEY]: "{}" };
const parent = JSON.stringify({
  parentSessionId: "parent",
  model: "codex:model",
  runId: "run",
  kind: "subagent",
  startedAt: 1,
});

describe("delegatedChildInput", () => {
  it("leaves an ordinary session untouched", () => {
    const input = { runtimeMode: "default", modelSettings: { effort: "high" } };
    expect(delegatedChildInput("claude", input)).toBe(input);
    const bare = { runtimeMode: "default" };
    expect(delegatedChildInput("claude", bare)).toBe(bare);
  });

  it("limits a delegated child to bycoda's MCP servers without changing its mode", () => {
    const out = delegatedChildInput("codex", {
      runtimeMode: "auto-accept-edits",
      modelSettings: child,
    });
    expect(bycodaMcpOnly(out.modelSettings)).toBe(true);
    expect(nativeReadOnly(out.modelSettings)).toBe(false);
    expect(leanContext(out.modelSettings)).toBe(false);
    expect(out.runtimeMode).toBe("auto-accept-edits");
  });

  it("runs a chat-only child read-only, supervised and lean", () => {
    for (const provider of ["claude", "codex", "pi"]) {
      const out = delegatedChildInput(provider, {
        runtimeMode: "full-access",
        modelSettings: { ...child, [DELEGATION_CHAT_ONLY_KEY]: "on" },
      });
      expect(out.runtimeMode).toBe("supervised");
      expect(nativeReadOnly(out.modelSettings)).toBe(true);
      expect(leanContext(out.modelSettings)).toBe(true);
      expect(bycodaMcpOnly(out.modelSettings)).toBe(true);
    }
  });

  it("refuses a chat-only child on a provider that cannot run read-only", () => {
    expect(() =>
      delegatedChildInput("cursor", {
        modelSettings: { ...child, [DELEGATION_CHAT_ONLY_KEY]: "on" },
      }),
    ).toThrow("unavailable");
    expect(() => delegatedChildInput("cursor", { modelSettings: child })).not.toThrow();
  });

  it.each(["codex", "claude"])("uses private history for marked %s delegates only", (provider) => {
    const modelSettings = { [DELEGATION_PROVIDER_HISTORY_KEY]: "ephemeral" };
    expect(delegatedChildInput(provider, { modelSettings })).not.toHaveProperty(
      "privateDelegateHistory",
    );
    expect(delegatedChildInput(provider, { modelSettings: child })).not.toHaveProperty(
      "privateDelegateHistory",
    );
    expect(
      delegatedChildInput(provider, {
        modelSettings: { ...modelSettings, [DELEGATION_PARENT_KEY]: parent },
      }),
    ).toHaveProperty("privateDelegateHistory", true);
  });

  it("archives only tool-enabled OpenCode delegates with the archive policy", () => {
    const modelSettings = {
      [DELEGATION_PARENT_KEY]: parent,
      [DELEGATION_PROVIDER_HISTORY_KEY]: "archive",
    };
    expect(delegatedChildInput("opencode", { modelSettings })).toHaveProperty(
      "archiveDelegateHistory",
      true,
    );
    expect(
      delegatedChildInput("opencode", {
        modelSettings: { ...modelSettings, [DELEGATION_CHAT_ONLY_KEY]: "on" },
      }),
    ).not.toHaveProperty("archiveDelegateHistory");
  });
});

it.each(["pi", "omp"] as const)(
  "derives the marked %s history directory inside Host state",
  async (provider) => {
    const root = await mkdtemp(join(tmpdir(), "bycoda-delegate-"));
    try {
      const session = {
        ...newSession(provider, "/repo"),
        id: "../session",
        modelSettings: {
          [DELEGATION_PROVIDER_HISTORY_KEY]: "directory",
          [DELEGATION_PARENT_KEY]: parent,
        },
      };
      const directory = await privateDelegateDirectory(session, root);
      expect(relative(root, directory!)).toMatch(
        /^delegation[\\/]provider-history[\\/][a-f0-9]{64}$/,
      );
      expect(await privateDelegateDirectory(session, root)).toBe(directory);
      expect(
        await privateDelegateDirectory(
          {
            ...session,
            modelSettings: {
              ...session.modelSettings,
              [DELEGATION_PROVIDER_HISTORY_KEY]: "/wrong",
            },
          },
          root,
        ),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("replays the saved blocks before the exact private turn, including completed tools", () => {
  const session = {
    ...newSession("codex", "/repo"),
    modelSettings: {
      [DELEGATION_PROVIDER_HISTORY_KEY]: "ephemeral",
      [DELEGATION_PARENT_KEY]: parent,
    },
    blocks: [
      { id: "old", role: "user" as const, text: "The same question" },
      { id: "result", role: "tool" as const, text: "Saved tool result" },
      { id: "hidden", role: "reasoning" as const, text: "Hidden reasoning" },
      { id: "current", role: "user" as const, text: "The same question" },
    ],
  };
  const replay = privateDelegateReplay(session, "current");
  expect(replay?.match(/The same question/g)).toHaveLength(1);
  expect(replay).toContain("Saved tool result");
  expect(replay).not.toContain("Hidden reasoning");
  expect(privateDelegateReplay({ ...session, modelSettings: {} }, "current")).toBeUndefined();
});

it("replays only prior chat text for the exact tool-free child turn", () => {
  const session = {
    ...newSession("opencode", "/scratch"),
    modelSettings: {
      [DELEGATION_CHAT_ONLY_KEY]: "on",
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: "parent",
        model: "opencode:model",
        runId: "run",
        kind: "subagent",
        startedAt: 1,
      }),
    },
    blocks: [
      { id: "old", role: "user" as const, text: "Previous question" },
      { id: "reply", role: "assistant" as const, text: "Previous answer" },
      { id: "tool", role: "tool" as const, text: "Tool output" },
      { id: "current", role: "user" as const, text: "New prompt" },
    ],
  };
  const replay = delegatedChatOnlyHistory(session, "current");
  expect(replay).toContain("Previous question");
  expect(replay).toContain("Previous answer");
  expect(replay).not.toMatch(/New prompt|Tool output/);
  expect(delegatedChatOnlyHistory(session, "old")).toBe("");
  expect(() => delegatedChatOnlyHistory(session, "missing")).toThrow("current chat-only");
  expect(delegatedChatOnlyHistory({ ...session, modelSettings: {} }, "current")).toBeUndefined();
});
