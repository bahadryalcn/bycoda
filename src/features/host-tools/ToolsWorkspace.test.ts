// @vitest-environment happy-dom
import { writeBrowserDraftTransfer } from "./browserDraftTransfer";
import { writeToolsDraftPart } from "./toolsDraftTransfer";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  dockHostTools,
  openHostToolsWindow,
  readHostToolsWindow,
  ToolsWorkspace,
} from "./ToolsWorkspace";
import { useDockedTools } from "./toolPaneState";
import type { ToolsTab } from "./toolsUiControl";
import { requestToolsUi } from "./toolsUiControl";

const readback = vi.hoisted(() => vi.fn());
const nativeProtocol = vi.hoisted(() => ({
  native: false,
  loseAck: false,
  existing: true,
  invoke: vi.fn(async () => true),
  send: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeProtocol.invoke }));
vi.mock("./toolsHubTransport", async (original) => ({
  ...(await original<typeof import("./toolsHubTransport")>()),
  queryToolsPresentation: readback,
  nativeToolsAvailable: () => nativeProtocol.native,
  sendToolsHub: nativeProtocol.send,
  waitToolsAcknowledgement: async (_requestId: string, kind: string, send: () => Promise<void>) => {
    await send();
    if (kind === "mounted" && nativeProtocol.loseAck)
      throw new Error("Tools transfer not acknowledged. Original workspace retained.");
  },
}));
const toolViews = vi.hoisted(
  () => new Map<string, (view: { tab: ToolsTab; machine: string }) => void>(),
);

function DockState({ sessionId }: { sessionId: string }) {
  const active = useDockedTools({ cwd: "/one", sessionId });
  return createElement("output", { "data-session": sessionId }, String(active));
}

vi.mock("./SessionHostTools", () => ({
  SessionHostTools: ({
    cwd,
    onViewChange,
    onMounted,
    initialTab,
    initialMachine,
  }: {
    cwd: string;
    onMounted?: (view: { tab: ToolsTab; machine: string }) => void;
    initialTab?: ToolsTab;
    initialMachine?: string;
    onViewChange: (view: { tab: ToolsTab; machine: string }) => void;
  }) => {
    useEffect(() => {
      onMounted?.({ tab: initialTab ?? "devices", machine: initialMachine ?? "project" });
    }, [onMounted]);
    toolViews.set(cwd, (view) => {
      onViewChange(view);
      onMounted?.(view);
    });
    return createElement("div", null, cwd);
  },
}));
vi.mock("../../shared/i18n/technical", () => ({
  useLocale: () => {},
  t: (value: string) => value,
}));
const { created, failure } = vi.hoisted(() => ({ created: vi.fn(), failure: { value: false } }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
  WebviewWindow: class {
    static async getByLabel() {
      if (!nativeProtocol.existing) return null;
      return { label: "tools-hub", show: async () => {}, setFocus: async () => {} };
    }
    constructor(label: string, options: unknown) {
      created(label, options);
    }
    async once(event: string, callback: (event?: unknown) => void) {
      if (event === "tauri://created" && !failure.value) callback();
      if (event === "tauri://error" && failure.value) callback({ payload: "Creation denied" });
      return () => {};
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  created.mockClear();
  toolViews.clear();
  localStorage.removeItem("bycoda.tools-dock.placement.v1");
  failure.value = false;
  readback.mockReset();
  nativeProtocol.native = false;
  nativeProtocol.loseAck = false;
  nativeProtocol.existing = true;
  nativeProtocol.invoke.mockReset().mockResolvedValue(true);
  nativeProtocol.send.mockClear();
  window.history.replaceState({}, "", "/");
});

it("preserves an existing remote target by default and can explicitly mount its project Host", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const context = { cwd: "/one", sessionId: "one", title: "One" };
  try {
    await act(async () => root.render(createElement(ToolsWorkspace, null, "Workspace")));
    await act(async () =>
      dockHostTools({ ...context, initialTab: "browser", initialMachine: "machine:mac" }),
    );
    toolViews.get("/one")!({ tab: "browser", machine: "machine:mac" });
    let reused!: ReturnType<typeof requestToolsUi>;
    await act(async () => {
      reused = requestToolsUi(context, "ui.tools.open", { tab: "browser" });
    });
    expect((await reused).panels[0]).toMatchObject({ machine: "machine:mac", mounted: true });
    let forced!: ReturnType<typeof requestToolsUi>;
    await act(async () => {
      forced = requestToolsUi(context, "ui.tools.open", { tab: "browser", projectHost: true });
    });
    toolViews.get("/one")!({ tab: "browser", machine: "project" });
    expect((await forced).panels[0]).toMatchObject({
      tab: "browser",
      machine: "project",
      mounted: true,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("detaches the current dock tab and machine rather than its original context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ToolsWorkspace, null, "Workspace")));
    await act(async () =>
      dockHostTools({
        cwd: "/current",
        sessionId: "session",
        title: "Current",
        initialTab: "devices",
        initialMachine: "project",
      }),
    );
    toolViews.get("/current")!({ tab: "resources", machine: "machine:mac" });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Open in new window"]')!.click(),
    );
    await act(async () => {
      await vi.waitFor(() => expect(created).toHaveBeenCalled());
    });
    const options = created.mock.calls[0][1];
    expect(readHostToolsWindow(new URL(options.url, "https://bycoda.local").search)).toMatchObject({
      initialTab: "resources",
      initialMachine: "machine:mac",
    });
    expect(container.querySelector(".tools-workspace-pane")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(container.querySelector(".tools-workspace")?.getAttribute("data-open")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

it("retains multiple project panes while moving the reserved workspace region", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ToolsWorkspace, null, createElement("main", null, "Workspace")),
          createElement(DockState, { sessionId: "one" }),
          createElement(DockState, { sessionId: "other" }),
        ),
      ),
    );
    await act(async () => {
      dockHostTools({ cwd: "/one", sessionId: "one", title: "One" }, "logs");
      dockHostTools({ cwd: "/two", sessionId: "two", title: "Two" }, "logs");
      dockHostTools({ cwd: "/one", sessionId: "one", title: "One" }, "logs");
    });
    expect(container.querySelectorAll(".tools-workspace-pane")).toHaveLength(2);
    expect(container.querySelector('[data-session="one"]')?.textContent).toBe("true");
    expect(container.querySelector('[data-session="other"]')?.textContent).toBe("false");
    const select = container.querySelector<HTMLButtonElement>('button[aria-label^="Placement:"]')!;
    await act(async () => {
      select.click();
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((option) => option.textContent === "Dock Bottom")!
        .click();
    });
    expect(container.querySelector(".tools-workspace")?.getAttribute("data-placement")).toBe(
      "bottom",
    );
    expect(container.textContent).toContain("/one");
    expect(container.textContent).toContain("/two");
    expect(container.querySelector("main")?.textContent).toBe("Workspace");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click(),
    );
    expect(container.querySelectorAll(".tools-workspace-pane")).toHaveLength(1);
    expect(container.querySelector('[data-session="one"]')?.textContent).toBe("false");
    expect(container.querySelector('[aria-label="Close panels"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open in new window"]')?.textContent).toBe("");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click(),
    );
    expect(container.querySelector(".tools-workspace-dock")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("creates a resizable native logs window carrying the originating composer and reports failures", async () => {
  await openHostToolsWindow(
    {
      cwd: "remote://mac/repo",
      sessionId: "new-session",
      title: "Project",
      initialMachine: "machine:mac",
    },
    "logs",
  );
  const [, options] = created.mock.calls[0];
  expect(options).toMatchObject({ decorations: true, resizable: true, width: 1000 });
  const payload = JSON.parse(
    new URL(options.url, "https://bycoda.local").searchParams.get("hostTools")!,
  );
  expect(payload).toMatchObject({
    cwd: "remote://mac/repo",
    sessionId: "new-session",
    onlyTab: "logs",
    composerWindow: "main",
    initialMachine: "machine:mac",
  });
  window.history.replaceState({}, "", options.url);
  expect(readHostToolsWindow()).toMatchObject(payload);
  failure.value = true;
  await expect(
    openHostToolsWindow({ cwd: "/one", sessionId: "one", title: "One" }),
  ).rejects.toThrow("Creation denied");
});

it("shows only focused conversation tools while retaining hidden drafts and background registrations", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const one = { cwd: "/one", sessionId: "one", composerSessionId: "composer-one", title: "One" };
  const two = { cwd: "/two", sessionId: "two", composerSessionId: "composer-two", title: "Two" };
  const render = (activeConversation: typeof one | null) =>
    act(async () =>
      root.render(createElement(ToolsWorkspace, { activeConversation }, "Workspace")),
    );
  try {
    await render(one);
    await act(async () => {
      dockHostTools(one);
      dockHostTools(two);
    });
    const panes = () => [...container.querySelectorAll<HTMLElement>(".tools-workspace-pane")];
    const first = panes()[0];
    expect(panes().map((pane) => pane.getAttribute("aria-hidden"))).toEqual(["false", "true"]);
    let background!: ReturnType<typeof requestToolsUi>;
    await act(async () => {
      background = requestToolsUi(two, "ui.tools.open", { tab: "browser" });
    });
    toolViews.get("/two")!({ tab: "browser", machine: "project" });
    expect(await background).toMatchObject({
      open: true,
      visible: false,
      panels: [{ mounted: true, visible: false }],
    });
    expect(panes()[0].getAttribute("aria-hidden")).toBe("false");
    await render(two);
    expect(panes().map((pane) => pane.getAttribute("aria-hidden"))).toEqual(["true", "false"]);
    await render(null);
    expect(container.querySelector(".tools-workspace")?.getAttribute("data-open")).toBe("false");
    expect(panes()).toHaveLength(2);
    await render(one);
    expect(panes()[0]).toBe(first);
    expect(panes()[0].getAttribute("aria-hidden")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

it("reports actual detached hub view and unknown unavailable presentation instead of retained source mounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const context = { cwd: "/one", sessionId: "one", title: "One" };
  try {
    await act(async () =>
      root.render(createElement(ToolsWorkspace, { activeConversation: context }, "Workspace")),
    );
    await act(async () => dockHostTools(context));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Open in new window"]')!.click(),
    );
    await act(async () => {
      await vi.waitFor(() => expect(created).toHaveBeenCalled());
    });
    readback.mockResolvedValue({
      version: 1,
      revision: 1,
      hubWindow: "tools-hub",
      session: context,
      tab: "browser",
      machine: "machine:mac",
      mounted: true,
      visible: true,
    });
    expect(await requestToolsUi(context, "ui.tools.status", {})).toMatchObject({
      presentation: "detached",
      visible: true,
      panels: [
        {
          tab: "browser",
          machine: "machine:mac",
          mounted: true,
          visible: true,
          presentationKnown: true,
        },
      ],
    });
    readback.mockResolvedValue(undefined);
    const unknown = await requestToolsUi(context, "ui.tools.status", {});
    expect(unknown.visible).toBeUndefined();
    expect(unknown.panels[0].mounted).toBeUndefined();
    expect(unknown.panels[0].presentationKnown).toBe(false);
    readback.mockImplementation(async (pane) => ({
      version: 1,
      revision: 2,
      hubWindow: "tools-hub",
      session: pane,
      tab: pane.viewRequest?.tab ?? "devices",
      machine: pane.viewRequest?.machine ?? "project",
      mounted: true,
      visible: false,
    }));
    let opened!: ReturnType<typeof requestToolsUi>;
    await act(async () => {
      opened = requestToolsUi(context, "ui.tools.open", { tab: "logs", projectHost: true });
    });
    expect(await opened).toMatchObject({
      visible: false,
      panels: [{ tab: "logs", machine: "project", mounted: true }],
    });
    expect(container.querySelector(".tools-workspace")?.getAttribute("data-open")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

it("reuses immutable uncertain transfer payload, ignores readonly sampling drift and rejects newer source edits", async () => {
  nativeProtocol.native = true;
  nativeProtocol.loseAck = true;
  const session = {
    cwd: "/retry-scope",
    sessionId: "retry-session",
    title: "Retry",
    initialTab: "devices" as const,
  };
  writeBrowserDraftTransfer(session.cwd, session.sessionId, "project", { comment: "original" });
  await expect(openHostToolsWindow(session)).rejects.toThrow("Original workspace retained");
  const first = nativeProtocol.send.mock.calls[0];
  writeBrowserDraftTransfer(session.cwd, session.sessionId, "project", {
    comment: "newer source edit",
  });
  await expect(openHostToolsWindow(session)).rejects.toThrow("Both workspaces retained");
  expect(nativeProtocol.send).toHaveBeenCalledTimes(1);
  writeBrowserDraftTransfer(session.cwd, session.sessionId, "project", { comment: "original" });
  writeToolsDraftPart(
    { cwd: session.cwd, sessionId: session.sessionId, targetValue: "project" },
    "diagnostics",
    { samples: [] },
  );
  nativeProtocol.loseAck = false;
  await openHostToolsWindow(session);
  expect(nativeProtocol.send.mock.calls[1]).toEqual(first);
});

it("retains original visible dock when provisional detached registration gets no mounted acknowledgment", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); const root = createRoot(container);
  const context = { cwd: "/pending-visible", sessionId: "pending-visible", title: "Pending" };
  try {
    await act(async () => root.render(createElement(ToolsWorkspace, { activeConversation: context }, "Workspace")));
    await act(async () => dockHostTools(context));
    nativeProtocol.native = true; nativeProtocol.loseAck = true;
    await act(async () => { await expect(openHostToolsWindow(context)).rejects.toThrow("Original workspace retained"); });
    expect(container.querySelector(".tools-workspace")?.getAttribute("data-open")).toBe("true");
    expect(container.querySelector(".tools-workspace-pane")?.getAttribute("aria-hidden")).toBe("false");
  } finally { nativeProtocol.native = false; await act(async () => root.unmount()); }
});


it("creates native hub through configured Rust command before sending its acknowledged transfer", async () => {
  nativeProtocol.native = true;
  nativeProtocol.existing = false;
  await openHostToolsWindow({ cwd: "/native-create", sessionId: "native-create", title: "Native" });
  expect(created).not.toHaveBeenCalled();
  expect(nativeProtocol.invoke).toHaveBeenCalledWith("open_host_tools_window", {
    title: "Conversation tools",
    payload: expect.objectContaining({ sessionId: "native-create", composerWindow: "main", transferRequestId: expect.any(String) }),
  });
  expect(nativeProtocol.send).toHaveBeenCalledWith("tools-hub", expect.objectContaining({ kind: "transfer", pane: expect.objectContaining({ sessionId: "native-create" }) }));
});

it("transfers to native hub reused during creation race without waiting for another boot", async () => {
  nativeProtocol.native = true;
  nativeProtocol.existing = false;
  nativeProtocol.invoke.mockResolvedValue(false);
  await openHostToolsWindow({ cwd: "/native-race", sessionId: "native-race" });
  expect(nativeProtocol.send).toHaveBeenCalledTimes(1);
  expect(nativeProtocol.send).toHaveBeenCalledWith("tools-hub", expect.objectContaining({ kind: "transfer" }));
});
