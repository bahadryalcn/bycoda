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
  turnCarriesRuntimeHint,
  withRuntimeHint,
} from "./runtimeGuidance";
import { TOOL_WORKFLOW_GUIDANCE_VERSION } from "./toolWorkflowGuidance";

beforeEach(() => {
  for (const bridge of Object.values(bridges)) bridge.mockReset().mockResolvedValue(null);
});

it("advertises only available bridges and states the CLI fallback once", async () => {
  expect(await harnessRuntimeHints("session")).toBe("");
  const host = { command: "C:\\Program Files\\nodejs\\node.exe", args: ["G:\\owner's\\host.mjs"] };
  bridges.logs.mockResolvedValue(host);
  forgetRuntimeHint("session");
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

it("refreshes delivered workflows when offered transports change without claiming domain readiness", async () => {
  const host = { command: "node", args: ["host.mjs"] };
  const thread = { harness: "codex" as const };
  bridges.conversation.mockResolvedValue(host);
  const first = await harnessRuntimeHints("workflow-freshness");
  expect(first).toContain(TOOL_WORKFLOW_GUIDANCE_VERSION);
  expect(first).toContain("offered transports: conversation");
  expect(first).toContain("domain readiness: unknown until checked");
  markRuntimeHintDelivered("workflow-freshness", thread, first);
  expect(pendingRuntimeHint("workflow-freshness", thread, first)).toBe("");
  bridges.social.mockResolvedValue(host);
  const next = await harnessRuntimeHints("workflow-freshness");
  expect(next).toContain("offered transports: conversation, social");
  expect(pendingRuntimeHint("workflow-freshness", thread, next)).toBe(next);
  expect(next).toContain("browser.preview");
  expect(next).toContain("social: Read policy.get");
  forgetRuntimeHint("workflow-freshness");
});

it("keeps a leading native command first for slash runtimes", () => {
  expect(withRuntimeHint("claude", "/compact", "hint")).toBe("/compact");
  expect(withRuntimeHint("omp", "  /skill:x do it", "hint")).toBe("  /skill:x do it");
  expect(withRuntimeHint("claude", "fix /tmp path", "hint")).toBe("hint\n\nfix /tmp path");
  expect(withRuntimeHint("hermes", "/compact", "hint")).toBe("hint\n\n/compact");
  expect(withRuntimeHint("claude", "hello", "")).toBe("hello");
  expect(turnCarriesRuntimeHint("claude", "/compact", "/compact", "hint")).toBe(false);
  expect(turnCarriesRuntimeHint("codex", "/goal status", "/goal status", "hint")).toBe(false);
  expect(turnCarriesRuntimeHint("codex", "inspect", "inspect", "hint")).toBe(true);
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

const delegationSettings = {
  crossAdvisor: JSON.stringify({ harness: "codex", model: "codex:gpt-6.1-sol" }),
};

it("adds delegation guidance only when the conversation bridge is available", async () => {
  forgetRuntimeHint("delegation-no-bridge");
  expect(await harnessRuntimeHints("delegation-no-bridge", delegationSettings)).toBe("");

  forgetRuntimeHint("delegation-with-bridge");
  bridges.conversation.mockResolvedValue({ command: "node", args: ["host.mjs"] });
  const hint = await harnessRuntimeHints("delegation-with-bridge", delegationSettings);
  expect(hint).toContain("Cross-provider delegation is enabled");
  expect(hint).toContain("Advisor model: Codex codex:gpt-6.1-sol.");
  expect(hint).toContain("agents.options");
});

it("keeps delegation guidance out of ordinary sessions", async () => {
  forgetRuntimeHint("delegation-off");
  bridges.conversation.mockResolvedValue({ command: "node", args: ["host.mjs"] });
  const hint = await harnessRuntimeHints("delegation-off", {});
  expect(hint).not.toContain("Cross-provider delegation");
  expect(hint).not.toContain("agents.options");
});

it("does not let the empty-hint cache hide newly enabled delegation guidance", async () => {
  forgetRuntimeHint("delegation-cache");
  // No bridge: an empty answer is cached for this session.
  expect(await harnessRuntimeHints("delegation-cache")).toBe("");
  bridges.conversation.mockResolvedValue({ command: "node", args: ["host.mjs"] });
  // The owner turns delegation on: the cached empty answer must not win.
  const hint = await harnessRuntimeHints("delegation-cache", delegationSettings);
  expect(hint).toContain("Cross-provider delegation is enabled");
});

it("re-delivers the hint when the delegation settings change", () => {
  const thread = { harness: "claude" as const };
  const before = "bycoda tools for this session:\nCross-provider delegation is enabled.";
  const after = "bycoda tools for this session:\nSubagent models: Codex gpt-a.";
  markRuntimeHintDelivered("delegation-redeliver", thread, before);
  expect(pendingRuntimeHint("delegation-redeliver", thread, before)).toBe("");
  expect(pendingRuntimeHint("delegation-redeliver", thread, after)).toBe(after);
  forgetRuntimeHint("delegation-redeliver");
});
