// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import type * as TauriCore from "@tauri-apps/api/core";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";

const bridge = vi.hoisted(() => ({
  invoke: (_command: string, _args?: Record<string, unknown>): unknown => undefined,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  invoke: async (command: string, args?: Record<string, unknown>) => bridge.invoke(command, args),
}));

const CWD = "/repo";
const PATH = `${CWD}/notes.txt`;

describe("split diff layout in the file editor", () => {
  let root: Root;
  let container: HTMLDivElement;
  let disk: string;
  let base: string;
  let writes: string[];
  let dirty: boolean[];

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Storage();
    storage.setItem("bycoda.diffLayout", "split");
    storage.setItem("bycoda.formatOnSave", "0");
    vi.stubGlobal("localStorage", storage);
    writes = [];
    dirty = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge.invoke = (command, args) => {
      if (command === "read_text_file") return disk;
      if (command === "stat_files") return [];
      if (command === "git_diff_files") {
        return {
          files: [{ relative: "notes.txt", staged: false, unstaged: true }],
        };
      }
      if (command === "git_file_diff") {
        return {
          original: base,
          current: disk,
          binary: false,
          tooLarge: false,
        };
      }
      if (command === "write_text_file") {
        writes.push(args?.content as string);
        disk = args?.content as string;
        return;
      }
      throw new Error(`Unexpected native command: ${command}`);
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: PATH,
          cwd: CWD,
          active: true,
          showDiff: true,
          onDirtyChange: (_path, value) => dirty.push(value),
        }),
      ),
    );
    await act(async () =>
      vi.waitFor(() => expect(container.querySelector(".cm-merge-b")).not.toBeNull()),
    );
  }

  const after = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-merge-b")!)!;
  const before = () =>
    EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-merge-a")!)!;
  const counter = () => container.querySelector('[role="toolbar"] span.font-mono')?.textContent;
  const toggle = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Side-by-side view"]')!;

  it("puts before on the left and after on the right, read-only on the left", async () => {
    base = "one\ntwo\nthree\n";
    disk = "one\nTWO\nthree\n";
    await render();

    expect(before().state.doc.toString()).toBe(base);
    expect(after().state.doc.toString()).toBe(disk);
    expect(before().state.readOnly).toBe(true);
    expect(after().state.readOnly).toBe(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await act(async () => vi.waitFor(() => expect(counter()).toBe("1/1")));
    expect(container.querySelectorAll(".cm-merge-a .cm-changedLine")).toHaveLength(1);
    expect(container.querySelectorAll(".cm-merge-b .cm-changedLine")).toHaveLength(1);
  });

  it("does not mark every line changed when the file is CRLF", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    base = lines.join("\r\n") + "\r\n";
    disk = lines.map((l) => (l === "line 7" ? "edited" : l)).join("\r\n") + "\r\n";
    await render();

    await act(async () => vi.waitFor(() => expect(counter()).toBe("1/1")));
    expect(before().state.doc.lines).toBe(21);
    expect(container.querySelectorAll(".cm-merge-b .cm-changedLine")).toHaveLength(1);
  });

  it("shows an added file against an empty left pane", async () => {
    base = "";
    disk = "first\nsecond\n";
    await render();

    await act(async () => vi.waitFor(() => expect(counter()).toBe("1/1")));
    expect(before().state.doc.toString()).toBe("");
    expect(container.querySelectorAll(".cm-merge-b .cm-changedLine").length).toBeGreaterThan(0);
  });

  it("saves edits made in the right pane with the file's own line endings", async () => {
    base = "one\r\ntwo\r\n";
    disk = "one\r\ntwo\r\n";
    await render();

    await act(async () => {
      const view = after();
      view.dispatch({ changes: { from: 0, insert: "zero\n" } });
    });
    expect(dirty.at(-1)).toBe(true);
    await act(async () => {
      after().contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    });
    await act(async () => vi.waitFor(() => expect(writes).toHaveLength(1)));
    expect(writes[0]).toBe("zero\r\none\r\ntwo\r\n");
  });

  it("opens straight into the pair for the side the Changes panel named", async () => {
    base = "one\n";
    disk = "one\ntwo\n";
    const commands: string[] = [];
    const answer = bridge.invoke;
    let showDiff!: () => void;
    const diffAsked = new Promise<void>((resolve) => (showDiff = resolve));
    bridge.invoke = (command, args) => {
      commands.push(command);
      if (command === "git_file_diff") {
        expect(args?.staged).toBe(false);
        return diffAsked.then(() => answer(command, args));
      }
      return answer(command, args);
    };
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: PATH,
          cwd: CWD,
          active: true,
          showDiff: true,
          changeKind: "unstaged",
          onDirtyChange: (_path, value) => dirty.push(value),
        }),
      ),
    );
    await act(async () => vi.waitFor(() => expect(commands).toContain("git_file_diff")));
    // The opened side is known, so the file list is not asked for first; and
    // there is no plain editor to tear down while the "before" side is on its way.
    expect(commands).not.toContain("git_diff_files");
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(container.textContent).toContain("Opening notes.txt");

    showDiff();
    // Each pass leaves `act`, which is when React draws what arrived in it.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector(".cm-merge-b")).not.toBeNull();
    });
    expect(before().state.doc.toString()).toBe("one\n");
    expect(after().state.doc.toString()).toBe("one\ntwo\n");
  });

  it("keeps unsaved edits and the caret when switching back to inline", async () => {
    base = "one\ntwo\n";
    disk = "one\ntwo\n";
    await render();
    await act(async () => {
      after().dispatch({
        changes: { from: 0, insert: "unsaved\n" },
        selection: { anchor: 3 },
      });
    });
    expect(dirty.at(-1)).toBe(true);

    await act(async () => toggle().click());
    await act(async () =>
      vi.waitFor(() => expect(container.querySelector(".cm-merge-b")).toBeNull()),
    );

    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(container.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(view.state.doc.toString()).toBe("unsaved\none\ntwo\n");
    expect(view.state.selection.main.head).toBe(3);
    expect(dirty.at(-1)).toBe(true);
    expect(localStorage.getItem("bycoda.diffLayout")).toBe("inline");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });
});
