// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderPicker } from "./FolderPicker";
import { openFolderPicker } from "./openFolderPicker";

const fs = vi.hoisted(() => ({
  homeDir: vi.fn(),
  listDir: vi.fn(),
  statFiles: vi.fn(),
  createPath: vi.fn(),
  openPathWithDefaultApp: vi.fn(),
  pickNativeFolders: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => fs);
// These scenarios use Windows drives and paths on every CI runner.
vi.mock("../../../platform/tauri/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/platform")>()),
  IS_MAC: false,
  IS_WIN: true,
  IS_LINUX: false,
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) =>
    createElement(
      "div",
      null,
      createElement("button", { onClick: onClose, "aria-label": "Close" }, "Close"),
      children,
    ),
}));

let container: HTMLDivElement;
let root: Root;
const onPick = vi.fn();
const onClose = vi.fn();
const folders = [
  {
    name: "Projects",
    path: "C:/Users/me/Projects",
    isDir: true,
    ignored: false,
  },
  { name: "Notes", path: "C:/Users/me/Notes", isDir: true, ignored: true },
  {
    name: "file.txt",
    path: "C:/Users/me/file.txt",
    isDir: false,
    ignored: false,
  },
];

it("Windows disklerini doğrudan gösterir ve seçilen diske gider", async () => {
  await act(async () =>
    root.render(createElement(FolderPicker, { title: "Open", multiple: false, onPick, onClose })),
  );
  const drive = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "G:/",
  )!;
  expect(drive).toBeTruthy();
  await act(async () => drive.click());
  expect(fs.listDir).toHaveBeenCalledWith("G:/");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  fs.homeDir.mockResolvedValue("C:/Users/me");
  fs.statFiles.mockResolvedValue([
    { path: "C:/", isDir: true },
    { path: "G:/", isDir: true },
  ]);
  fs.listDir.mockImplementation(async (path) => (path === "C:/Users/me" ? folders : []));
  fs.createPath.mockResolvedValue("C:/Users/me/New project");
  fs.openPathWithDefaultApp.mockResolvedValue(undefined);
  fs.pickNativeFolders.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function render(multiple = false) {
  await act(async () => {
    root.render(
      createElement(FolderPicker, {
        title: "Open projects",
        multiple,
        onPick,
        onClose,
      }),
    );
  });
}
function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  )!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function key(key: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    container
      .querySelector('[role="listbox"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...extra })),
  );
}
function type(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("project folder browser", () => {
  it("filters growing folder lists without losing selected paths and opens the filtered keyboard target", async () => {
    await render(true);
    const selected = container.querySelector<HTMLInputElement>('[aria-label="Select Projects"]')!;
    await act(async () => selected.click());
    type("Search folders", "note");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(container.querySelector('[role="option"]')?.textContent).toContain("Notes");
    await key("Enter");
    expect(fs.listDir).toHaveBeenLastCalledWith("C:/Users/me/Notes");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Search folders"]')?.value).toBe(
      "",
    );
    await click("Add (1)");
    expect(onPick).toHaveBeenCalledWith(["C:/Users/me/Projects"]);
  });
  it("lists folders including ignored ones, navigates with keys and adds the current directory", async () => {
    await render();
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(container.textContent).not.toContain("file.txt");
    await key("Enter");
    expect(fs.listDir).toHaveBeenLastCalledWith("C:/Users/me/Projects");
    await key("Backspace");
    expect(fs.listDir).toHaveBeenLastCalledWith("C:/Users/me");
    await key("Enter", { ctrlKey: true });
    expect(onPick).toHaveBeenCalledWith(["C:/Users/me"]);
    expect(container.textContent).not.toContain("Navigate");
  });

  it("opens the current folder itself in the file manager", async () => {
    await render();
    const reveal = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.startsWith("Open in"),
    )!;
    await act(async () => reveal.click());
    expect(fs.openPathWithDefaultApp).toHaveBeenCalledWith("C:/Users/me");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("creates a named folder, enters it and allows adding it", async () => {
    await render();
    await click("New folder");
    type("New folder name", "New project");
    await act(async () =>
      container
        .querySelector('[aria-label="New folder name"]')!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(fs.createPath).toHaveBeenCalledWith("C:/Users/me", "New project", true);
    await click("Add");
    expect(onPick).toHaveBeenCalledWith(["C:/Users/me/New project"]);
  });

  it("preserves multiple selected folders across navigation", async () => {
    await render(true);
    await key(" ");
    await key("ArrowDown");
    await key(" ");
    await key("Enter");
    await click("Add (2)");
    expect(onPick).toHaveBeenCalledWith(["C:/Users/me/Projects", "C:/Users/me/Notes"]);
  });

  it("prevents adding a directory whose listing failed and supports recovery", async () => {
    fs.listDir.mockRejectedValueOnce(new Error("Access denied"));
    await render();
    expect(button("Add").disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Access denied");
    await click("Retry");
    expect(button("Add").disabled).toBe(false);
  });

  it("reports creation errors and rejects nested folder names", async () => {
    await render();
    await click("New folder");
    type("New folder name", "../escape");
    await act(async () =>
      container
        .querySelector('[aria-label="New folder name"]')!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(fs.createPath).not.toHaveBeenCalled();
    type("New folder name", "Existing");
    fs.createPath.mockRejectedValueOnce(new Error("Already exists"));
    await act(async () =>
      container
        .querySelector('[aria-label="New folder name"]')!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Already exists");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the system picker available for drives and network folders", async () => {
    fs.pickNativeFolders.mockResolvedValueOnce(["D:/Work"]);
    await render(true);
    await click("Browse…");
    expect(fs.pickNativeFolders).toHaveBeenCalledWith("Open projects", true);
    expect(onPick).toHaveBeenCalledWith(["D:/Work"]);
  });

  it("ignores a stale directory response after navigating elsewhere", async () => {
    let resolveOld!: (items: typeof folders) => void;
    fs.listDir.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    type("Folder path", "D:/Work");
    await act(async () =>
      container
        .querySelector('[aria-label="Folder path"]')!
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await act(async () => resolveOld(folders));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    await click("Add");
    expect(onPick).toHaveBeenCalledWith(["D:/Work"]);
  });

  it("cleans up an imperative picker and resolves cancellation", async () => {
    let result!: Promise<string[]>;
    const before = document.body.children.length;
    await act(async () => {
      result = openFolderPicker({ title: "Add folders", multiple: true });
    });
    const closeButtons = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Close"]')];
    const close = closeButtons[closeButtons.length - 1]!;
    await act(async () => close.click());
    expect(await result).toEqual([]);
    expect(document.body.children.length).toBe(before);
  });
});
