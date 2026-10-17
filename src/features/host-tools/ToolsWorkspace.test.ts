// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  dockHostTools,
  openHostToolsWindow,
  readHostToolsWindow,
  ToolsWorkspace,
} from "./ToolsWorkspace";
import { useDockedTools } from "./toolPaneState";

function DockState({ sessionId }: { sessionId: string }) {
  const active = useDockedTools({ cwd: "/one", sessionId });
  return createElement("output", { "data-session": sessionId }, String(active));
}

vi.mock("./SessionHostTools", () => ({
  SessionHostTools: ({ cwd }: { cwd: string }) => createElement("div", null, cwd),
}));
vi.mock("../../shared/i18n/technical", () => ({
  useLocale: () => {},
  t: (value: string) => value,
}));
const { created, failure } = vi.hoisted(() => ({ created: vi.fn(), failure: { value: false } }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  WebviewWindow: class {
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
  failure.value = false;
  window.history.replaceState({}, "", "/");
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
