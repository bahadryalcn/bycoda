// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MessagesPanel } from "./MessagesPanel";
import type { MessageThread, MessagingAccount, ThreadMessage } from "../model/messagingTypes";
import { threadUnread } from "../model/messageThreads";

const capture = vi.hoisted(() => ({
  select: (_thread: MessageThread) => {},
  selectedKey: null as string | null,
  failures: [] as { account: MessagingAccount; error: string }[],
  refreshAccounts: vi.fn(async (_ids: string[]) => {}),
  messages: [] as ThreadMessage[],
}));
const threads: MessageThread[] = [
  {
    id: "a",
    accountId: "a",
    provider: "slack",
    title: "A",
    participants: [],
    preview: "",
    updatedAt: 1,
    unread: true,
  },
];
vi.mock("../hooks/useMessageThreads", () => ({
  useMessageThreads: () => ({
    threads,
    failures: capture.failures,
    loading: false,
    loaded: true,
    refresh: () => {},
    refreshAccounts: capture.refreshAccounts,
    patchThread: () => {},
  }),
}));
vi.mock("../hooks/useWindowActive", () => ({ useWindowActive: () => true }));
vi.mock("../../../shared/hooks/useDragResize", () => ({
  useDragResize: () => ({ setPaneRef: () => {}, sashProps: {} }),
}));
vi.mock("./MessageThreadList", () => ({
  MessageThreadList: (props: { onSelect: typeof capture.select; selectedKey: string | null }) => {
    capture.select = props.onSelect;
    capture.selectedKey = props.selectedKey;
    return null;
  },
}));
vi.mock("./MessageThreadView", () => ({ MessageThreadView: () => null }));
vi.mock("../hooks/useThreadMessages", () => ({
  useThreadMessages: () => ({ messages: capture.messages, loading: false }),
}));
vi.mock("../../../shared/ui/MessageTimeline", () => ({ MessageTimeline: () => null }));

it("keeps selection callback identity across panel refresh renders and still marks the chosen thread", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const accounts: MessagingAccount[] = [
    {
      id: "a",
      provider: "slack",
      identity: "a",
      label: "",
      config: {},
      connected: true,
      updatedAt: 1,
      createdAt: 1,
    },
  ];
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(createElement(MessagesPanel, { accounts, sourceRow: "First" })),
    );
    const previous = capture.select;
    await act(async () =>
      root.render(createElement(MessagesPanel, { accounts, sourceRow: "Next" })),
    );
    expect(capture.select).toBe(previous);
    await act(async () => capture.select(threads[0]));
    expect(capture.selectedKey).toBe(JSON.stringify(["a", "a"]));
    expect(threadUnread(threads[0])).toBe(false);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("groups failed accounts under one retry and sends only those account IDs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const accounts: MessagingAccount[] = ["healthy", "first", "second"].map((id) => ({
    id,
    provider: "slack",
    label: id,
    identity: id,
    config: {},
    connected: true,
    updatedAt: 1,
    createdAt: 1,
  }));
  capture.failures = accounts.slice(1).map((account) => ({ account, error: "Offline" }));
  capture.refreshAccounts.mockClear();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(MessagesPanel, { accounts, sourceRow: null })));
    expect(container.textContent).toContain("Could not refresh 2 accounts.");
    const retries = [...container.querySelectorAll("button")].filter(
      (control) => control.textContent?.trim() === "Try again",
    );
    expect(retries).toHaveLength(1);
    await act(async () => retries[0].click());
    expect(capture.refreshAccounts).toHaveBeenCalledExactlyOnceWith(["first", "second"]);
  } finally {
    await act(async () => root.unmount());
    capture.failures = [];
    vi.unstubAllGlobals();
  }
});

it("keeps the reader's scroll position on arrival and jumps only when asked", async () => {
  const { MessageThreadView } =
    await vi.importActual<typeof import("./MessageThreadView")>("./MessageThreadView");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const message = (id: string): ThreadMessage => ({
    id,
    threadId: "a",
    author: "Agent",
    body: id,
    at: 1,
    outbound: false,
    attachments: [],
  });
  const render = () =>
    act(async () =>
      root.render(
        createElement(MessageThreadView, {
          thread: threads[0],
          account: undefined,
          onSent: vi.fn(),
        }),
      ),
    );
  capture.messages = [message("first")];
  try {
    await render();
    const scroller = container.querySelector<HTMLDivElement>('div[tabindex="-1"]')!;
    Object.defineProperties(scroller, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });
    await act(async () => {
      scroller.scrollTop = 150;
      scroller.dispatchEvent(new Event("scroll"));
    });
    capture.messages = [...capture.messages, message("latest")];
    await render();
    expect(scroller.scrollTop).toBe(150);
    const jump = [...container.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Jump to latest",
    )!;
    await act(async () => jump.click());
    expect(scroller.scrollTop).toBe(scroller.scrollHeight);
    expect(document.activeElement).toBe(scroller);
    expect(container.textContent).not.toContain("Jump to latest");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    capture.messages = [];
    vi.unstubAllGlobals();
  }
});
