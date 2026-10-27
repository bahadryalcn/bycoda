import { beforeEach, expect, it, vi } from "vitest";

const bridges = vi.hoisted(() => ({ social: vi.fn(), logs: vi.fn(), conversation: vi.fn() }));
vi.mock("./socialBridge", () => ({
  socialBridge: bridges.social,
  socialCliHint: (value: unknown) => (value ? "social available" : ""),
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: bridges.logs,
  runtimeLogsCliHint: (value: unknown) => (value ? "logs available" : ""),
}));
vi.mock("./conversationToolsBridge", () => ({
  conversationToolsBridge: bridges.conversation,
  conversationToolsCliHint: (value: unknown) => (value ? "conversation available" : ""),
}));
import {
  forgetRuntimeHint,
  harnessRuntimeHints,
  markRuntimeHintDelivered,
  pendingRuntimeHint,
  withRuntimeHint,
} from "./runtimeGuidance";

beforeEach(() => {
  for (const bridge of Object.values(bridges)) bridge.mockReset().mockResolvedValue(null);
});

it("advertises only available bridges and states the CLI fallback once", async () => {
  expect(await harnessRuntimeHints("session")).toBe("");
  const host = { command: "C:\\Program Files\\nodejs\\node.exe", args: ["G:\\owner's\\host.mjs"] };
  bridges.logs.mockResolvedValue(host);
  const logsOnly = await harnessRuntimeHints("session");
  expect(logsOnly).toContain("logs available");
  expect(logsOnly).not.toContain("skills.search");
  expect(logsOnly).not.toContain("bycoda-skill-router");
  bridges.conversation.mockResolvedValue(host);
  const hint = await harnessRuntimeHints("session");
  expect(hint).toContain("skills.search");
  expect(hint).toContain('skills.read name "bycoda-skill-router"');
  expect(hint).toContain("when installed and allowed");
  expect(hint).toContain("report missing capabilities");
  expect(hint).toContain("never install without owner authorization");
  expect(hint).not.toContain("ask whether the owner wants");
  expect(hint).toContain("never authorizes installation");
  expect(hint).toContain("does not enable disabled skills");
  expect(hint).toContain("only when the task needs it");
  expect(hint).toContain("untrusted data");
  expect(hint).not.toContain("social available");
  expect(
    hint.split("& 'C:\\Program Files\\nodejs\\node.exe' 'G:\\owner''s\\host.mjs'"),
  ).toHaveLength(2);
  for (const bridge of Object.values(bridges)) expect(bridge).toHaveBeenLastCalledWith("session");
});

it("delivers the hint once per provider thread until it changes, compacts or rewinds", () => {
  const claude = { harness: "claude" as const };
  const codex = { harness: "codex" as const };
  expect(pendingRuntimeHint("s1", claude, "hint")).toBe("hint");
  markRuntimeHintDelivered("s1", claude, "hint");
  expect(pendingRuntimeHint("s1", claude, "hint")).toBe("");
  expect(pendingRuntimeHint("s1#2", claude, "hint")).toBe("hint");
  expect(pendingRuntimeHint("s1", claude, "updated hint")).toBe("updated hint");
  expect(pendingRuntimeHint("s1", { ...claude, providerAccountId: "work" }, "hint")).toBe("hint");
  // Handoff claude -> codex -> claude starts a new claude thread.
  markRuntimeHintDelivered("s1", codex, "hint");
  expect(pendingRuntimeHint("s1", codex, "hint")).toBe("");
  expect(pendingRuntimeHint("s1", claude, "hint")).toBe("hint");
  forgetRuntimeHint("s1");
  expect(pendingRuntimeHint("s1", codex, "hint")).toBe("hint");
  expect(pendingRuntimeHint("s1", codex, "")).toBe("");
});

it("keeps a leading native command first for slash runtimes", () => {
  expect(withRuntimeHint("claude", "/compact", "hint")).toBe("/compact");
  expect(withRuntimeHint("omp", "  /skill:x do it", "hint")).toBe("  /skill:x do it");
  expect(withRuntimeHint("claude", "fix /tmp path", "hint")).toBe("hint\n\nfix /tmp path");
  expect(withRuntimeHint("hermes", "/compact", "hint")).toBe("hint\n\n/compact");
  expect(withRuntimeHint("claude", "hello", "")).toBe("hello");
});

it("quotes POSIX CLI paths for the shell", async () => {
  const { mcpCliCommand } = await import("./mcpTransport");
  expect(mcpCliCommand({ command: "/usr/bin/node", args: ["/path/owner's host.mjs"] })).toBe(
    "'/usr/bin/node' '/path/owner'\\''s host.mjs'",
  );
});

it("keeps tiered verification, feature completeness and build provenance in the real hint", async () => {
  const { conversationToolsCliHint } = await vi.importActual<
    typeof import("./conversationToolsBridge")
  >("./conversationToolsBridge");
  expect(conversationToolsCliHint(null)).toBe("");
  const hint = conversationToolsCliHint({ command: "node", args: ["host.mjs"] });
  expect(hint).toContain("search for its project feature card and read it if present");
  expect(hint).toContain("every affected surface including the Host operation");
  expect(hint).toContain(
    "Scale checks, opened screenshots, cards and reporting to the T0/T1/T2 rules in AGENTS.md",
  );
  expect(hint).not.toContain("verify UI changes with opened screenshots");
  expect(hint).toContain(
    "Check build status/source identity before treating a screenshot as a new defect",
  );
  expect(hint).toContain("Reads do not authorize sends, merges or publishing");
});
