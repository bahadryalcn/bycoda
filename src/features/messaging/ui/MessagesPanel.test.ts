// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MessagesPanel } from "./MessagesPanel";
import type { MessageThread, MessagingAccount } from "../model/messagingTypes";
import { threadUnread } from "../model/messageThreads";

const capture = vi.hoisted(() => ({
  select: (_thread: MessageThread) => {},
  selectedKey: null as string | null,
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
    failures: [],
    loading: false,
    loaded: true,
    refresh: () => {},
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
