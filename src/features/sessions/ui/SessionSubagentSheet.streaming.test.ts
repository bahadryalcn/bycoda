// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rememberRemoteSession } from "../../connections/model/connections";
import { useDelegatedDockAgents } from "../model/reactiveReads";
import { newSession, type Block, type Session } from "../model/session";
import { clearComposerDraft } from "../model/draftCache";
import { getShellSessions, resetSessionsStore, setSessions } from "../model/sessionsStore";
import { SessionSubagentSheet } from "./SessionSubagentSheet";

const counters = vi.hoisted(() => ({
  historySteps: 0,
  families: 0,
  firstChild: undefined as Session | undefined,
}));
vi.mock("../model/delegatedAgents", async (original) => {
  const actual = await original<typeof import("../model/delegatedAgents")>();
  return {
    ...actual,
    delegatedChildren(...args: Parameters<typeof actual.delegatedChildren>) {
      counters.families++;
      return actual.delegatedChildren(...args);
    },
    delegatedDockAgents(...args: Parameters<typeof actual.delegatedDockAgents>) {
      counters.firstChild = args[0][0];
      return actual.delegatedDockAgents(...args);
    },
    delegatedAgentBlock(...args: Parameters<typeof actual.delegatedAgentBlock>) {
      const block = actual.delegatedAgentBlock(...args);
      if (args[1]?.history) counters.historySteps += block.agentRun?.steps.length ?? 0;
      return block;
    },
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const empty: Block[] = [];
const noop = () => {};
vi.mock("./useComposerFileDrop", () => ({ useComposerFileDrop: () => {} }));

function child(id: string, parentSessionId: string, cwd = "/repo"): Session {
  return {
    ...newSession("codex", cwd),
    id,
    busy: true,
    modelSettings: {
      delegationParent: JSON.stringify({
        parentSessionId,
        runId: id,
        kind: "subagent",
        model: "m",
        startedAt: 1,
      }),
    },
    blocks: [{ id: "answer", role: "assistant", text: "first reply", streaming: true }],
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetSessionsStore([]);
  clearComposerDraft("worker");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["closed", "background tab"])(
  "keeps %s history still and shows the latest update on return",
  async (state) => {
    const run = child("worker", "parent", "");
    const history: Block[] = [
      { id: "brief", role: "user", text: "Inspect" },
      ...Array.from({ length: 440 }, (_, i) => ({
        id: String(i),
        role: "assistant" as const,
        text: "earlier",
      })),
    ];
    const reply = run.blocks[0];
    resetSessionsStore([{ ...run, blocks: [...history, reply] }]);
    const show = (isOpen: boolean, visible = true) =>
      act(async () =>
        root.render(
          createElement(SessionSubagentSheet, {
            visible,
            busy: false,
            delegated: {
              childId: run.id,
              isOpen,
              open: noop,
              close: noop,
              agents: [],
              stopping: [],
              connecting: [],
              stop: async () => {},
              stopRunning: async () => {},
            },
            native: {
              relay: { draft: "", setDraft: noop, send: noop },
              close: noop,
              open: noop,
              showInTranscript: () => true,
            },
            onSubmitToSession: () => true,
            onStopSession: noop,
          }),
        ),
      );
    await show(true);
    expect(container.textContent).toContain("first reply");
    const composer = container.querySelector("textarea")!;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setValue.call(composer, "keep my draft");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    if (state === "closed") await show(false);
    else await show(true, false);
    counters.historySteps = 0;
    for (let i = 1; i <= 12; i++) {
      act(() =>
        setSessions([{ ...run, blocks: [...history, { ...reply, text: "hidden reply " + i }] }]),
      );
    }
    expect(counters.historySteps).toBe(0);
    expect(container.textContent).not.toContain("hidden reply");
    await show(true);
    expect(container.textContent).toContain("hidden reply 12");
    expect(container.querySelector("textarea")?.value).toBe("keep my draft");
  },
);

function Dock({ parentId }: { parentId: string }) {
  const rows = useDelegatedDockAgents(parentId, empty);
  return createElement(
    "div",
    null,
    rows.map((row) => row.sessionId + (row.needsInput ? " waiting" : "")).join("\n"),
  );
}

it("updates a streaming child without repeating family lookup or decoding unchanged links", () => {
  const parent = { ...newSession("codex", "/repo"), id: "parent" };
  const children = Array.from({ length: 30 }, (_, i) => child("worker-" + i, parent.id));
  const shell = [parent, ...children];
  resetSessionsStore(shell);
  act(() => root.render(createElement(Dock, { parentId: parent.id })));
  expect(container.textContent).toContain("worker-29");
  counters.families = 0;
  const parse = vi.spyOn(JSON, "parse");
  const latest = {
    ...children[0],
    blocks: [{ ...children[0].blocks[0], text: "new visible reply" }],
  };
  act(() => setSessions([parent, latest, ...children.slice(1)]));
  const linkReads = parse.mock.calls.filter(([raw]) => raw.includes('"parentSessionId"')).length;
  expect(getShellSessions()).toBe(shell);
  expect(counters.firstChild).toBe(latest);
  expect({ familyLookups: counters.families, linkReads }).toEqual({
    familyLookups: 0,
    linkReads: 0,
  });
});

it("refreshes a remote family when only its stored binding changes", () => {
  const cwd = "remote://environment/repo";
  const parent = { ...newSession("codex", cwd), id: "parent-shell" };
  const run = child("worker-shell", "host-parent", cwd);
  rememberRemoteSession(parent.id, "host-parent");
  rememberRemoteSession(run.id, "host-worker");
  try {
    resetSessionsStore([parent, run]);
    act(() => root.render(createElement(Dock, { parentId: parent.id })));
    expect(container.textContent).toContain(run.id);
    act(() => rememberRemoteSession(run.id));
    expect(container.textContent).not.toContain(run.id);
    act(() => rememberRemoteSession(run.id, "host-worker"));
    expect(container.textContent).toContain(run.id);
  } finally {
    act(() => {
      rememberRemoteSession(run.id);
      rememberRemoteSession(parent.id);
    });
  }
});

it("moves a nested request to its new parent's row and clears it when answered", () => {
  const parent = { ...newSession("codex", "/repo"), id: "parent" };
  const first = child("first", parent.id);
  const second = child("second", parent.id);
  const waiting = { ...child("grandchild", first.id), pendingOwnerApproval: true };
  resetSessionsStore([parent, first, second, waiting]);
  act(() => root.render(createElement(Dock, { parentId: parent.id })));
  expect(container.textContent).toBe("first waiting\nsecond");
  const moved = { ...waiting, modelSettings: child(waiting.id, second.id).modelSettings };
  act(() => setSessions([parent, first, second, moved]));
  expect(container.textContent).toBe("first\nsecond waiting");
  act(() => setSessions([parent, first, second, { ...moved, pendingOwnerApproval: false }]));
  expect(container.textContent).toBe("first\nsecond");
});

it("rechecks ownership when another window changes a Host binding", () => {
  const parent = { ...newSession("codex", "/repo"), id: "parent" };
  const run = child("worker", parent.id);
  resetSessionsStore([parent, run]);
  act(() => root.render(createElement(Dock, { parentId: parent.id })));
  expect(container.textContent).toContain(run.id);
  const key = "bycoda.host-session-binding.v1:" + run.id;
  try {
    act(() => {
      localStorage.setItem(key, "invalid");
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(container.textContent).not.toContain(run.id);
  } finally {
    act(() => {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
  }
  expect(container.textContent).toContain(run.id);
});
