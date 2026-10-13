// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionReview } from "./SessionReview";
import { setMarkdownViewMode, useMarkdownMode } from "./MarkdownModeToggle";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  keep: vi.fn(),
  reveal: vi.fn(async () => {}),
  openDefault: vi.fn(async () => {}),
  copy: vi.fn(async () => {}),
  message: vi.fn(async () => {}),
}));
vi.mock("../model/checkpoint", () => ({
  sessionCheckpointStatus: mocks.status,
  subscribeReviewChanged: () => () => {},
  keepSessionChanges: mocks.keep,
  undoSessionChanges: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop(),
  subscribeGitChanged: () => () => {},
  notifyGitChanged: vi.fn(),
  revealPath: mocks.reveal,
  openPathWithDefaultApp: mocks.openDefault,
}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: mocks.copy }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));
vi.mock("../../files/model/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
}));
vi.mock("../../files/model/fileWatch", () => ({
  invalidateWatchedFiles: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
const onOpenDiff = vi.fn();
const onOpenFile = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({
    files: [
      {
        path: "/repo/src/main.ts",
        relative: "src/main.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        exact: false,
        undoable: false,
      },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      createElement(SessionReview, {
        sessionId: "s1",
        cwd: "/repo",
        onOpenDiff,
        onOpenFile,
      }),
    ),
  );
}
it("keeps the review visible and explains a failed Keep operation", async () => {
  mocks.keep.mockRejectedValueOnce(new Error("Checkpoint unavailable"));
  const keep = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Keep",
  )!;
  await act(async () => keep.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Checkpoint unavailable",
  );
  expect(row()).not.toBeNull();
  expect(keep.disabled).toBe(false);
});

it("shows a retryable status failure even when no file list has arrived", async () => {
  mocks.status.mockRejectedValueOnce(new Error("Status unavailable"));
  await act(async () =>
    root.render(createElement(SessionReview, { sessionId: "other", cwd: "/repo", onOpenDiff })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Status unavailable");
  expect(container.textContent).toContain("Retry");
});

it("discards a status response from a previously displayed session", async () => {
  let finish!: (value: { files: unknown[] }) => void;
  mocks.status.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () =>
    root.render(createElement(SessionReview, { sessionId: "slow", cwd: "/repo", onOpenDiff })),
  );
  mocks.status.mockResolvedValueOnce({ files: [] });
  await act(async () =>
    root.render(createElement(SessionReview, { sessionId: "new", cwd: "/repo", onOpenDiff })),
  );
  await act(async () =>
    finish({
      files: [
        {
          path: "/repo/old.ts",
          relative: "old.ts",
          additions: 1,
          deletions: 0,
          undoable: true,
          exact: true,
        },
      ],
    }),
  );
  expect(container.querySelector("[data-session-review]")).toBeNull();
});

function row() {
  return container.querySelector<HTMLButtonElement>("[data-session-review] ul button[title]")!;
}
function openMenu() {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 80,
  });
  act(() => row().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(onOpenDiff).not.toHaveBeenCalled();
  return document.querySelector<HTMLElement>('[role="menu"][aria-label="Changed file actions"]')!;
}
function item(menu: HTMLElement, label: string) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent === label,
  )!;
}
const revealLabel = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

it("replaces the browser menu and reveals mixed, non-undoable changes", async () => {
  const menu = openMenu();
  expect(item(menu, revealLabel).disabled).toBe(false);
  await act(async () => item(menu, revealLabel).click());
  expect(mocks.reveal).toHaveBeenCalledWith("/repo/src/main.ts");
  expect(document.querySelector('[aria-label="Changed file actions"]')).toBeNull();
});
it("opens the selected checkpoint diff with session context", async () => {
  const menu = openMenu();
  await act(async () => item(menu, "View Changes").click());
  expect(onOpenDiff).toHaveBeenCalledWith("/repo/src/main.ts", {
    sessionId: "s1",
    cwd: "/repo",
  });
});
it("opens the actual file in the app", async () => {
  const menu = openMenu();
  const open = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent?.startsWith("Open in "),
  )!;
  await act(async () => open.click());
  expect(onOpenFile).toHaveBeenCalledWith("/repo/src/main.ts");
});
it.each([
  ["Copy Path", "/repo/src/main.ts"],
  ["Copy Relative Path", "src/main.ts"],
])("%s copies the correct path", async (label, path) => {
  const menu = openMenu();
  await act(async () => item(menu, label).click());
  expect(mocks.copy).toHaveBeenCalledWith(path);
});
it("supports Shift+F10 and Escape with focus returning to the row", () => {
  row().focus();
  act(() =>
    row().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  const menu = document.querySelector<HTMLElement>('[aria-label="Changed file actions"]')!;
  expect(menu).not.toBeNull();
  act(() =>
    menu.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector('[aria-label="Changed file actions"]')).toBeNull();
  expect(document.activeElement).toBe(row());
});
it("keeps reveal available for deleted files and targets the parent", async () => {
  await act(async () => {
    root.unmount();
    mocks.status.mockResolvedValue({
      files: [
        {
          path: "/repo/src/main.ts",
          relative: "src/main.ts",
          status: "deleted",
          additions: 0,
          deletions: 1,
          exact: true,
          undoable: true,
        },
      ],
    });
    root = createRoot(container);
  });
  await render();
  const menu = openMenu();
  expect(item(menu, "Open in Default App").disabled).toBe(true);
  expect(item(menu, revealLabel).disabled).toBe(false);
  await act(async () => item(menu, revealLabel).click());
  expect(mocks.reveal).toHaveBeenCalledWith("/repo/src");
});
it("reports native reveal errors", async () => {
  mocks.reveal.mockRejectedValueOnce(new Error("Folder unavailable"));
  const menu = openMenu();
  await act(async () => item(menu, revealLabel).click());
  expect(mocks.message).toHaveBeenCalledWith("Error: Folder unavailable", {
    title: "File action failed",
    kind: "error",
  });
});

it.each(["md", "html", "png", "svg", "pdf"])(
  "previews a %s file instead of opening its diff",
  async (extension) => {
    const path = `/repo/preview.${extension}`;
    act(() => root.unmount());
    mocks.status.mockResolvedValue({
      files: [
        {
          path,
          relative: `preview.${extension}`,
          status: "modified",
          additions: 1,
          deletions: 0,
          exact: true,
          undoable: true,
        },
      ],
    });
    setMarkdownViewMode(path, "source");
    root = createRoot(container);
    await render();
    const probeContainer = document.createElement("div");
    const probeRoot = createRoot(probeContainer);
    let mode: string | undefined;
    function Probe() {
      [mode] = useMarkdownMode(path);
      return null;
    }
    try {
      act(() => probeRoot.render(createElement(Probe)));
      expect(mode).toBe("source");
      const menu = openMenu();
      await act(async () => item(menu, "Preview").click());
      expect(onOpenFile).toHaveBeenCalledWith(path);
      expect(onOpenDiff).not.toHaveBeenCalled();
      expect(mode).toBe("preview");
    } finally {
      act(() => probeRoot.unmount());
    }
  },
);

it("omits Preview for source files without a rendered viewer", () => {
  expect(item(openMenu(), "Preview")).toBeUndefined();
});
