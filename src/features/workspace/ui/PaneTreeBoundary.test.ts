// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPane, LayoutNode } from "../model/layout";
import { PaneTree } from "./PaneTree";
import { newSession } from "../../sessions/model/session";

vi.mock("../../files/ui/FilePane", async () => {
  const { createElement } = await import("react");
  return {
    FilePane: ({ pane }: { pane: EditorPane }) =>
      createElement("div", { "data-file-pane": pane.id }),
  };
});

vi.mock("../../sessions/ui/SessionPane", () => ({
  SessionPane: ({ session }: { session: { id: string } }) => {
    if (session.id === "bad") throw new Error("render failure");
    return createElement("div", { "data-session-pane": session.id });
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const leaf = (id: string): LayoutNode => ({ type: "leaf", id });

function split(dir: "right" | "down", ...children: LayoutNode[]): LayoutNode {
  return {
    type: "split",
    id: `split-${dir}`,
    dir,
    children,
    sizes: children.map(() => 1 / children.length),
  };
}

function render(
  layout: LayoutNode,
  ids: string[],
  overrides: Partial<ComponentProps<typeof PaneTree>> = {},
) {
  const noop = vi.fn();
  const props: ComponentProps<typeof PaneTree> = {
    visible: true,
    layout,
    sessions: [],
    editorPanes: ids.map((id) => ({ id, files: [], activeFileId: "" })),
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: ids[0],
    composerFocused: false,
    recents: [],
    onFocus: noop,
    onClose: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onCloseOtherFiles: noop,
    onReorderFiles: noop,
    onFileDirtyChange: noop,
    onFileErrorCountChange: noop,
    onRatio: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onModelChange: noop,
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: noop,
    onStop: noop,
    onCompactContext: noop,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: noop,
    onResumeQueue: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
    onMovePane: noop,
    onDetachPane: noop,
    onNewTerminal: noop,
    ...overrides,
  };
  act(() => root.render(createElement(PaneTree, props)));
}

describe("pane error boundary", () => {
  it("contains a session render error to its pane and closes that tab", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    render(split("right", leaf("a"), leaf("bad")), ["a"], {
      sessions: [{ ...newSession("claude", "/project"), id: "bad" }],
      onClose,
    });
    expect(container.querySelector('[data-file-pane="a"]')).not.toBeNull();
    expect(container.textContent).toContain("This view could not be displayed");
    const back = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Back to workspace"),
    )!;
    act(() => back.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledWith("bad");
  });
});
