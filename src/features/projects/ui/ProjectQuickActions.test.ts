// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectQuickActions } from "./ProjectQuickActions";
import { NativePopupHost } from "../../../shared/ui/NativePopupHost";
import { listExternalEditors, openInExternalEditor } from "../../../platform/tauri/fs";
import { loadProjectActions, saveProjectActions } from "../model/projectActions";
import { openUrl } from "@tauri-apps/plugin-opener";
import { hostFeatureRequest } from "../../connections/model/hostFeatureClient";

/** Hovers a control until the shared tooltip opens and returns its text (key caps included). */
async function tooltipText(element: HTMLElement): Promise<string> {
  await act(async () => {
    element.dispatchEvent(new Event("pointerover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  const text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
  await act(async () => {
    element.dispatchEvent(new Event("pointerout", { bubbles: true }));
  });
  return text;
}
vi.mock("../../connections/model/hostFeatureClient", () => ({ hostFeatureRequest: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  listExternalEditors: vi.fn(async () => [{ id: "cursor", name: "Cursor" }]),
  openInExternalEditor: vi.fn(async () => {}),
  revealPath: vi.fn(async () => {}),
  readTextFile: vi.fn(async () => ""),
  statFiles: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(hostFeatureRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _capability, method) =>
      method === "devServers.list" ? { status: "ok", servers: [], scannedAt: 1 } : {},
    );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

it("keeps adding actions in the open dialog and persists each action with a new id", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === text,
    )!;
  try {
    await act(async () =>
      root.render(
        createElement(
          NativePopupHost.Provider,
          { value: null },
          createElement(ProjectQuickActions, { cwd: "C:/project" }),
        ),
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Project actions"]')!.click(),
    );
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    await act(async () => button("test").click());
    await act(async () => button("Save action").click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(loadProjectActions("C:/project").map((item) => item.name)).toEqual(["test"]);
    expect(button("test").disabled).toBe(true);
    expect(button("Save action").disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[maxlength="80"]')!.value).toBe("");
    expect(document.querySelector('[aria-label="Project actions"] ul')?.textContent).toContain(
      "test",
    );
    await act(async () => button("build").click());
    await act(async () => button("Save action").click());
    const saved = loadProjectActions("C:/project");
    expect(saved.map((item) => item.name)).toEqual(["test", "build"]);
    expect(new Set(saved.map((item) => item.id)).size).toBe(2);
    await act(async () => button("run").click());
    const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("disk full");
    });
    try {
      await act(async () => button("Save action").click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Could not save actions",
      );
      expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("cargo run");
      expect(loadProjectActions("C:/project")).toEqual(saved);
    } finally {
      storage.mockRestore();
    }
    await act(async () => button("Close").click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Project actions"]')!.click(),
    );
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("test");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("build");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(["web", "native"])(
  "opens the add-action dialog from the %s project menu without dragging the pane",
  async (surface) => {
    const host = document.createElement("div");
    const popupHost = document.createElement("div");
    document.body.append(host);
    document.body.append(popupHost);
    const root = createRoot(host);
    const drag = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(
            "div",
            {
              onPointerDown: (event: { target: EventTarget }) => {
                if (!(event.target as HTMLElement).closest("[data-no-drag]")) drag();
              },
            },
            createElement(
              NativePopupHost.Provider,
              { value: surface === "native" ? popupHost : null },
              createElement(ProjectQuickActions, { cwd: "C:/project" }),
            ),
          ),
        ),
      );
      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-label="Project actions"]')!.click(),
      );
      const add = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
      expect(add.textContent).toContain("Add action");
      expect(host.contains(add)).toBe(false);
      const icon = add.querySelector("svg")!;
      await act(async () =>
        icon.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })),
      );
      expect(drag).not.toHaveBeenCalled();
      await act(async () =>
        icon.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })),
      );
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add action");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      popupHost.remove();
    }
  },
);

it("starts managed actions on the selected remote host without using a local terminal or browser", async () => {
  const cwd = "remote://machine/worktree";
  saveProjectActions(cwd, [
    {
      id: "dev",
      name: "Dev",
      icon: "play",
      command: "pnpm dev",
      url: "http://localhost:5173",
      devServer: true,
    },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onRun = vi.fn();
  try {
    await act(async () => root.render(createElement(ProjectQuickActions, { cwd, onRun })));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Run Dev"]')!.click());
    expect(hostFeatureRequest).toHaveBeenCalledWith(cwd, "dev.servers", "devServers.start", {
      name: "Dev",
      command: "pnpm dev",
      cwd: "/worktree",
      expectedPort: 5173,
    });
    expect(onRun).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Development servers");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("blocks duplicate managed starts and ignores completion after switching projects", async () => {
  saveProjectActions("C:/old", [
    { id: "dev", name: "Dev", icon: "play", command: "node dev.js", url: "", devServer: true },
  ]);
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockImplementation((_cwd, _capability, method) =>
    method === "devServers.start"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ status: "ok", servers: [], scannedAt: 1 }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ProjectQuickActions, { cwd: "C:/old" })));
    await act(async () => {
      const run = host.querySelector<HTMLButtonElement>('[aria-label="Run Dev"]')!;
      run.click();
      run.click();
    });
    expect(
      vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "devServers.start"),
    ).toHaveLength(1);
    await act(async () => root.render(createElement(ProjectQuickActions, { cwd: "C:/new" })));
    await act(async () => finish({ conflict: { port: 5173, servers: [] } }));
    expect(document.body.textContent).not.toContain("Port 5173 is already in use.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("discovers editors on demand and opens the current folder", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ProjectQuickActions, { cwd: "C:/project" })));
    expect(listExternalEditors).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Open project in"]')!.click(),
    );
    const editor = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Cursor",
    )!;
    await act(async () => editor.click());
    expect(openInExternalEditor).toHaveBeenCalledWith("cursor", "C:/project");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
it("runs a saved action and keeps folder controls local while exposing remote project actions", async () => {
  const action = {
    id: "test",
    name: "Tests",
    icon: "play" as const,
    command: "pnpm test",
    url: "",
  };
  saveProjectActions("C:/project", [action]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onRun = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectQuickActions, {
          cwd: "C:/project-worktree",
          actionsCwd: "C:/project",
          onRun,
        }),
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Run Tests"]')!.click(),
    );
    expect(onRun).toHaveBeenCalledWith(action);
    const openButton = host.querySelector<HTMLButtonElement>('[aria-label="Open project in"]')!;
    expect(openButton.dataset.expanded).toBeUndefined();
    expect(await tooltipText(openButton)).toContain("C:/project-worktree");
    await act(async () =>
      root.render(
        createElement(ProjectQuickActions, {
          cwd: "remote://machine/project",
          onRun,
        }),
      ),
    );
    expect(host.querySelector('[aria-label="Open project in"]')).toBeNull();
    expect(host.querySelector('[aria-label="Project actions"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("runs a shortcut once and respects the browser-opening preference", async () => {
  saveProjectActions("C:/project", [
    {
      id: "shortcut",
      name: "Dev",
      icon: "play",
      command: "pnpm dev",
      url: "http://localhost:5173",
      shortcut: "Control+Option+KeyY",
      openUrlOnRun: false,
    },
  ]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onRun = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectQuickActions, {
          cwd: "C:/project",
          onRun,
          shortcutsEnabled: false,
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyY",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onRun).not.toHaveBeenCalled();
    await act(async () =>
      root.render(createElement(ProjectQuickActions, { cwd: "C:/project", onRun })),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyY",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(openUrl).not.toHaveBeenCalled();
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyY",
          ctrlKey: true,
          altKey: true,
          repeat: true,
          bubbles: true,
        }),
      ),
    );
    expect(onRun).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps header actions icon-only with named shortcut tooltips", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onSelect = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectQuickActions, {
          cwd: "C:/project",
          additionalItems: [
            {
              id: "notes",
              label: "Notes",
              ariaLabel: "Open notes panel",
              shortcut: "Ctrl+N",
              icon: "N",
              onSelect,
            },
          ],
        }),
      ),
    );
    expect(host.querySelector("[data-ebg-item]")).toBeNull();
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Open notes panel"]')!;
    expect(button.textContent).toBe("N");
    const hint = await tooltipText(button);
    expect(hint).toContain("Notes");
    expect(hint).toContain("Ctrl");
    expect(hint).toContain("N");
    await act(async () => button.click());
    expect(onSelect).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
