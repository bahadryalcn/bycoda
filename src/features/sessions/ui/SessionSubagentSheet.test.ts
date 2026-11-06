// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../model/session";
import { localReferenceForSession } from "../model/localSessionNavigation";
import { LocalSessionReferenceProvider } from "./LocalSessionReferenceContext";
import { SessionSubagentSheet, type DelegatedSheetState } from "./SessionSubagentSheet";
import type { SubagentRelay } from "./SubagentMessageForm";

const fake = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  sheetProps: [] as Array<Record<string, unknown>>,
}));

// The sheet is captured, not rendered: these tests check what SessionSubagentSheet hands it.
vi.mock("./SubagentSheet", () => ({
  SubagentSheet: (props: Record<string, unknown>) => {
    fake.sheetProps.push(props);
    return null;
  },
}));
vi.mock("../model/sessionsStore", () => ({
  useSession: (id: string | undefined) => (id ? fake.sessions.get(id) : undefined),
}));
vi.mock("../model/localSessionNavigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/localSessionNavigation")>()),
  localReferenceForSession: vi.fn(),
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
      onOpenMain: vi.fn(),
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
    onStop?: () => Promise<void>;
    onClose: () => void;
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.sessions.clear();
  fake.sheetProps.length = 0;
  vi.mocked(localReferenceForSession).mockReset();
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
        onOpenMain: vi.fn(),
      },
    }),
  );
  expect(lastSheet().relay.mode).toBe("relay");
  expect(lastSheet().relay.draft).toBe("Progress?");
  act(() => lastSheet().relay.send());
  expect(relay.send).toHaveBeenCalledOnce();
});

it("sends a delegated child's message straight to that child session", async () => {
  fake.sessions.set("child-1", child({ busy: true }));
  const onSubmitToSession = vi.fn(() => true);
  render(props({ onSubmitToSession, delegated: delegatedState("child-1") }));
  expect(lastSheet().relay.mode).toBe("direct");
  act(() => lastSheet().relay.setDraft("Use the cached schema"));
  await act(async () => lastSheet().relay.send());
  expect(onSubmitToSession).toHaveBeenCalledWith(
    "child-1",
    "Use the cached schema",
    expect.objectContaining({ onSendRejected: expect.any(Function) }),
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

it("opens the child's own conversation and closes the sheet on success", async () => {
  fake.sessions.set("child-1", child());
  const locator = { kind: "host", environmentId: "env", sessionId: "child-1" };
  vi.mocked(localReferenceForSession).mockResolvedValue(locator as never);
  const delegated = delegatedState("child-1");
  const navigation = render(props({ delegated }));
  await act(async () => lastSheet().relay.onOpenConversation?.());
  expect(localReferenceForSession).toHaveBeenCalledWith(expect.objectContaining({ id: "child-1" }));
  expect(navigation.open).toHaveBeenCalledWith({ locator });
  expect(delegated.close).toHaveBeenCalledOnce();
  expect(lastSheet().relay.openError).toBeUndefined();
});

it("shows why opening failed and keeps the sheet open", async () => {
  fake.sessions.set("child-1", child());
  vi.mocked(localReferenceForSession).mockRejectedValue(new Error("Session is no longer visible"));
  const delegated = delegatedState("child-1");
  const navigation = render(props({ delegated }));
  await act(async () => lastSheet().relay.onOpenConversation?.());
  expect(lastSheet().relay.openError).toBe("Session is no longer visible");
  expect(navigation.open).not.toHaveBeenCalled();
  expect(delegated.close).not.toHaveBeenCalled();
});

it("renders nothing for a delegated child that is not loaded", () => {
  render(props({ delegated: delegatedState("missing") }));
  expect(fake.sheetProps).toHaveLength(0);
});
