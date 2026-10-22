// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type BtwThread } from "../../../features/sessions/model/session";
import { useBtwThreads, type BtwThreadsDeps, type BtwThreadActions } from "./useBtwThreads";

const { run, exists } = vi.hoisted(() => ({ run: vi.fn(), exists: vi.fn() }));
vi.mock("../../../integrations/harness", () => ({ runHarnessTextPrompt: run }));
vi.mock("../../../features/providers/model/providerAccounts", async (original) => ({
  ...(await original<typeof import("../../../features/providers/model/providerAccounts")>()),
  providerAccountExists: exists,
}));

let root: Root;
let container: HTMLDivElement;
let actions: BtwThreadActions;
let deps: BtwThreadsDeps;
const current = () => deps.sessionsRef.current[0];
const thread = () => current().blocks[0].btwThreads![0];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  run.mockReset().mockImplementation(() => new Promise(() => {}));
  exists.mockReset().mockReturnValue(true);
  const side: BtwThread = {
    id: "side",
    sourceEndBlockId: "answer",
    createdAt: 1,
    updatedAt: 1,
    status: "running",
    harness: "claude",
    model: "claude:sonnet",
    messages: [{ id: "question", role: "user", text: "Why?", createdAt: 1 }],
  };
  const session = { ...newSession("claude", "/repo"), providerAccountId: "account-a" };
  session.blocks = [
    { id: "user", role: "user", text: "Explain", btwThreads: [side] },
    { id: "answer", role: "assistant", text: "Answer" },
  ];
  const sessionsRef = { current: [session] };
  deps = {
    sessionsRef,
    btwRequestsRef: { current: new Map() },
    persistSession: vi.fn(),
    setSessions: (update) => {
      sessionsRef.current = typeof update === "function" ? update(sessionsRef.current) : update;
    },
  };
  function Harness() {
    actions = useBtwThreads(deps);
    return null;
  }
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
function send() {
  actions.runBtwRequest({
    sessionId: current().id,
    userBlockId: "user",
    source: current(),
    thread: thread(),
    harness: current().harness,
  });
}

it("pins and persists the owning account before starting a new provider thread", () => {
  send();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ harness: "claude", providerAccountId: "account-a" }),
  );
  expect(thread().providerAccountId).toBe("account-a");
  expect(deps.persistSession).toHaveBeenCalled();
  run.mock.calls[0][0].onThreadId("provider-side");
  expect(thread()).toMatchObject({
    providerThreadId: "provider-side",
    providerAccountId: "account-a",
  });
});

it.each(["claude", "codex"] as const)(
  "resumes with the side thread's account after parent changes to %s",
  (harness) => {
    thread().providerAccountId = "account-a";
    thread().providerThreadId = "provider-side";
    current().providerAccountId = "account-b";
    current().harness = harness;
    send();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "claude",
        providerAccountId: "account-a",
        threadId: "provider-side",
      }),
    );
  },
);

it.each(["missing", "unknown"])(
  "preserves transcript and blocks unsafe resume when owning account is %s",
  (state) => {
    thread().providerThreadId = "provider-side";
    if (state === "missing") {
      thread().providerAccountId = "removed-account";
      exists.mockReturnValue(false);
    }
    send();
    expect(run).not.toHaveBeenCalled();
    expect(thread()).toMatchObject({ status: "error", providerThreadId: "provider-side" });
    expect(thread().messages).toHaveLength(1);
    expect(thread().error).toContain("Start a new side conversation");
  },
);

it("uses the side harness default for a new side thread after parent provider changes", () => {
  current().harness = "codex";
  current().providerAccountId = "codex-only";
  send();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({ harness: "claude", providerAccountId: "default" }),
  );
});
