// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  listCachedDir,
  loadExpanded,
  loadSelected,
  saveExpanded,
  saveSelected,
} from "../model/fileTree";
import type { FsEntry } from "../../../platform/tauri/fs";
import { FileTree } from "./FileTree";
import { reportRemoteLoad, resetRemoteHealth } from "../../connections/model/remoteHealth";

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

const { directories, created, gate } = vi.hoisted(() => ({
  directories: new Map<string, FsEntry[]>(),
  created: [] as { parent: string; name: string; isDir: boolean }[],
  gate: { hold: null as null | Promise<void>, fail: null as null | string },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args: Record<string, string>) => {
    if (command === "list_dir") return directories.get(args.path) ?? [];
    if (command === "clipboard_file_paths") return [];
    if (command === "create_path") {
      created.push({ parent: args.parent, name: args.name, isDir: Boolean(args.isDir) });
      if (gate.hold) await gate.hold;
      if (gate.fail) throw new Error(gate.fail);
      const path = `${args.parent}/${args.name}`;
      directories.set(args.parent, [
        ...(directories.get(args.parent) ?? []),
        { name: args.name, path, isDir: Boolean(args.isDir), ignored: false },
      ]);
      return path;
    }
    throw new Error(`Unexpected command: ${command}`);
  }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("./FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => createElement("span", { "data-icon": name }),
}));

let container: HTMLDivElement;
let root: Root;
let cwd: string;
let props: ComponentProps<typeof FileTree>;
let project = 0;

const entry = (path: string, isDir = false): FsEntry => ({
  name: path.split("/").pop()!,
  path,
  isDir,
  ignored: false,
});
const row = (path: string) =>
  container.querySelector<HTMLButtonElement>(`[role="treeitem"][title="${cwd}/${path}"]`);
const nameInput = () =>
  container.querySelector<HTMLInputElement>('input[aria-label^="Type file name"]');
const header = (action: string) =>
  container.querySelector<HTMLButtonElement>(`[data-explorer-action="${action}"]`)!;
const nameRowDepth = () => {
  const line = container.querySelector<HTMLElement>("[data-name-row] > div")!;
  expect(line.className).toContain("[padding-inline-start:var(--layout-padding-inline-start)]");
  return line.style.getPropertyValue("--layout-padding-inline-start");
};

function contextMenu(el: Element) {
  return act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }),
    );
  });
}
function pick(label: string) {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent?.trim().startsWith(label),
  )!;
  return act(async () => item.click());
}
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      nameInput(),
      value,
    );
    nameInput()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const enter = () =>
  act(async () => {
    nameInput()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

async function mount(selected: string | null, expanded: string[] = []) {
  saveExpanded(cwd, new Set([cwd, ...expanded.map((path) => `${cwd}/${path}`)]));
  saveSelected(cwd, selected ? `${cwd}/${selected}` : null);
  await act(async () => root.render(createElement(FileTree, props)));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  cwd = `/create-${++project}`;
  props = { cwd, rootLabel: "Workspace", onOpenFile: vi.fn() };
  directories.set(cwd, [
    entry(`${cwd}/src`, true),
    entry(`${cwd}/dest`, true),
    entry(`${cwd}/first.ts`),
  ]);
  directories.set(`${cwd}/src`, [entry(`${cwd}/src/nested`, true), entry(`${cwd}/src/deep.ts`)]);
  directories.set(`${cwd}/src/nested`, [entry(`${cwd}/src/nested/leaf.ts`)]);
  directories.set(`${cwd}/dest`, []);
  await listCachedDir(cwd);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  created.length = 0;
  gate.hold = null;
  gate.fail = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("Explorer create target", () => {
  it("creates at the root from the header when nothing is selected, and names it", async () => {
    await mount(null);
    await act(async () => header("new-file").click());
    expect(nameInput()).not.toBeNull();
    expect(container.querySelector("[data-name-caption]")?.textContent).toBe(
      "New file in Workspace",
    );
    type("new.ts");
    await enter();
    expect(created).toEqual([{ parent: cwd, name: "new.ts", isDir: false }]);
  });

  it("creates beside the selected file, at its depth, from the header", async () => {
    await mount("src/deep.ts", ["src"]);
    await act(async () => header("new-file").click());
    expect(container.querySelector("[data-name-caption]")?.textContent).toBe("New file in src");
    // One level in: the row indents like its siblings under src.
    expect(nameRowDepth()).toBe("calc(8px + 1 * 12px)");
    type("beside.ts");
    await enter();
    expect(created).toEqual([{ parent: `${cwd}/src`, name: "beside.ts", isDir: false }]);
  });

  it("creates inside a collapsed selected folder and opens it", async () => {
    await mount("dest");
    expect(row("dest")?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => header("new-folder").click());
    expect(row("dest")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-name-row]")?.getAttribute("data-name-row")).toBe(
      "folder",
    );
    expect(container.querySelector("[data-name-caption]")?.textContent).toBe("New folder in dest");
    type("inner");
    await enter();
    expect(created).toEqual([{ parent: `${cwd}/dest`, name: "inner", isDir: true }]);
  });

  it("context menu on a folder creates inside it even when another row is selected", async () => {
    await mount("first.ts", ["src"]);
    await contextMenu(row("src")!);
    await pick("New File");
    expect(container.querySelector("[data-name-caption]")?.textContent).toBe("New file in src");
    type("in-src.ts");
    await enter();
    expect(created).toEqual([{ parent: `${cwd}/src`, name: "in-src.ts", isDir: false }]);
  });

  it("context menu on a nested file creates in that file's parent", async () => {
    await mount(null, ["src", "src/nested"]);
    await contextMenu(row("src/nested/leaf.ts")!);
    await pick("New Folder");
    expect(container.querySelector("[data-name-caption]")?.textContent).toBe(
      "New folder in nested",
    );
    type("more");
    await enter();
    expect(created).toEqual([{ parent: `${cwd}/src/nested`, name: "more", isDir: true }]);
  });

  it("root header row and the empty area create at the root, not at the selection", async () => {
    await mount("src/deep.ts", ["src"]);
    await contextMenu(container.querySelector("[data-explorer-root]")!);
    const rootItems = [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    );
    expect(rootItems[0]).toContain("New File");
    expect(rootItems[0]).toContain("In Workspace");
    await pick("New File");
    type("r1.ts");
    await enter();
    await contextMenu(container.querySelector('[role="tree"]')!);
    await pick("New Folder");
    type("r2");
    await enter();
    expect(created).toEqual([
      { parent: cwd, name: "r1.ts", isDir: false },
      { parent: cwd, name: "r2", isDir: true },
    ]);
  });

  it("the file context menu names its parent as the target", async () => {
    await mount(null, ["src"]);
    await contextMenu(row("src/deep.ts")!);
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items[0].textContent).toContain("New File");
    expect(items[0].textContent).toContain("In src");
    expect(items[1].textContent).toContain("New Folder");
  });
});

describe("Explorer inline name editor", () => {
  it("shows pending, blocks a second create and further header creates, then clears", async () => {
    let release!: () => void;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount(null);
    await act(async () => header("new-file").click());
    type("slow.ts");
    await enter();
    await enter();
    expect(created).toHaveLength(1);
    expect(nameInput()?.readOnly).toBe(true);
    expect(header("new-file").disabled).toBe(true);
    expect(header("new-file").getAttribute("aria-label")).toContain(
      "Wait for the current file operation to finish",
    );
    await act(async () => {
      release();
    });
    expect(nameInput()).toBeNull();
    expect(header("new-file").disabled).toBe(false);
    expect(created).toHaveLength(1);
  });

  it("keeps the typed name editable with the rejection on its row, and allows one retry", async () => {
    gate.fail = "Permission denied";
    await mount(null);
    await act(async () => header("new-file").click());
    type("blocked.ts");
    await enter();
    expect(nameInput()?.value).toBe("blocked.ts");
    expect(nameInput()?.readOnly).toBe(false);
    const alert = container.querySelector("[data-name-row] [role='alert']");
    expect(alert?.textContent).toBe("Permission denied");
    expect(nameInput()?.getAttribute("aria-describedby")).toContain(alert!.id);
    expect(header("new-file").disabled).toBe(false);
    gate.fail = null;
    await enter();
    expect(created.map((item) => item.name)).toEqual(["blocked.ts", "blocked.ts"]);
    expect(nameInput()).toBeNull();
  });

  it("shows an existing name as a conflict on the row without calling the filesystem", async () => {
    await mount(null);
    await act(async () => header("new-file").click());
    type("first.ts");
    expect(container.querySelector("[data-name-row] [role='alert']")?.textContent).toContain(
      "already exists",
    );
    await enter();
    expect(created).toHaveLength(0);
    expect(nameInput()).not.toBeNull();
  });
});

describe("Explorer Collapse All", () => {
  it("keeps the selection, the open editor and the typed name", async () => {
    await mount("src/nested/leaf.ts", ["src", "src/nested"]);
    await act(async () => header("new-file").click());
    type("draft.ts");
    await act(async () => header("collapse").click());
    // The folder holding the name field stays open so the draft is not lost.
    expect(nameInput()?.value).toBe("draft.ts");
    expect(row("src/nested/leaf.ts")).not.toBeNull();
    expect(loadExpanded(cwd).has(`${cwd}/src/nested`)).toBe(true);
    expect(props.onOpenFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("create_path", expect.anything());
  });

  it("collapses unrelated folders and keeps the selected path persisted", async () => {
    await mount("src/deep.ts", ["src", "dest"]);
    await act(async () => header("collapse").click());
    expect(row("src/deep.ts")).toBeNull();
    expect(row("src")?.getAttribute("aria-expanded")).toBe("false");
    expect(loadSelected(cwd)).toBe(`${cwd}/src/deep.ts`);
    // The hidden selection is announced rather than silently dropped.
    expect(container.querySelector("[data-explorer-selection-scope]")?.textContent).toContain(
      "hidden",
    );
  });
});

describe("Explorer create availability", () => {
  const remoteCwd = () => `remote://machine-1/project-${project}`;
  const mountRemote = async () => {
    const remote = remoteCwd();
    cwd = remote;
    props = { ...props, cwd: remote };
    await act(async () => root.render(createElement(FileTree, props)));
  };
  afterEach(() => resetRemoteHealth());

  it("disables New File and New Folder with the reason while the machine is unreachable", async () => {
    await mountRemote();
    await act(async () => {
      reportRemoteLoad(remoteCwd(), "files", new Error("Machine is unreachable"));
    });
    for (const action of ["new-file", "new-folder"]) {
      expect(header(action).disabled).toBe(true);
      expect(header(action).getAttribute("aria-label")).toContain("This machine is unreachable");
      expect(header(action).getAttribute("title")).toBeNull();
      expect(await tooltipText(header(action))).toContain("This machine is unreachable");
    }
    await act(async () => header("new-file").click());
    expect(nameInput()).toBeNull();
    // The context menu states the same reason instead of a silent dead item.
    await contextMenu(container.querySelector("[data-explorer-root]")!);
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.trim().startsWith("New File"),
    )!;
    expect(item.getAttribute("aria-disabled") === "true" || item.disabled).toBe(true);
    expect(item.textContent).toContain("This machine is unreachable");
  });

  it("names the pairing and host-update reasons separately", async () => {
    await mountRemote();
    await act(async () => {
      reportRemoteLoad(
        remoteCwd(),
        "files",
        new Error("Host identity changed. Add this machine again before continuing."),
      );
    });
    expect(header("new-folder").getAttribute("aria-label")).toContain(
      "Pair this machine again to change files",
    );
    await act(async () => {
      reportRemoteLoad(remoteCwd(), "files", new Error("Unsupported host method"));
    });
    expect(header("new-folder").getAttribute("aria-label")).toContain(
      "Update the host to change files",
    );
  });

  it("keeps creating available for a reachable root", async () => {
    await mount(null);
    expect(header("new-file").disabled).toBe(false);
    expect(header("new-file").getAttribute("aria-label")).not.toContain("(");
  });
});
