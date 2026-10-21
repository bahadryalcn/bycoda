// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { getLocale } from "../../../shared/i18n";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveShowExcludedFiles } from "../../settings/model/appearance";
import {
  announceDirListings,
  forgetDir,
  listCachedDir,
  notifyDirsChanged,
  refreshDir,
  saveExpanded,
  saveSelected,
  verifiedDirAt,
} from "../model/fileTree";
import type { FsEntry } from "../../../platform/tauri/fs";
import {
  EXPLORER_FILE_POINTER_DRAG_EVENT,
  type ExplorerFilePointerDragDetail,
} from "../../../shared/lib/drag";
import { FileTree, NameRow } from "./FileTree";
import { invoke } from "@tauri-apps/api/core";

const { iconRender, directories, failures, pendingReads, clipboardFiles, copied, dragDrop } =
  vi.hoisted(() => ({
    iconRender: vi.fn(),
    directories: new Map<string, FsEntry[]>(),
    failures: new Map<string, string>(),
    pendingReads: new Map<string, Promise<FsEntry[]>>(),
    clipboardFiles: [] as string[],
    copied: [] as { from: string; destParent: string }[],
    dragDrop: {
      handler: null as null | ((event: { payload: unknown }) => void),
    },
  }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, string>) => {
    if (command === "list_dir") {
      const failure = failures.get(args.path);
      if (failure) throw new Error(failure);
      const pending = pendingReads.get(args.path);
      if (pending) return pending;
      return directories.get(args.path) ?? [];
    }
    if (command === "clipboard_file_paths") return [...clipboardFiles];
    if (command === "create_path") {
      const path = `${args.parent}/${args.name}`;
      directories.set(args.parent, [
        ...(directories.get(args.parent) ?? []),
        { name: args.name, path, isDir: Boolean(args.isDir), ignored: false },
      ]);
      return path;
    }
    if (command === "rename_path") {
      const parent = args.path.slice(0, args.path.lastIndexOf("/"));
      const path = `${parent}/${args.name}`;
      directories.set(
        parent,
        (directories.get(parent) ?? []).map((entry) =>
          entry.path === args.path ? { ...entry, path, name: args.name } : entry,
        ),
      );
      return path;
    }
    if (command === "reveal_path") return;
    if (command === "delete_path") {
      directories.set(
        args.path.slice(0, args.path.lastIndexOf("/")),
        (directories.get(args.path.slice(0, args.path.lastIndexOf("/"))) ?? []).filter(
          (entry) => entry.path !== args.path,
        ),
      );
      return;
    }
    if (command === "move_path") {
      const failure = failures.get(args.from);
      if (failure) throw new Error(failure);
      const parent = args.from.slice(0, args.from.lastIndexOf("/"));
      const entry = directories.get(parent)?.find((value) => value.path === args.from);
      const path = `${args.destParent}/${args.from.split("/").pop()}`;
      if (entry) {
        directories.set(
          parent,
          (directories.get(parent) ?? []).filter((value) => value !== entry),
        );
        directories.set(args.destParent, [
          ...(directories.get(args.destParent) ?? []),
          { ...entry, path },
        ]);
      }
      return path;
    }
    if (command === "copy_path") {
      copied.push({ from: args.from, destParent: args.destParent });
      return `${args.destParent}/${args.from.split("/").pop()}`;
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (fn: (event: { payload: unknown }) => void) => {
      dragDrop.handler = fn;
      return () => {
        dragDrop.handler = null;
      };
    },
  }),
}));

// Count row renders independently of FileTypeIcon's own memoization.
vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => {
    iconRender(name);
    return createElement("span", { "data-icon": name });
  },
}));

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

function file(name: string, ignored = false): FsEntry {
  return { name, path: `${cwd}/${name}`, isDir: false, ignored };
}

function folder(name: string, ignored = false): FsEntry {
  return { name, path: `${cwd}/${name}`, isDir: true, ignored };
}

function pressPaste(el: HTMLElement) {
  return act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "v", metaKey: true, bubbles: true }));
  });
}

function press(el: HTMLElement, init: KeyboardEventInit) {
  return act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

function nativeDrop(paths: string[]) {
  return act(async () => {
    dragDrop.handler!({
      payload: { type: "drop", paths, position: { x: 10, y: 10 } },
    });
  });
}

function render(tick = 0, hidden = false) {
  root.render(createElement("div", { hidden, "data-tick": tick }, createElement(FileTree, props)));
}

function row(name: string): HTMLButtonElement {
  return container.querySelector(`[role="treeitem"][title="${cwd}/${name}"]`)!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/project-${++project}`;
  props = { cwd, onOpenFile: vi.fn() };
  directories.set(cwd, [file("first.ts")]);
  failures.delete(cwd);
  await listCachedDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.removeItem("bycoda.showExcludedFiles");
  vi.clearAllMocks();
  failures.clear();
  pendingReads.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clipboardFiles.length = 0;
  copied.length = 0;
});

describe("NameRow filesystem collision ownership", () => {
  it("submits a case variant to the owner and displays its collision rejection", async () => {
    const onCommit = vi
      .fn()
      .mockRejectedValue(new Error("Owner filesystem: Foo.ts already exists"));
    await act(async () =>
      root.render(
        createElement(NameRow, {
          depth: 0,
          isDir: false,
          initial: "Foo.ts",
          siblings: ["foo.ts"],
          onCommit,
          onCancel: vi.fn(),
        }),
      ),
    );
    const input = container.querySelector<HTMLInputElement>("input")!;
    await press(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Foo.ts");
    expect(container.textContent).toContain("Owner filesystem: Foo.ts already exists");
    expect(input.disabled).toBe(false);
  });

  it("allows a successful case-sensitive owner and keeps exact duplicates blocked locally", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    await act(async () =>
      root.render(
        createElement(NameRow, {
          depth: 0,
          isDir: false,
          initial: "Foo.ts",
          siblings: ["foo.ts"],
          onCommit,
          onCancel,
        }),
      ),
    );
    await press(container.querySelector<HTMLInputElement>("input")!, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        createElement(NameRow, {
          key: "exact",
          depth: 0,
          isDir: false,
          initial: "foo.ts",
          siblings: ["foo.ts"],
          onCommit,
          onCancel,
        }),
      ),
    );
    await press(container.querySelector<HTMLInputElement>("input")!, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("FileTree render isolation", () => {
  it.each(["New File", "New Folder", "Rename"])(
    "commits %s once and retries only the failed listing",
    async (action) => {
      props.onFileMoved = vi.fn();
      await act(async () => render());
      await act(async () => row("first.ts").click());
      await press(row("first.ts"), { key: "ContextMenu" });
      const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
        (button) => button.textContent?.trim().startsWith(action),
      )!;
      await act(async () => item.click());
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label^="Type file name"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "new-entry",
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      vi.mocked(props.onOpenFile).mockClear();
      failures.set(cwd, "listing unavailable");
      await press(input, { key: "Enter" });
      expect(container.querySelector('input[aria-label^="Type file name"]')).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "File change saved. Refresh failed.",
      );
      if (action === "Rename")
        expect(props.onFileMoved).toHaveBeenCalledExactlyOnceWith(
          `${cwd}/first.ts`,
          `${cwd}/new-entry`,
        );
      if (action === "New File")
        expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(`${cwd}/new-entry`, undefined, {
          exact: true,
        });
      const command = action === "Rename" ? "rename_path" : "create_path";
      expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === command)).toHaveLength(1);
      failures.delete(cwd);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
      );
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(row("new-entry")).not.toBeNull();
      expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === command)).toHaveLength(1);
    },
  );
  it("exposes a file manager action for the project folder in the toolbar", async () => {
    await act(async () => render());
    const reveal = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /Finder|File Explorer|File Manager|Containing Folder/i.test(
        button.getAttribute("aria-label") ?? "",
      ),
    )!;
    expect(reveal).toBeTruthy();
    await act(async () => reveal.click());
    expect(invoke).toHaveBeenCalledWith("reveal_path", { path: cwd });
  });

  it("shows an initial read failure separately from an empty directory and retries the root", async () => {
    forgetDir(cwd);
    failures.set(cwd, "host unavailable");

    await act(async () => render());
    expect(container.querySelector('[data-remote-data-state="error"]')).not.toBeNull();
    expect(container.querySelector('[data-remote-data-state="empty"]')).toBeNull();
    expect(row("first.ts")).toBeNull();

    failures.delete(cwd);
    directories.set(cwd, [file("recovered.ts")]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Retry loading files"]')!.click();
      await vi.waitFor(() => expect(row("recovered.ts")).not.toBeNull());
    });
    expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
  });

  it("clears old refresh state on a cached root switch and ignores the late old response", async () => {
    await act(async () => render());
    let finishOldRead!: (entries: FsEntry[]) => void;
    const oldRead = new Promise<FsEntry[]>((resolve) => {
      finishOldRead = resolve;
    });
    pendingReads.set(cwd, oldRead);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
    });
    expect(container.querySelector('[data-remote-data-state="refreshing"]')).not.toBeNull();

    const oldRoot = cwd;
    const nextRoot = `/cached-project-${project}`;
    directories.set(nextRoot, [
      { name: "second.ts", path: `${nextRoot}/second.ts`, isDir: false, ignored: false },
    ]);
    await listCachedDir(nextRoot);
    cwd = nextRoot;
    props = { ...props, cwd };
    await act(async () => render());
    await act(async () => {
      const rootRow = container.querySelector<HTMLButtonElement>(`button[title="${nextRoot}"]`)!;
      if (rootRow.getAttribute("aria-expanded") !== "true") rootRow.click();
    });
    expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-remote-data-state="refreshing"]')).toBeNull();
    expect(row("second.ts")).not.toBeNull();
    expect(container.querySelector('[title^="Last verified"]')?.getAttribute("title")).toBe(
      `Last verified ${new Date(verifiedDirAt(nextRoot)!).toLocaleString(getLocale())}`,
    );

    pendingReads.delete(oldRoot);
    await act(async () => {
      finishOldRead([
        { name: "late-old.ts", path: `${oldRoot}/late-old.ts`, isDir: false, ignored: false },
      ]);
      await oldRead;
    });
    expect(row("second.ts")).not.toBeNull();
    expect(row("late-old.ts")).toBeNull();
    expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
    expect(container.querySelector('[data-remote-data-state="refreshing"]')).toBeNull();
  });

  it("keeps cached root rows visible and stale after refresh failure, then retries the root", async () => {
    await act(async () => render());
    failures.set(cwd, "permission denied");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("permission denied");
    expect(container.querySelector('[data-remote-data-state="stale"]')).not.toBeNull();
    expect(row("first.ts")).not.toBeNull();
    expect(container.textContent).toContain("permission denied");

    failures.delete(cwd);
    directories.set(cwd, [file("fresh.ts")]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
      await vi.waitFor(() => expect(row("fresh.ts")).not.toBeNull());
    });
    expect(row("first.ts")).toBeNull();
  });

  it("marks an automatically refreshed root as verified when its listing changes", async () => {
    await act(async () => render());
    const previousVerification = verifiedDirAt(cwd)!;
    vi.useFakeTimers();
    vi.setSystemTime(previousVerification + 60_000);
    directories.set(cwd, [file("automatically-added.ts")]);
    await act(async () => {
      notifyDirsChanged(cwd, true);
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(row("automatically-added.ts")).not.toBeNull();
    expect(container.querySelector('[data-remote-data-state="ready"]')).not.toBeNull();
    expect(verifiedDirAt(cwd)).toBeGreaterThan(previousVerification);
  });

  it("refreshes cached expanded child listings and keeps them on failure", async () => {
    const childPath = `${cwd}/docs`;
    const childFile = (name: string): FsEntry => ({
      name,
      path: `${childPath}/${name}`,
      isDir: false,
      ignored: false,
    });
    directories.set(cwd, [folder("docs")]);
    directories.set(childPath, [childFile("old.ts")]);
    await refreshDir(cwd);
    await listCachedDir(childPath);
    await act(async () => {
      announceDirListings();
      render();
    });
    await act(async () => row("docs").click());
    expect(row("docs/old.ts")).not.toBeNull();

    // Folders no longer carry their own refresh: the root button re-lists them.
    expect(container.querySelector('[aria-label="Refresh files in docs"]')).toBeNull();
    failures.set(childPath, "child host unavailable");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(row("docs/old.ts")).not.toBeNull();

    failures.delete(childPath);
    directories.set(childPath, [childFile("new.ts")]);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(row("docs/new.ts")).not.toBeNull();
    expect(row("docs/old.ts")).toBeNull();
  });

  it("uses a worktree branch as the explorer root identity", async () => {
    props = { ...props, rootLabel: "mc/update-readme-tests" };

    await act(async () => render());

    const rootButton = container.querySelector<HTMLButtonElement>(`button[title="${cwd}"]`)!;
    expect(rootButton.textContent).toContain("mc/update-readme-tests");
    expect(rootButton.lastElementChild?.className).toContain("uppercase");
    expect(container.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe(
      "mc/update-readme-tests files",
    );
  });

  it.each([false, true])("skips unchanged rows on parent updates (hidden=%s)", async (hidden) => {
    await act(async () => render(0, hidden));
    expect(row("first.ts")).not.toBeNull();
    iconRender.mockClear();

    for (let tick = 1; tick <= 20; tick++) act(() => render(tick, hidden));

    expect(iconRender.mock.calls.length).toBe(0);
  });

  it("still updates Git decorations and uses a changed navigation callback", async () => {
    await act(async () => render());
    const onOpenFile = vi.fn();
    props = {
      ...props,
      onOpenFile,
      gitStatuses: {
        files: new Map([[`${cwd}/first.ts`, "modified"]]),
        dirs: new Map(),
      },
    };
    act(() => render(1));
    expect(row("first.ts").querySelector(".text-warning")).not.toBeNull();
    act(() => row("first.ts").click());
    expect(onOpenFile).toHaveBeenCalledWith(`${cwd}/first.ts`, undefined, {
      exact: true,
    });
  });

  it("still expands folders and refreshes rows after filesystem changes", async () => {
    saveExpanded(cwd, new Set());
    await act(async () => render());
    expect(row("first.ts")).toBeNull();
    const expand = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    await act(async () => expand.click());
    expect(row("first.ts")).not.toBeNull();

    vi.useFakeTimers();
    directories.set(cwd, [file("added.ts")]);
    await act(async () => {
      notifyDirsChanged();
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(row("added.ts")).not.toBeNull();
    expect(row("first.ts")).toBeNull();
  });

  it("reads a collapsed folder again when it reopens", async () => {
    directories.set(cwd, [folder("src")]);
    const nested = (name: string): FsEntry => ({
      name,
      path: `${cwd}/src/${name}`,
      isDir: false,
      ignored: false,
    });
    directories.set(`${cwd}/src`, [nested("old.ts")]);
    await refreshDir(cwd);
    await act(async () => render());
    await act(async () => row("src").click());
    expect(row("src/old.ts")).not.toBeNull();
    await act(async () => row("src").click());
    directories.set(`${cwd}/src`, [nested("new.ts")]);
    await act(async () => row("src").click());
    expect(row("src/new.ts")).not.toBeNull();
    expect(row("src/old.ts")).toBeNull();
  });
});

describe("FileTree excluded files", () => {
  it("hides ignored entries by default and follows the setting", async () => {
    directories.set(cwd, [
      folder("dist", true),
      folder("src"),
      file("first.ts"),
      file("debug.log", true),
    ]);
    await refreshDir(cwd);
    await act(async () => render());

    expect(row("src")).not.toBeNull();
    expect(row("first.ts")).not.toBeNull();
    expect(row("dist")).toBeNull();
    expect(row("debug.log")).toBeNull();

    act(() => saveShowExcludedFiles(true));
    expect(row("dist")).not.toBeNull();
    expect(row("debug.log")).not.toBeNull();

    act(() => saveShowExcludedFiles(false));
    expect(row("dist")).toBeNull();
    expect(row("debug.log")).toBeNull();
    expect(row("first.ts")).not.toBeNull();
  });
});

describe("FileTree accepts files from outside the tree", () => {
  beforeEach(async () => {
    directories.set(cwd, [folder("docs"), file("first.ts")]);
    directories.set(`${cwd}/docs`, []);
    await refreshDir(cwd);
    await listCachedDir(`${cwd}/docs`);
  });

  it("pastes files from the system clipboard into the selected folder", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt", "/Users/me/Desktop/b.txt");
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await pressPaste(row("docs"));
    expect(copied).toEqual([
      { from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` },
      { from: "/Users/me/Desktop/b.txt", destParent: `${cwd}/docs` },
    ]);
  });

  it("pastes into the parent folder when a file is selected", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt");
    saveSelected(cwd, `${cwd}/first.ts`);
    await act(async () => render());
    await pressPaste(row("first.ts"));
    expect(copied).toEqual([{ from: "/Users/me/Desktop/a.txt", destParent: cwd }]);
  });

  it("pastes on a non-Latin layout", async () => {
    clipboardFiles.push("/Users/me/Desktop/a.txt");
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await press(row("docs"), { key: "м", code: "KeyV", metaKey: true });
    expect(copied).toEqual([{ from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` }]);
  });

  it("does nothing on paste when the clipboard holds no files", async () => {
    saveSelected(cwd, `${cwd}/docs`);
    await act(async () => render());
    await pressPaste(row("docs"));
    expect(copied).toEqual([]);
  });

  it("does not read the clipboard when the context menu opens", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await act(async () => render());
    await act(async () => {
      row("docs").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector("[role='menu']")).not.toBeNull();
    expect(vi.mocked(invoke).mock.calls.map((c) => c[0])).not.toContain("clipboard_file_paths");
  });

  it("copies a native file drop into the hovered folder", async () => {
    await act(async () => render());
    expect(dragDrop.handler).not.toBeNull();
    const target = row("docs");
    vi.stubGlobal("devicePixelRatio", 1);
    document.elementFromPoint = () => target;
    await act(async () => {
      dragDrop.handler!({
        payload: { type: "over", position: { x: 10, y: 10 } },
      });
    });
    expect(target.getAttribute("data-tree-drop-target")).toBe("true");
    await nativeDrop(["/Users/me/Desktop/a.txt"]);
    expect(copied).toEqual([{ from: "/Users/me/Desktop/a.txt", destParent: `${cwd}/docs` }]);
    expect(target.className).not.toContain("bg-selection");
  });

  it("ignores a native drop outside the tree", async () => {
    await act(async () => render());
    document.elementFromPoint = () => document.body;
    await nativeDrop(["/Users/me/Desktop/a.txt"]);
    expect(copied).toEqual([]);
  });
});

describe("FileTree copies paths", () => {
  beforeEach(async () => {
    saveSelected(cwd, `${cwd}/first.ts`);
    await navigator.clipboard.writeText("before");
    await act(async () => render());
  });

  it("copies the selected path on Mod+Shift+C", async () => {
    await press(row("first.ts"), { key: "C", metaKey: true, shiftKey: true });
    expect(await navigator.clipboard.readText()).toBe(`${cwd}/first.ts`);
  });

  it("copies the project root path from the root row", async () => {
    const rootRow = container.querySelector<HTMLButtonElement>("[data-explorer-root]");
    if (!rootRow) throw new Error("Root row not rendered");
    await act(async () => rootRow.click());
    await press(rootRow, { key: "C", metaKey: true, shiftKey: true });
    expect(await navigator.clipboard.readText()).toBe(cwd);
  });

  it("copies the selected path on a non-Latin layout", async () => {
    await press(row("first.ts"), {
      key: "С",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
    });
    expect(await navigator.clipboard.readText()).toBe(`${cwd}/first.ts`);
  });

  it("matches the typed Latin letter, not the physical key", async () => {
    // Dvorak types "j" on the physical C key.
    await press(row("first.ts"), {
      key: "J",
      code: "KeyC",
      metaKey: true,
      shiftKey: true,
    });
    expect(await navigator.clipboard.readText()).toBe("before");
  });
});

describe("FileTree starts Explorer file drags", () => {
  beforeEach(async () => {
    directories.set(cwd, [folder("docs"), file("first.ts")]);
    await refreshDir(cwd);
  });

  it("publishes a pointer-driven file drop without opening the file", async () => {
    await act(async () => render());
    const fileRow = row("first.ts");
    const folderRow = row("docs");
    const events: ExplorerFilePointerDragDetail[] = [];
    const onDrag = (event: Event) => {
      events.push((event as CustomEvent<ExplorerFilePointerDragDetail>).detail);
    };
    window.addEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onDrag);

    act(() => {
      fileRow.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          pointerId: 1,
          clientX: 10,
          clientY: 10,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 30,
          clientY: 30,
        }),
      );
    });

    const preview = document.querySelector<HTMLElement>(".explorer-file-drag-preview");
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("aria-hidden")).toBe("true");
    expect(preview?.textContent).toContain("first.ts");
    expect(preview?.children).toHaveLength(2);
    expect(preview?.querySelectorAll('[data-icon="first.ts"]')).toHaveLength(1);
    expect(preview?.style.transform).toBe("translate3d(18px, 17px, 0)");

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 36,
          clientY: 38,
        }),
      );
    });
    expect(preview?.style.transform).toBe("translate3d(24px, 25px, 0)");

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          clientX: 40,
          clientY: 40,
        }),
      );
      fileRow.click();
    });

    expect(document.querySelector(".explorer-file-drag-preview")).toBeNull();
    expect(events.some((event) => event.type === "move")).toBe(true);
    expect(events.slice(-2)).toEqual([
      {
        type: "drop",
        path: `${cwd}/first.ts`,
        x: 40,
        y: 40,
      },
      { type: "end", path: `${cwd}/first.ts` },
    ]);
    expect(props.onOpenFile).not.toHaveBeenCalled();

    events.length = 0;
    act(() => {
      folderRow.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          pointerId: 2,
          clientX: 10,
          clientY: 10,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 2,
          clientX: 40,
          clientY: 40,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 2,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    expect(events).toEqual([]);

    window.removeEventListener(EXPLORER_FILE_POINTER_DRAG_EVENT, onDrag);
  });
});

describe("FileTree keyboard navigation", () => {
  const selected = () =>
    container.querySelector<HTMLButtonElement>('[role="treeitem"][aria-selected="true"]')?.title;

  beforeEach(async () => {
    directories.set(cwd, [folder("src"), file("first.ts"), file("second.ts")]);
    directories.set(`${cwd}/src`, [
      { name: "a.ts", path: `${cwd}/src/a.ts`, isDir: false, ignored: false },
    ]);
    await refreshDir(cwd);
    saveSelected(cwd, `${cwd}/src`);
    await act(async () => render());
  });

  it("moves the selection with the arrow keys and Home/End", async () => {
    await press(row("src"), { key: "ArrowDown" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(row("first.ts"), { key: "End" });
    expect(selected()).toBe(`${cwd}/second.ts`);
    await press(row("second.ts"), { key: "ArrowUp" });
    expect(selected()).toBe(`${cwd}/first.ts`);
    await press(row("first.ts"), { key: "Home" });
    expect(container.querySelector("[data-explorer-root]")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(selected()).toBeUndefined();
  });

  it("expands with Right, enters the folder, and walks back out with Left", async () => {
    await press(row("src"), { key: "ArrowRight" });
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("src/a.ts")).not.toBeNull();
    await press(row("src"), { key: "ArrowRight" });
    expect(selected()).toBe(`${cwd}/src/a.ts`);
    await press(row("src/a.ts"), { key: "ArrowLeft" });
    expect(selected()).toBe(`${cwd}/src`);
    await press(row("src"), { key: "ArrowLeft" });
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens files with Enter and toggles folders", async () => {
    await press(row("src"), { key: "Enter" });
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    await press(row("src"), { key: "End" });
    await press(row("second.ts"), { key: "Enter" });
    expect(props.onOpenFile).toHaveBeenCalledWith(`${cwd}/second.ts`, undefined, { exact: true });
  });

  it("jumps to a row by typing its name", async () => {
    await press(row("src"), { key: "s" });
    expect(selected()).toBe(`${cwd}/second.ts`);
    await press(row("second.ts"), { key: "s" });
    expect(selected()).toBe(`${cwd}/src`);
    await press(row("src"), { key: "f" });
    expect(selected()).toBe(`${cwd}/src`);
  });

  it("narrows the match as more of the name is typed", async () => {
    await press(row("src"), { key: "s" });
    await press(row("second.ts"), { key: "r" });
    expect(selected()).toBe(`${cwd}/src`);
  });
});

describe("FileTree multiple selection", () => {
  async function click(name: string, modifiers: MouseEventInit = {}) {
    await act(async () =>
      row(name).dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers })),
    );
  }
  function selected() {
    return [
      ...container.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected="true"]'),
    ].map((entry) => entry.title.slice(cwd.length + 1));
  }
  async function context(name: string) {
    await act(async () =>
      row(name).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
      ),
    );
  }
  beforeEach(async () => {
    directories.set(cwd, [folder("dest"), file("a.ts"), file("b.ts"), file("c.ts")]);
    directories.set(`${cwd}/dest`, []);
    await refreshDir(cwd);
    props.onFileMoved = vi.fn();
    props.onFileDeleted = vi.fn();
    await act(async () => render());
  });
  it.each(["c", "x"])("prefers a newer OS file copy over an internal %s clipboard", async (key) => {
    await click("a.ts");
    await press(row("a.ts"), { key, ctrlKey: true });
    clipboardFiles.push("/external/new.ts");
    await click("dest");
    await press(row("dest"), { key: "v", ctrlKey: true });
    expect(copied).toEqual([{ from: "/external/new.ts", destParent: `${cwd}/dest` }]);
    expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "move_path")).toHaveLength(0);
    expect(row("a.ts").getAttribute("data-tree-cut")).not.toBe("true");
  });

  it("hides Open for folder-only multiselection", async () => {
    directories.set(cwd, [folder("dest"), folder("docs"), file("a.ts")]);
    directories.set(`${cwd}/docs`, []);
    await act(async () => {
      await refreshDir(cwd);
      announceDirListings();
    });
    await click("dest");
    await click("docs", { ctrlKey: true });
    await context("docs");
    expect(
      [...document.querySelectorAll('[role="menuitem"]')].some(
        (item) => item.textContent?.trim() === "Open",
      ),
    ).toBe(false);
  });
  it("toggles selections without opening files and preserves selection on right click", async () => {
    await click("a.ts");
    vi.mocked(props.onOpenFile).mockClear();
    await click("c.ts", { ctrlKey: true });
    expect(selected()).toEqual(["a.ts", "c.ts"]);
    expect(props.onOpenFile).not.toHaveBeenCalled();
    await context("a.ts");
    expect(selected()).toEqual(["a.ts", "c.ts"]);
    expect(
      document.querySelector<HTMLButtonElement>('[role="menuitem"]:disabled')?.textContent,
    ).toContain("Rename");
    await press(document.querySelector<HTMLElement>('[role="menu"]')!, { key: "Escape" });
    await click("a.ts", { metaKey: true });
    expect(selected()).toEqual(["c.ts"]);
  });
  it("keeps the Shift anchor while expanding and shrinking a range", async () => {
    await click("a.ts");
    await click("c.ts", { shiftKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts", "c.ts"]);
    await click("b.ts", { shiftKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts"]);
    await click("dest", { ctrlKey: true, shiftKey: true });
    expect(selected()).toEqual(["dest", "a.ts", "b.ts"]);
    expect(row("dest").getAttribute("aria-expanded")).toBe("false");
  });
  it("selects keyboard ranges and moves focus separately with Ctrl", async () => {
    await click("a.ts");
    await press(row("a.ts"), { key: "ArrowDown", shiftKey: true });
    await press(row("b.ts"), { key: "ArrowDown", shiftKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts", "c.ts"]);
    await press(row("c.ts"), { key: "ArrowUp", shiftKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts"]);
    await press(row("b.ts"), { key: "ArrowDown", ctrlKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts"]);
    expect(document.activeElement).toBe(row("c.ts"));
    await press(row("c.ts"), { key: " ", ctrlKey: true });
    expect(selected()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
  it("selects to the first file with Shift+Home and opens the menu from the keyboard", async () => {
    await click("c.ts");
    await press(row("c.ts"), { key: "Home", shiftKey: true });
    expect(selected()).toEqual(["dest", "a.ts", "b.ts", "c.ts"]);
    await press(row("dest"), { key: "F10", shiftKey: true });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(selected()).toEqual(["dest", "a.ts", "b.ts", "c.ts"]);
    await press(document.querySelector<HTMLElement>('[role="menu"]')!, { key: "Escape" });
    await context("b.ts");
    expect(selected()).toEqual(["dest", "a.ts", "b.ts", "c.ts"]);
  });
  it("replaces the selection when right clicking an unselected file", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    await context("c.ts");
    expect(selected()).toEqual(["c.ts"]);
    expect(document.querySelector('[role="menuitem"]:disabled')).toBeNull();
  });
  it("selects visible rows with Ctrl+A, copies paths and opens all selected files", async () => {
    await press(row("a.ts"), { key: "a", ctrlKey: true });
    expect(selected()).toEqual(["dest", "a.ts", "b.ts", "c.ts"]);
    expect(container.querySelector('[role="tree"]')?.getAttribute("aria-multiselectable")).toBe(
      "true",
    );
    await context("b.ts");
    const open = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.trim().startsWith("Open"),
    )!;
    await act(async () => open.click());
    expect(props.onOpenFile).toHaveBeenCalledTimes(3);
    await press(row("b.ts"), { key: "C", ctrlKey: true, shiftKey: true });
    expect(await navigator.clipboard.readText()).toBe(
      ["dest", "a.ts", "b.ts", "c.ts"].map((name) => `${cwd}/${name}`).join("\n"),
    );
  });
  it("copies several files into a destination", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    await press(row("b.ts"), { key: "c", ctrlKey: true });
    await click("dest");
    await press(row("dest"), { key: "v", ctrlKey: true });
    expect(copied).toEqual(
      ["a.ts", "b.ts"].map((name) => ({ from: `${cwd}/${name}`, destParent: `${cwd}/dest` })),
    );
  });
  it("deletes the selection with one confirmation and respects cancellation", async () => {
    await click("a.ts");
    await click("c.ts", { ctrlKey: true });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await press(row("c.ts"), { key: "Delete" });
    expect(props.onFileDeleted).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await press(row("c.ts"), { key: "Delete" });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(props.onFileDeleted).toHaveBeenCalledTimes(2);
    expect(row("a.ts")).toBeNull();
    expect(row("c.ts")).toBeNull();
    expect(row("b.ts")).not.toBeNull();
  });
  it("records a completed deletion even if refreshing the folder fails", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    failures.set(cwd, "refresh failed");
    await press(row("b.ts"), { key: "Delete" });
    expect(props.onFileDeleted).toHaveBeenCalledExactlyOnceWith(`${cwd}/a.ts`);
    expect(selected()).toEqual(["b.ts"]);
    expect(container.textContent).toContain("refresh failed");
  });
  it("retries only remaining cut files after a partial move failure", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    await press(row("b.ts"), { key: "x", ctrlKey: true });
    expect(row("a.ts").getAttribute("data-tree-cut")).toBe("true");
    failures.set(`${cwd}/b.ts`, "move failed");
    await click("dest");
    await press(row("dest"), { key: "v", ctrlKey: true });
    expect(props.onFileMoved).toHaveBeenCalledTimes(1);
    failures.delete(`${cwd}/b.ts`);
    await press(row("dest"), { key: "v", ctrlKey: true });
    expect(props.onFileMoved).toHaveBeenCalledTimes(2);
    const moves = vi.mocked(invoke).mock.calls.filter(([command]) => command === "move_path");
    expect(moves.map(([, args]) => (args as { from: string }).from)).toEqual([
      `${cwd}/a.ts`,
      `${cwd}/b.ts`,
      `${cwd}/b.ts`,
    ]);
  });

  it("moves all selected files on a pointer drop into a folder", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => row("dest"),
    });
    try {
      await act(async () => {
        row("a.ts").dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 3,
            clientX: 10,
            clientY: 10,
            bubbles: true,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointermove", { pointerId: 3, clientX: 40, clientY: 40 }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", { pointerId: 3, clientX: 40, clientY: 40 }),
        );
      });
      expect(props.onFileMoved).toHaveBeenCalledTimes(2);
      expect(props.onFileMoved).toHaveBeenCalledWith(`${cwd}/a.ts`, `${cwd}/dest/a.ts`);
      expect(props.onFileMoved).toHaveBeenCalledWith(`${cwd}/b.ts`, `${cwd}/dest/b.ts`);
      expect(selected()).toEqual(["dest/a.ts", "dest/b.ts"]);
      expect(document.querySelector(".explorer-file-drag-preview")).toBeNull();
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
  it("copies with a drag modifier and rejects dropping a folder into itself", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => row("dest"),
    });
    try {
      await act(async () => {
        row("a.ts").dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 4,
            clientX: 10,
            clientY: 10,
            bubbles: true,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", { pointerId: 4, clientX: 40, clientY: 40, ctrlKey: true }),
        );
      });
      expect(copied).toHaveLength(2);
      expect(props.onFileMoved).not.toHaveBeenCalled();
      await click("dest");
      await act(async () => {
        row("dest").dispatchEvent(
          new PointerEvent("pointerdown", {
            button: 0,
            pointerId: 5,
            clientX: 10,
            clientY: 10,
            bubbles: true,
          }),
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", { pointerId: 5, clientX: 40, clientY: 40 }),
        );
      });
      expect(container.textContent).toContain("Cannot move or copy a folder into itself.");
      expect(props.onFileMoved).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
  it("copies a selected folder and its child only once", async () => {
    directories.set(`${cwd}/dest`, [
      { name: "child.ts", path: `${cwd}/dest/child.ts`, isDir: false, ignored: false },
    ]);
    await click("dest");
    await click("dest/child.ts", { ctrlKey: true });
    await press(row("dest/child.ts"), { key: "c", ctrlKey: true });
    const rootRow = container.querySelector<HTMLButtonElement>("[data-explorer-root]")!;
    await act(async () => rootRow.click());
    await press(rootRow, { key: "v", ctrlKey: true });
    expect(copied).toEqual([{ from: `${cwd}/dest`, destParent: cwd }]);
  });
  it("clears old project selections when changing roots", async () => {
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    const next = `${cwd}-next`;
    directories.set(next, [
      { name: "next.ts", path: `${next}/next.ts`, isDir: false, ignored: false },
    ]);
    await listCachedDir(next);
    cwd = next;
    props = { ...props, cwd };
    await act(async () => render());
    expect(selected()).toEqual([]);
    await press(row("next.ts"), { key: "a", ctrlKey: true });
    expect(selected()).toEqual(["next.ts"]);
  });
});
