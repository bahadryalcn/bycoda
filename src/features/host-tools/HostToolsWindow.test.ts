// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readToolsWorkspaceDrafts, writeToolsDraftPart } from "./toolsDraftTransfer";
import HostToolsWindow from "./HostToolsWindow";
import type { ToolsHubMessage } from "./toolsHubTransport";
import type { ToolsSession, ToolsSourceSnapshot } from "./toolsSessionRegistry";
const transport = vi.hoisted(() => ({
  receive: undefined as ((message: ToolsHubMessage) => void) | undefined,
  send: vi.fn(),
  sources: vi.fn(async () => new Set(["main", "tools-hub"])),
}));
vi.mock("./toolsHubTransport", () => ({
  nativeToolsAvailable: () => true,
  requestToolsSources: transport.sources,
  sendToolsHub: transport.send,
  subscribeToolsHub: async (receive: (message: ToolsHubMessage) => void) => {
    transport.receive = receive;
    return () => {
      transport.receive = undefined;
    };
  },
  waitToolsAcknowledgement: async (_id: string, _kind: string, send: () => Promise<void>) => send(),
}));
vi.mock("../../app/model/hostToolsWindowGeometry", () => ({
  retainToolsWindowGeometry: async () => () => {},
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "tools-hub",
    onCloseRequested: async () => () => {},
    hide: async () => {},
    isVisible: async () => true,
  }),
}));
vi.mock("../../shared/i18n/technical", () => ({
  t: (value: string) => value,
  useLocale: () => {},
}));
vi.mock("./SessionHostTools", () => ({
  SessionHostTools: ({
    sessionId,
    active,
    onMounted,
  }: {
    sessionId: string;
    active: boolean;
    onMounted: (view: { tab: "devices"; machine: string }) => void;
  }) => {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      onMounted({ tab: "devices", machine: "project" });
    }, []);
    return createElement("input", {
      "data-session": sessionId,
      "data-active": String(active),
      value: draft,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    });
  },
}));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const one: ToolsSession = {
  cwd: "/project-one",
  sessionId: "one",
  title: "First",
  composerWindow: "main",
  composerSessionId: "composer-one",
};
const two: ToolsSession = {
  cwd: "/project-two",
  sessionId: "two",
  title: "Second",
  composerWindow: "main",
  composerSessionId: "composer-two",
};
let revision = 0;
const snapshot = async (
  active: ToolsSession | null,
  panes: ToolsSession[] = [one, two],
  selectionRevision = ++revision,
) => {
  const value: ToolsSourceSnapshot = {
    sourceWindow: "main",
    revision: ++revision,
    selectionRevision,
    active,
    panes: panes.map((pane) => ({ ...pane, id: pane.sessionId })),
  };
  await act(async () => transport.receive?.({ kind: "snapshot", snapshot: value }));
};
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  transport.send.mockReset().mockResolvedValue(undefined);
  revision = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(HostToolsWindow, { ...one, transferRequestId: "transfer-one" })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const active = () => container.querySelector<HTMLInputElement>('input[data-active="true"]');
it("acknowledges mounted destination and follows A/B/empty/A without borrowing images or remounting A", async () => {
  expect(transport.send).toHaveBeenCalledWith("main", {
    kind: "ready",
    requestId: "transfer-one",
    hubWindow: "tools-hub",
  });
  await act(async () =>
    transport.receive?.({
      kind: "transfer",
      requestId: "transfer-one",
      sourceWindow: "main",
      pane: { ...one, id: "one" },
    }),
  );
  await vi.waitFor(() =>
    expect(transport.send).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({
        kind: "mounted",
        requestId: "transfer-one",
        hubWindow: "tools-hub",
        tab: "devices",
        machine: "project",
      }),
    ),
  );
  await snapshot(one);
  const first = active();
  await snapshot(two);
  expect(active()?.getAttribute("data-session")).toBe("two");
  await snapshot({ ...two, sessionId: "empty", title: "Empty" });
  expect(active()).toBeNull();
  expect(container.textContent).toContain("No tools in this conversation");
  expect(container.textContent).toContain("Empty");
  await snapshot(one);
  expect(active()).toBe(first);
});
it("keeps explicit pin choice while new registration and stale replies never hijack selection", async () => {
  await snapshot(one);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Follow active conversation"]')!
      .click(),
  );
  expect(localStorage.getItem("bycoda.tools-hub.follow.v1")).toBe("false");
  await snapshot(two);
  expect(active()?.getAttribute("data-session")).toBe("one");
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Keep this conversation"]')!.click(),
  );
  expect(active()?.getAttribute("data-session")).toBe("two");
  const previous = revision;
  await snapshot(one, [one, two], previous);
  expect(active()?.getAttribute("data-session")).toBe("one");
  await act(async () =>
    transport.receive?.({
      kind: "snapshot",
      snapshot: {
        sourceWindow: "main",
        revision: 0,
        selectionRevision: 99999,
        active: two,
        panes: [],
      },
    }),
  );
  expect(active()?.getAttribute("data-session")).toBe("one");
});
it("removes deleted or locked source entries and clears selected presentation", async () => {
  await snapshot(one);
  await snapshot(one, [two]);
  expect(active()).toBeNull();
  expect(container.querySelector('input[data-session="one"]')).toBeNull();
});

it("answers bounded presentation queries with actual selection, mounted domain and view without changing session", async () => {
  await snapshot(two);
  transport.send.mockClear();
  await act(async () =>
    transport.receive?.({
      kind: "presentation-query",
      requestId: "query-one",
      sourceWindow: "main",
      session: one,
    }),
  );
  await vi.waitFor(() =>
    expect(transport.send).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({
        kind: "presentation",
        requestId: "query-one",
        presentation: expect.objectContaining({
          version: 1,
          session: expect.objectContaining({ sessionId: "one" }),
          mounted: true,
          visible: false,
        }),
      }),
    ),
  );
  expect(active()?.getAttribute("data-session")).toBe("two");
});

it("acknowledges duplicate uncertain transfer without overwriting newer destination drafts", async () => {
  const drafts = {
    browserDrafts: {},
    toolsDrafts: {
      project: {
        servers: {
          showStart: true,
          name: "server",
          command: "original",
          workingDirectory: "/project-one",
          port: "3000",
          restartCommand: "",
          restartCwd: "",
        },
      },
    },
  };
  const message: ToolsHubMessage = {
    kind: "transfer",
    requestId: "retry-preserve",
    sourceWindow: "main",
    pane: { ...one, id: "one" },
    drafts,
  };
  await act(async () => transport.receive?.(message));
  await vi.waitFor(() =>
    expect(transport.send).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({ kind: "mounted", requestId: "retry-preserve" }),
    ),
  );
  writeToolsDraftPart(
    { cwd: one.cwd, sessionId: one.sessionId, targetValue: "project" },
    "servers",
    { ...drafts.toolsDrafts.project.servers, command: "destination edit" },
  );
  transport.send.mockClear();
  await act(async () => transport.receive?.(message));
  await vi.waitFor(() =>
    expect(transport.send).toHaveBeenCalledWith(
      "main",
      expect.objectContaining({ kind: "mounted", requestId: "retry-preserve" }),
    ),
  );
  expect(readToolsWorkspaceDrafts(one.cwd, one.sessionId).project.servers?.command).toBe(
    "destination edit",
  );
});
