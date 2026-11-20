// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../model/session";
import { LocalSessionReferenceProvider } from "./LocalSessionReferenceContext";
import {
  SessionSubagentSheet,
  useDelegatedSheet,
  type DelegatedSheetState,
} from "./SessionSubagentSheet";
import type { SubagentChatComposer, SubagentRelay } from "./SubagentMessageForm";
import { retryDelegated } from "./delegatedFocus";
import { registerRemoteSessionActions } from "../../connections/model/remoteSessionActions";

const fake = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  sheetProps: [] as Array<Record<string, unknown>>,
  owners: [] as Array<Record<string, unknown>>,
  receiptCalls: [] as unknown[][],
  ownerUnreadable: false,
}));

vi.mock("../../connections/public/useHostSessionBinding", async (original) => {
  const actual = await original<typeof import("../../connections/public/useHostSessionBinding")>();
  return {
    ...actual,
    useHostSessionBindingReader() {
      const read = actual.useHostSessionBindingReader();
      if (!fake.ownerUnreadable) return read;
      return () => {
        throw new Error("Owner unavailable");
      };
    },
  };
});

// The sheet is captured, not rendered: these tests check what SessionSubagentSheet hands it.
vi.mock("./SubagentSheet", () => ({
  SubagentSheet: (props: Record<string, unknown>) => {
    fake.sheetProps.push(props);
    return null;
  },
}));
vi.mock("../model/sessionsStore", async (original) => ({
  // Pure selectors (selectSessionById, ...) stay real; only the store reads are faked.
  ...(await original<object>()),
  useSession: (id: string | undefined) => (id ? fake.sessions.get(id) : undefined),
  getSessions: () => [...fake.sessions.values()],
  getShellSessions: () => [...fake.sessions.values()],
  subscribeSessionCommits: () => () => undefined,
  useSessionsSelector: (select: (sessions: unknown[]) => unknown) =>
    select([...fake.sessions.values()]),
  useShellSessionsSelector: (select: (sessions: unknown[]) => unknown) =>
    select([...fake.sessions.values()]),
}));
vi.mock("../../connections/public/DelegatedSessionRequests", () => ({
  useDelegatedMessageReceipts: (...args: unknown[]) => {
    fake.receiptCalls.push(args);
    return [];
  },
  DelegatedSessionRequests: (props: Record<string, unknown>) => {
    fake.owners.push(props);
    return null;
  },
}));

let container: HTMLDivElement;
let root: Root;

const nativeBlock: Block = {
  id: "agent-1",
  role: "tool",
  text: "Review",
  tool: { callId: "spawn-1", kind: "agent", status: "in_progress" },
  agentRun: { name: "Reviewer", prompt: "Inspect changes", steps: [] },
};

function child(overrides: Partial<Session> = {}): Session {
  return {
    id: "child-1",
    title: "Subagent · Codex",
    model: "codex:gpt-6.1-sol",
    cwd: "G:/project",
    busy: false,
    blocks: [],
    modelSettings: {},
    ...overrides,
  } as unknown as Session;
}

function delegatedState(childId?: string, overrides: Partial<DelegatedSheetState> = {}) {
  return {
    childId,
    isOpen: true,
    open: vi.fn(),
    close: vi.fn(),
    agents: [],
    stop: vi.fn(async () => undefined),
    stopRunning: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DelegatedSheetState;
}

function nativeRelay(overrides: Partial<SubagentRelay> = {}): SubagentRelay {
  return {
    mode: "relay",
    draft: "",
    setDraft: vi.fn(),
    send: vi.fn(),
    ...overrides,
  };
}

function props(overrides: Record<string, unknown> = {}) {
  const base = {
    visible: true,
    busy: false,
    cwd: "G:/project",
    native: {
      block: undefined,
      relay: nativeRelay(),
      close: vi.fn(),
      open: vi.fn(),
      showInTranscript: vi.fn(() => true),
    },
    delegated: delegatedState(),
    onSubmitToSession: vi.fn(() => true),
    onStopSession: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as Parameters<typeof SessionSubagentSheet>[0];
}

/** Renders the sheet inside the navigation context the open-conversation action needs. */
function render(value: Parameters<typeof SessionSubagentSheet>[0]) {
  const navigation = { resolve: vi.fn(), open: vi.fn(async () => undefined) };
  act(() =>
    root.render(
      createElement(
        LocalSessionReferenceProvider,
        { value: navigation },
        createElement(SessionSubagentSheet, value),
      ),
    ),
  );
  return navigation;
}

function lastSheet() {
  return fake.sheetProps[fake.sheetProps.length - 1] as {
    relay: SubagentRelay & { onOpenConversation?: () => void };
    composer?: ReactElement<ComponentProps<typeof SubagentChatComposer>>;
    requests?: ReactElement<{ child: Session; composer?: { parentSessionId?: string } }>;
    onStop?: () => Promise<void>;
    onClose: () => void;
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.sessions.clear();
  fake.sheetProps.length = 0;
  fake.owners.length = 0;
  fake.receiptCalls.length = 0;
  fake.ownerUnreadable = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("routes a native subagent's message through the main agent relay", () => {
  const relay = nativeRelay({ draft: "Progress?" });
  render(
    props({
      native: {
        block: nativeBlock,
        relay,
        blockedReason: undefined,
        close: vi.fn(),
        open: vi.fn(),
        showInTranscript: vi.fn(() => true),
      },
    }),
  );
  expect(lastSheet().relay.mode).toBe("relay");
  expect(lastSheet().relay.draft).toBe("Progress?");
  act(() => lastSheet().relay.send());
  expect(relay.send).toHaveBeenCalledOnce();
});

it("sends a delegated child's steer with attachments to that child session", () => {
  fake.sessions.set("child-1", child({ busy: true }));
  const onSubmitToSession = vi.fn(() => true);
  render(props({ onSubmitToSession, delegated: delegatedState("child-1") }));
  const attachment = {
    id: "image",
    name: "diagram.png",
    kind: "image" as const,
    mimeType: "image/png",
    size: 20,
  };
  const options = { followUpBehavior: "steer" as const };
  act(() => {
    lastSheet().composer?.props.onSubmit("Use the cached schema", [attachment], options);
  });
  expect(onSubmitToSession).toHaveBeenCalledWith(
    "child-1",
    "Use the cached schema",
    options,
    [attachment],
    undefined,
  );
});

it("stops the delegated child, not the parent, and offers Stop only while it runs", async () => {
  fake.sessions.set("child-1", child({ busy: true }));
  const onStopSession = vi.fn(async () => undefined);
  const onSubmitToSession = vi.fn(() => true);
  render(props({ onStopSession, onSubmitToSession, delegated: delegatedState("child-1") }));
  await act(async () => lastSheet().onStop?.());
  expect(onStopSession).toHaveBeenCalledWith("child-1");
  expect(onSubmitToSession).not.toHaveBeenCalled();

  fake.sessions.set("child-1", child({ busy: false }));
  render(props({ onStopSession, delegated: delegatedState("child-1") }));
  expect(lastSheet().onStop).toBeUndefined();
});

it("places the Host composer with its child owner and routes Stop there", async () => {
  fake.sessions.set(
    "child-1",
    child({
      busy: true,
      hostBinding: {
        kind: "local-host",
        machineId: "m",
        environmentId: "e",
        projectId: "p",
        sessionId: "child-1",
        authorityGeneration: null,
        created: true,
      },
    }),
  );
  const submit = vi.fn(() => true);
  const stop = vi.fn();
  const release = registerRemoteSessionActions("child-1", {
    submit,
    stop,
    approvalSource: () => ({}),
  } as never);
  const onSubmitToSession = vi.fn();
  const onStopSession = vi.fn();
  render(props({ onSubmitToSession, onStopSession, delegated: delegatedState("child-1") }));
  expect(lastSheet().composer).toBeUndefined();
  expect(lastSheet().requests?.key).toBe("child-1");
  expect(lastSheet().requests?.props).toMatchObject({
    child: { id: "child-1" },
    composer: { name: expect.any(String) },
  });
  await act(async () => lastSheet().onStop?.());
  expect(stop).toHaveBeenCalledOnce();
  expect(onSubmitToSession).not.toHaveBeenCalled();
  expect(onStopSession).not.toHaveBeenCalled();
  release();
  await expect(lastSheet().onStop?.()).rejects.toThrow("unavailable or inaccessible");
  expect(onStopSession).not.toHaveBeenCalled();
});

it("does not offer opening a delegated child as a conversation", () => {
  fake.sessions.set("child-1", child());
  const navigation = render(props({ delegated: delegatedState("child-1") }));
  expect(lastSheet().relay).toBeUndefined();
  expect(navigation.open).not.toHaveBeenCalled();
});

it("renders nothing for a delegated child that is not loaded", () => {
  render(props({ delegated: delegatedState("missing") }));
  expect(fake.sheetProps).toHaveLength(0);
});

it("connects a child Host owner only for its open panel or a pending Stop", () => {
  const binding = {
    kind: "local-host" as const,
    machineId: "m",
    environmentId: "e",
    projectId: "p",
    sessionId: "one",
    authorityGeneration: null,
    created: true,
  };
  const marker = JSON.stringify({
    parentSessionId: "parent",
    runId: "r",
    kind: "advisor",
    model: "m",
    startedAt: 1,
  });
  fake.sessions.set(
    "child-1",
    child({ hostBinding: binding, modelSettings: { delegationParent: marker } }),
  );
  fake.sessions.set(
    "child-2",
    child({
      id: "child-2",
      hostBinding: { ...binding, sessionId: "two" },
      blocks: [{ id: "approval", role: "tool", text: "", approval: { decided: false } } as never],
    }),
  );
  fake.sessions.set(
    "child-3",
    child({ id: "child-3", busy: true, hostBinding: { ...binding, sessionId: "three" } }),
  );
  const agents = [
    { sessionId: "child-1" },
    { sessionId: "child-2" },
    { sessionId: "child-3" },
  ] as DelegatedSheetState["agents"];
  render(props({ delegated: delegatedState("child-1", { agents }) }));
  const sheet = fake.sheetProps.at(-1)!;
  expect(sheet.agentRole).toBe("advisor");
  expect((sheet.requests as { props: { child: Session } }).props.child.id).toBe("child-1");
  // Waiting and running children leave nothing in the parent pane.
  expect(fake.owners).toHaveLength(0);
  render(props({ delegated: delegatedState("child-1", { agents, isOpen: false }) }));
  expect(fake.sheetProps.at(-1)?.requests).toBeUndefined();
  expect(fake.owners).toHaveLength(0);
  render(
    props({
      delegated: delegatedState("child-1", { agents, isOpen: false, stopping: ["child-3"] }),
    }),
  );
  expect(fake.owners).toEqual([
    expect.objectContaining({
      child: expect.objectContaining({ id: "child-3" }),
      renderRequests: false,
    }),
  ]);
});

it("connects a closed Host child's owner only for Stop, then stops that child", async () => {
  const binding = {
    kind: "local-host" as const,
    machineId: "m",
    environmentId: "e",
    projectId: "p",
    sessionId: "child-1",
    authorityGeneration: null,
    created: true,
  };
  const marker = JSON.stringify({
    parentSessionId: "parent",
    runId: "r",
    kind: "subagent",
    model: "m",
    startedAt: 1,
  });
  fake.sessions.set(
    "parent",
    child({ id: "parent", hostBinding: { ...binding, sessionId: "parent" } }),
  );
  fake.sessions.set(
    "child-1",
    child({ busy: true, hostBinding: binding, modelSettings: { delegationParent: marker } }),
  );
  let state!: DelegatedSheetState;
  const onStopSession = vi.fn();
  function Harness() {
    state = useDelegatedSheet({
      sessionId: "parent",
      blocks: [],
      onStopSession,
      onSubmitToSession: vi.fn(() => true),
      closeNative: vi.fn(),
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  expect(state.stopping).toEqual([]);
  let stopped!: Promise<void>;
  act(() => {
    stopped = state.stop("child-1");
  });
  expect(state.stopping).toEqual(["child-1"]);
  const stop = vi.fn();
  let release!: () => void;
  await act(async () => {
    release = registerRemoteSessionActions("child-1", {
      stop,
      approvalSource: () => ({}),
    } as never);
    await stopped;
  });
  expect(stop).toHaveBeenCalledOnce();
  expect(onStopSession).not.toHaveBeenCalled();
  release();
});

it("shows a delegated child's card in the transcript from its sheet", () => {
  fake.sessions.set("child-1", child());
  const showInTranscript = vi.fn(() => true);
  const delegated = delegatedState("child-1");
  render(
    props({
      native: {
        block: undefined,
        relay: nativeRelay(),
        close: vi.fn(),
        open: vi.fn(),
        showInTranscript,
      },
      delegated,
    }),
  );
  const sheet = lastSheet() as unknown as { onShowInTranscript: (id: string) => boolean };
  act(() => void sheet.onShowInTranscript("delegated:child-1"));
  expect(delegated.close).toHaveBeenCalledOnce();
  expect(showInTranscript).toHaveBeenCalledWith("delegated:child-1");
});

it("retries a failed child by sending it the same task through the pane's send path", async () => {
  fake.sessions.set("child-1", child());
  const onSubmitToSession = vi.fn(() => true);
  let state!: DelegatedSheetState;
  function Harness() {
    state = useDelegatedSheet({
      sessionId: "parent",
      blocks: [],
      onStopSession: vi.fn(),
      onSubmitToSession,
      closeNative: vi.fn(),
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  expect(state.connecting).toEqual([]);
  await act(async () => retryDelegated("parent", "child-1"));
  expect(onSubmitToSession).toHaveBeenCalledWith("child-1", "Retry the same task.", {});
  expect(state.connecting).toEqual([]);
  onSubmitToSession.mockReturnValue(false as never);
  await expect(retryDelegated("parent", "child-1")).rejects.toThrow();
});

const hosted = {
  environmentId: "env-1",
  machineId: "machine-1",
  projectId: "project-1",
  sessionId: "host-child-1",
};

it("asks for a child's message receipts only while its panel is open, from its serving Host", () => {
  fake.sessions.set("child-1", child({ hostBinding: hosted } as Partial<Session>));
  render(props({ delegated: delegatedState("child-1"), visible: false }));
  expect(fake.receiptCalls.at(-1)).toEqual([undefined, undefined, undefined]);
  render(props({ delegated: delegatedState("child-1") }));
  expect(fake.receiptCalls.at(-1)).toEqual(["env-1", "host-child-1", "machine-1"]);
  render(props({ delegated: delegatedState("child-1", { isOpen: false }) }));
  expect(fake.receiptCalls.at(-1)).toEqual([undefined, undefined, undefined]);
});

it("never borrows another authority for a child without a readable binding", () => {
  fake.sessions.set("child-1", child());
  render(props({ delegated: delegatedState("child-1") }));
  expect(fake.receiptCalls.at(-1)).toEqual([undefined, undefined, undefined]);
});

it("does not mount a local composer when observing the child owner fails", () => {
  fake.sessions.set("child-1", child());
  fake.ownerUnreadable = true;
  render(props({ delegated: delegatedState("child-1") }));
  expect(lastSheet().composer).toBeUndefined();
  expect(lastSheet().requests).toBeUndefined();
});
