// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePaneTab } from "../model/layout";
import { SurfaceTabs, surfaceTabMenuItems } from "./SurfaceTabs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";

const actions = vi.hoisted(() => ({
  copyText: vi.fn(async () => {}),
  openPathWithDefaultApp: vi.fn(async () => {}),
  revealPath: vi.fn(async () => {}),
}));

vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: actions.copyText,
}));

vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  openPathWithDefaultApp: actions.openPathWithDefaultApp,
  revealPath: actions.revealPath,
}));

vi.mock("../../files/ui/FileTypeIcon", () => ({
  FileTypeIcon: ({ name }: { name: string }) => createElement("span", { "data-icon": name }),
}));

let container: HTMLDivElement;
let root: Root;
let props: ComponentProps<typeof SurfaceTabs>;

const files: FilePaneTab[] = [
  { id: "first", path: "/repo/README.md", cwd: "/repo" },
  { id: "second", path: "/repo/src/app.ts", cwd: "/repo" },
];

it("offers remote copy and an actionable local file-manager connection", () => {
  const items = surfaceTabMenuItems({
    id: "remote",
    path: "remote://host/work/app/README.md",
    cwd: "remote://host/work/app",
  });
  const ids = items.flatMap((item) => (item.kind === "item" ? [item.id] : []));
  expect(ids).not.toContain("open-default");
  expect(ids).toContain("reveal");
  expect(ids).toContain("open-copy");
  expect(ids).toEqual(expect.arrayContaining(["copy-path", "copy-relative-path", "close"]));
});

function render() {
  act(() => root.render(createElement(SurfaceTabs, props)));
}

function openSecondMenu() {
  const tab = container.querySelector<HTMLButtonElement>('[role="tab"][title="/repo/src/app.ts"]')!;
  act(() => {
    tab.parentElement!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 80,
      }),
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="File tab actions"]')!;
}

async function pick(label: string) {
  const menu = openSecondMenu();
  const item = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent === label,
  )!;
  await act(async () => item.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  props = {
    files,
    activeFileId: "first",
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onCloseOtherFiles: vi.fn(),
    onReorder: vi.fn(),
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("file tab context menu", () => {
  it("keeps the default cursor on reorderable file tabs", () => {
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.className).toContain("cursor-default");
      expect(tab.className).not.toContain("cursor-grab");
      expect(tab.parentElement?.className).not.toContain("cursor-grab");
    }
  });

  it("selects the right-clicked tab and exposes its file actions", () => {
    const menu = openSecondMenu();
    expect(props.onSelectFile).toHaveBeenCalledWith("second");
    expect(menu.textContent).toContain("Open in Default App");
    expect(menu.textContent).toContain("Copy Path");
    expect(menu.textContent).toContain("Copy Relative Path");
    expect(menu.textContent).toContain("Copy File Name");
    expect(menu.textContent).toContain("Close");
    expect(menu.textContent).toContain("Close Others");
  });

  it("runs path, external-open, reveal, and close actions for the tab", async () => {
    await pick("Copy Path");
    expect(actions.copyText).toHaveBeenLastCalledWith("/repo/src/app.ts");

    await pick("Copy Relative Path");
    expect(actions.copyText).toHaveBeenLastCalledWith("src/app.ts");

    await pick("Copy File Name");
    expect(actions.copyText).toHaveBeenLastCalledWith("app.ts");

    await pick("Open in Default App");
    expect(actions.openPathWithDefaultApp).toHaveBeenCalledWith("/repo/src/app.ts");

    const revealLabel = IS_MAC
      ? "Reveal in Finder"
      : IS_WIN
        ? "Reveal in File Explorer"
        : "Open Containing Folder";
    await pick(revealLabel);
    expect(actions.revealPath).toHaveBeenCalledWith("/repo/src/app.ts");

    await pick("Close");
    expect(props.onCloseFile).toHaveBeenCalledWith("second");

    await pick("Close Others");
    expect(props.onCloseOtherFiles).toHaveBeenCalledWith("second");
  });

  it("shows a file opening error instead of failing silently", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    actions.openPathWithDefaultApp.mockRejectedValueOnce("No application can open this file");

    await pick("Open in Default App");

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "No application can open this file",
    );
  });

  it("disables Close Others when the selected tab is the only tab", () => {
    props = { ...props, files: [files[0]], activeFileId: "first" };
    render();
    const tab = container.querySelector<HTMLButtonElement>(
      '[role="tab"][title="/repo/README.md"]',
    )!;
    act(() => {
      tab.parentElement!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (button) => button.textContent === "Close Others",
    );
    expect(item?.disabled).toBe(true);
  });
});

describe("Open in New Window menu item", () => {
  const ids = (items: ReturnType<typeof surfaceTabMenuItems>) =>
    items.flatMap((item) => (item.kind === "item" ? [item.id] : []));

  it("is offered for files only when a handler exists", () => {
    expect(ids(surfaceTabMenuItems(files[0]))).not.toContain("new-window");
    expect(ids(surfaceTabMenuItems(files[0], true, { dirty: false }))).toContain("new-window");
  });

  it("is disabled while the file has unsaved changes", () => {
    const item = surfaceTabMenuItems(files[0], true, { dirty: true }).find(
      (entry) => entry.kind === "item" && entry.id === "new-window",
    );
    expect(item).toMatchObject({ disabled: true });
  });
});
