// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readToolsWorkspaceDrafts, writeToolsDraftPart } from "./toolsDraftTransfer";
import HostToolsWindow from "./HostToolsWindow";
import { Popover } from "../../shared/ui/Popover";
import type { ToolsHubMessage } from "./toolsHubTransport";
import type { ToolsSession, ToolsSourceSnapshot } from "./toolsSessionRegistry";
const transport = vi.hoisted(() => ({
  receive: undefined as ((message: ToolsHubMessage) => void) | undefined,
  send: vi.fn(),
  sources: vi.fn(async () => new Set(["main", "tools-hub"])),
  acknowledge: vi.fn(async () => {}),
  focus: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
  close: undefined as undefined | ((event: { preventDefault: () => void }) => void),
  portal: false,
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
  waitToolsAcknowledgement: async (_id: string, _kind: string, send: () => Promise<void>) => {
    await send();
    await transport.acknowledge();
  },
}));
vi.mock("../../app/model/windowNavigation", () => ({ focusSessionWindow: transport.focus }));
vi.mock("../../app/model/sessionWindowOwnership", () => ({ remoteSessionOwnershipKey: vi.fn() }));
vi.mock("../../app/model/hostToolsWindowGeometry", () => ({
  retainToolsWindowGeometry: async () => () => {},
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "tools-hub",
    onCloseRequested: async (close: typeof transport.close) => {
      transport.close = close;
      return () => {};
    },
    hide: transport.hide,
    show: transport.show,
    isVisible: async () => true,
  }),
}));
vi.mock("../../shared/i18n/technical", () => ({
  t: (value: string) => value,
  useT: () => (value: string) => value,
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
    const input = createElement("input", {
      "data-session": sessionId,
      "data-active": String(active),
      value: draft,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    });
    return createElement(
      "div",
      null,
      input,
      transport.portal
        ? createElement(
            Popover,
            { anchor: { x: 40, y: 40 }, kind: "dialog", "aria-label": "Retained tool draft" },
            createElement("input", {
              "aria-label": "Tool portal draft",
              defaultValue: "Unsent portal text",
            }),
          )
        : null,
    );
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
  transport.acknowledge.mockReset().mockResolvedValue(undefined);
  transport.focus.mockReset().mockResolvedValue(undefined);
  transport.hide.mockReset().mockResolvedValue(undefined);
  transport.show.mockReset().mockResolvedValue(undefined);
  transport.portal = false;
  revision = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(createElement(HostToolsWindow, { ...one, transferRequestId: "transfer-one" })),
  );
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const active = () => container.querySelector<HTMLInputElement>('input[data-active="true"]');
it.each(["acknowledgement", "focus"])(
  "retains newer source edits during return %s",
  async (stage) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = stage === "acknowledgement" ? transport.acknowledge : transport.focus;
    waiting.mockImplementationOnce(() => barrier);
    const scope = { cwd: one.cwd, sessionId: one.sessionId, targetValue: "project" };
    const server = {
      showStart: true,
      name: "Server",
      command: "original",
      workingDirectory: one.cwd,
      port: "3000",
      restartCommand: "",
      restartCwd: "",
    };
    writeToolsDraftPart(scope, "servers", server);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!.click(),
    );
    await vi.waitFor(() => expect(waiting).toHaveBeenCalled());
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    // A pending tool completion can still update its retained draft while native focus/ACK is awaited.
    writeToolsDraftPart(scope, "servers", { ...server, command: "newer unsent" });
    await act(async () => {
      release();
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Both workspaces retained for review"),
    );
    expect(transport.hide).not.toHaveBeenCalled();
    expect(active()).not.toBeNull();
    expect(readToolsWorkspaceDrafts(one.cwd, one.sessionId).project.servers?.command).toBe(
      "newer unsent",
    );
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  },
);
it("retires unchanged source only after the matching return acknowledgement", async () => {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!.click(),
  );
  await vi.waitFor(() => expect(transport.hide).toHaveBeenCalledOnce());
  expect(transport.acknowledge).toHaveBeenCalledOnce();
  expect(active()).toBeNull();
});
it.each(["acknowledgement", "native hide"])(
  "gates retained portalled input until %s settles, preserving its draft on failure",
  async (stage) => {
    transport.portal = true;
    await act(async () =>
      root.render(createElement(HostToolsWindow, { ...one, transferRequestId: "transfer-one" })),
    );
    const field = document.querySelector<HTMLInputElement>('[aria-label="Tool portal draft"]')!;
    field.focus();
    let reject!: (cause: Error) => void;
    const barrier = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const waiting = stage === "acknowledgement" ? transport.acknowledge : transport.hide;
    waiting.mockImplementationOnce(() => barrier);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!.click(),
    );
    await vi.waitFor(() => expect(waiting).toHaveBeenCalled());
    const ancestors = (node: HTMLElement) => {
      const result: HTMLElement[] = [];
      for (let current: HTMLElement | null = node; current; current = current.parentElement)
        result.push(current);
      return result;
    };
    expect(ancestors(field).some((node) => node.inert)).toBe(true);
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(field.isConnected).toBe(true);
    await act(async () => reject(new Error("Return uncertain. Original workspace retained.")));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull(),
    );
    expect(ancestors(field).some((node) => node.inert)).toBe(false);
    expect(field.value).toBe("Unsent portal text");
    expect(field.isConnected).toBe(true);
    expect(active()).not.toBeNull();
    expect(document.activeElement).toBe(field);
  },
);
it.each(["retain", "retry succeeded", "owner closed"])(
  "releases a timed out native hide and guards its late reveal: %s",
  async (outcome) => {
    vi.useFakeTimers();
    let finish!: () => void;
    transport.hide.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const returnButton = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!;
    await act(async () => returnButton().click());
    await vi.waitFor(() => expect(transport.hide).toHaveBeenCalledOnce());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30001);
    });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(container.textContent).toContain("timed out");
    expect(active()).not.toBeNull();
    if (outcome === "retry succeeded") {
      await act(async () => returnButton().click());
      await vi.waitFor(() => expect(active()).toBeNull());
    } else if (outcome === "owner closed") {
      await act(async () => transport.close?.({ preventDefault: vi.fn() }));
    }
    await act(async () => finish());
    expect(transport.show).toHaveBeenCalledTimes(outcome === "retain" ? 1 : 0);
  },
);
it("releases a timed out focus without hiding the retained pane after its late completion", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  transport.focus.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!.click(),
  );
  await vi.waitFor(() => expect(transport.focus).toHaveBeenCalledOnce());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30001);
  });
  expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  expect(active()).not.toBeNull();
  await act(async () => finish());
  expect(transport.hide).not.toHaveBeenCalled();
});
it("does not reveal a closed-then-reopened source after unmount and a late timed out hide", async () => {
  vi.useFakeTimers();
  await act(async () => transport.close?.({ preventDefault: vi.fn() }));
  await transport.show();
  transport.show.mockClear();
  let finish!: () => void;
  transport.hide.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Return to conversation"]')!.click(),
  );
  await vi.waitFor(() => expect(transport.hide).toHaveBeenCalledTimes(2));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30001);
  });
  expect(active()).not.toBeNull();
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => finish());
  expect(transport.show).not.toHaveBeenCalled();
});
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
