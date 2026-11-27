// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspacePicker, WorktreeBasePicker } from "./WorkspacePicker";

vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({ branches: undefined, settled: true }),
}));
vi.mock("../../source-control/hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({
    data: {
      worktrees: [
        {
          path: "/work/detached",
          branch: null,
          head: "abcdef123456",
          isMain: false,
          missing: false,
        },
      ],
    },
    error: undefined,
  }),
}));

const previousFor = vi.hoisted(() => vi.fn());
vi.mock("../../workspaces/model/previousWorktree", () => ({
  previousWorktreeFor: previousFor,
  previousWorktreeCandidates: () => [],
}));

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
const close = vi.fn();
const input = () =>
  document.querySelector<HTMLInputElement>('[aria-label="Search base branches"]')!;
function press(key: string, flags: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...flags });
  input().dispatchEvent(event);
  return event;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  change.mockReset();
  close.mockReset();
  previousFor.mockReset();
  previousFor.mockReturnValue(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(WorktreeBasePicker, {
        branches: [
          { name: "main", remote: null },
          { name: "develop", remote: null },
        ],
        selected: "develop",
        loading: false,
        enabled: true,
        initialOpen: true,
        onChange: change,
        onClose: close,
      }),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([{ isComposing: true }, { keyCode: 229 }])(
  "leaves IME keys to composition (%j), then accepts a separate explicit choice",
  async (flags) => {
    expect(input()).not.toBeNull();
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      await act(async () => {
        expect(press(key, flags).defaultPrevented).toBe(false);
      });
      expect(input()).not.toBeNull();
      expect(change).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    }
    await act(async () => {
      input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      press("Enter");
    });
    // The list starts on the current base ("develop").
    expect(change).toHaveBeenCalledExactlyOnceWith("develop");
    expect(close).toHaveBeenCalledTimes(1);
    expect(input()).toBeNull();
  },
);

it("retains ordinary arrow selection", async () => {
  await act(async () => {
    press("ArrowUp");
  });
  await act(async () => {
    press("Enter");
  });
  expect(change).toHaveBeenCalledExactlyOnceWith("main");
});

it("opens controlled chip content without composer mode or base controls", async () => {
  await act(async () =>
    root.render(
      createElement(WorkspacePicker, {
        presentation: "chip",
        label: "Automatic",
        content: createElement("div", null, "Task checkout controls"),
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Workspace Automatic"]',
  )!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.click());
  expect(document.querySelector('[role="dialog"][aria-label="Workspace"]')?.textContent).toContain(
    "Task checkout controls",
  );
  expect(input()).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it("explains why the workspace picker is unavailable when no base is resolved", async () => {
  await act(async () =>
    root.render(
      createElement(WorkspacePicker, {
        cwd: "/work/project",
        mode: "current",
        onModeChange: change,
        onBaseChange: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Workspace Current checkout"]',
  )!;
  expect(trigger.getAttribute("aria-disabled")).toBe("true");
  expect(trigger.disabled).toBe(false);
});

it("dismisses with a non-composition Escape without selecting", async () => {
  await act(async () => {
    press("Escape");
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(change).not.toHaveBeenCalled();
  expect(input()).toBeNull();
});

it("links the actual listbox while Existing worktree is open", async () => {
  await act(async () =>
    root.render(
      createElement(WorkspacePicker, {
        cwd: "/work/project",
        mode: "current",
        base: "main",
        initialPicker: "workspace",
        onModeChange: change,
        onBaseChange: vi.fn(),
        onSelectWorktree: vi.fn(async () => {}),
      }),
    ),
  );

  const trigger = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Existing worktree…",
  )!;
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
  await act(async () => trigger.click());

  const flyoutId = trigger.getAttribute("aria-controls");
  expect(flyoutId).toBeTruthy();
  const flyout = document.getElementById(flyoutId!);
  expect(flyout?.getAttribute("role")).toBe("listbox");
  expect(flyout?.getAttribute("aria-label")).toBe("Existing worktrees");
  expect(flyout?.textContent).toContain("Detached abcdef1");
  expect(flyout?.textContent).not.toContain("abcdef12");
  expect(change).not.toHaveBeenCalled();
});

it("opens Existing worktree on mouse movement without moving focus", async () => {
  await act(async () =>
    root.render(
      createElement(WorkspacePicker, {
        cwd: "/work/project",
        mode: "current",
        base: "main",
        initialPicker: "workspace",
        onModeChange: change,
        onBaseChange: vi.fn(),
        onSelectWorktree: vi.fn(async () => {}),
      }),
    ),
  );
  const row = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Existing worktree…",
  )!;
  expect(row.hasAttribute("aria-controls")).toBe(false);
  const before = document.activeElement;
  await act(async () => {
    row.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
        clientX: 24,
        clientY: 48,
      }),
    );
  });
  expect(row.hasAttribute("aria-controls")).toBe(true);
  expect(document.activeElement).toBe(before);
  expect(change).not.toHaveBeenCalled();
});

const previousTree = {
  path: "/work/project-wt",
  branch: "by/1a2b3c4d",
  head: "abcdef123456",
  isMain: false,
  missing: false,
};
const rowByTitle = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) =>
    row.textContent?.includes(title),
  );

async function renderComposerPicker(previous: boolean, onSelect = vi.fn(async () => {})) {
  await act(async () =>
    root.render(
      createElement(WorkspacePicker, {
        cwd: "/work/project",
        mode: "current",
        base: "main",
        initialPicker: "workspace",
        onModeChange: change,
        onBaseChange: vi.fn(),
        previousWorktree: previous
          ? { project: "/work/project", getSessions: () => [], onSelect }
          : undefined,
      }),
    ),
  );
  return onSelect;
}

it("offers the previous worktree with its branch and binds it through the existing handler", async () => {
  previousFor.mockReturnValue(previousTree);
  const onSelect = await renderComposerPicker(true);
  const row = rowByTitle("Previous worktree")!;
  expect(row.textContent).toContain("by/1a2b3c4d");
  expect(rowByTitle("Existing worktree…")).toBeUndefined();
  await act(async () => row.click());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(previousTree);
  expect(change).not.toHaveBeenCalled();
});

it("hides the previous worktree when there is none or no source", async () => {
  await renderComposerPicker(true);
  expect(rowByTitle("New worktree")).toBeDefined();
  expect(rowByTitle("Previous worktree")).toBeUndefined();
  previousFor.mockReturnValue(previousTree);
  await renderComposerPicker(false);
  expect(rowByTitle("Previous worktree")).toBeUndefined();
});

it("shows the start-from-remote checkbox and the remote chip label", async () => {
  const onRemote = vi.fn();
  const base = {
    branches: [{ name: "main", remote: null }],
    selected: "main",
    loading: false,
    enabled: true,
    initialOpen: true,
    onChange: change,
    onRemoteChange: onRemote,
  };
  await act(async () => root.render(createElement(WorktreeBasePicker, base)));
  const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(box.checked).toBe(false);
  expect(document.body.textContent).toContain("Start from remote");
  await act(async () => box.click());
  expect(onRemote).toHaveBeenCalledExactlyOnceWith(true);
  await act(async () => root.render(createElement(WorktreeBasePicker, { ...base, remote: true })));
  expect(document.body.textContent).toContain("From main (remote)");
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
});

it("has no remote checkbox without a handler", async () => {
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
});
