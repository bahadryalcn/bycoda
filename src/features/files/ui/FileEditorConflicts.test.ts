// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import type * as TauriCore from "@tauri-apps/api/core";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import { mergeResolution } from "../../source-control/model/mergeResolution";

const bridge = vi.hoisted(() => ({
  invoke: (_command: string, _args?: Record<string, unknown>): unknown => undefined,
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  invoke: async (command: string, args?: Record<string, unknown>) => bridge.invoke(command, args),
}));

const CWD = "/repo";
const PATH = `${CWD}/notes.txt`;
const CONFLICTED = [
  "top",
  "<<<<<<< HEAD",
  "mine",
  "=======",
  "theirs",
  ">>>>>>> feature",
  "middle",
  "<<<<<<< HEAD",
  "m2",
  "=======",
  "t2",
  ">>>>>>> feature",
  "end",
  "",
].join("\r\n");

describe("merge conflicts and blame in the file editor", () => {
  let root: Root;
  let container: HTMLDivElement;
  let disk: string;
  let unmerged: string[];
  let calls: { command: string; args?: Record<string, unknown> }[];
  let blameResult: unknown;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Storage();
    storage.setItem("bycoda.diffLayout", "split");
    storage.setItem("bycoda.formatOnSave", "0");
    storage.setItem("bycoda.autosave", "0");
    vi.stubGlobal("localStorage", storage);
    calls = [];
    unmerged = ["notes.txt"];
    blameResult = [
      {
        line: 1,
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        author: "Ann",
        timestamp: 1_700_000_000,
        summary: "first",
      },
    ];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge.invoke = (command, args) => {
      calls.push({ command, args });
      if (command === "read_text_file") return disk;
      if (command === "stat_files") return [];
      if (command === "git_diff_files") {
        return {
          files: [{ relative: "notes.txt", staged: false, unstaged: true }],
        };
      }
      if (command === "git_file_diff") {
        return {
          original: "top\nend\n",
          current: disk,
          binary: false,
          tooLarge: false,
        };
      }
      if (command === "write_text_file") {
        disk = args?.content as string;
        return;
      }
      if (command === "git_conflicts") return unmerged;
      if (command === "git_stage_file") {
        unmerged = [];
        return;
      }
      if (command === "git_blame") {
        if (blameResult instanceof Error) throw blameResult;
        return blameResult;
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

  async function render(cwd = CWD, showDiff = true) {
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: PATH,
          cwd,
          active: true,
          showDiff,
          onDirtyChange: () => {},
        }),
      ),
    );
    await act(async () =>
      vi.waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull()),
    );
  }

  const view = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  const conflictStatus = () =>
    container.querySelector('[aria-label="Merge conflicts"] [role="status"]')?.textContent;
  const blameToggle = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Git blame"]')!;
  const buttonByText = (text: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent === text);
  const gutterText = () => container.querySelector(".cm-blameGutter")?.textContent;

  it("shows two read-only marker previews above the editable result", async () => {
    disk = CONFLICTED;
    await render();
    expect(container.querySelector(".cm-merge-b")).toBeNull();
    expect(container.querySelectorAll(".conflict-gutter-choice")).toHaveLength(4);
    expect(conflictStatus()).toBe("Conflict 1 of 2 · 2 unresolved");
    expect(view().state.doc.toString()).not.toContain("<<<<<<<");
    expect(container.querySelector(".conflict-workspace")?.getAttribute("data-layout")).toBe(
      "stacked",
    );
    const source = (side: string) =>
      EditorView.findFromDOM(
        container.querySelector<HTMLElement>(`.conflict-pane-${side} .cm-editor`)!,
      )!;
    expect(source("ours").state.doc.toString()).toBe("top\nmine\nmiddle\nm2\nend\n");
    expect(source("theirs").state.doc.toString()).toBe("top\ntheirs\nmiddle\nt2\nend\n");
    expect(source("ours").state.readOnly).toBe(true);
    expect(container.querySelector(".conflict-pane-ours")?.textContent).toContain("HEAD");
    expect(container.querySelector(".conflict-pane-theirs")?.textContent).toContain("feature");
    expect(container.querySelectorAll(".conflict-source-change").length).toBeGreaterThan(0);
  });

  it("keeps the result, undo history and source versions when switching layouts", async () => {
    disk = CONFLICTED;
    await render();
    const result = view();
    const initial = result.state.doc.toString();
    await act(async () => result.dispatch({ changes: { from: 0, to: 3, insert: "edited" } }));
    for (const label of ["Three column", "Focus result", "Twin source"]) {
      await act(async () => buttonByText(label)!.click());
      expect(view()).toBe(result);
      expect(view().state.doc.toString()).toContain("edited");
      expect(container.querySelector(".conflict-pane-ours .cm-content")?.textContent).toContain(
        "top",
      );
    }
    expect(localStorage.getItem("bycoda.conflictLayout")).toBe("stacked");
    const { undo } = await import("@codemirror/commands");
    await act(async () => {
      undo(result);
    });
    expect(result.state.doc.toString()).toBe(initial);
    expect(
      calls.some((call) => call.command === "write_text_file" || call.command === "git_stage_file"),
    ).toBe(false);
  });

  it("previews diff3 conflicts with an empty side and no final newline", async () => {
    disk = "prefix\n<<<<<<< HEAD\n||||||| base\nold\n=======\nnew\n>>>>>>> topic";
    await render();
    const source = (side: string) =>
      EditorView.findFromDOM(
        container.querySelector<HTMLElement>(`.conflict-pane-${side} .cm-editor`)!,
      )!;
    expect(source("ours").state.doc.toString()).toBe("prefix\n");
    expect(source("theirs").state.doc.toString()).toBe("prefix\nnew");
    expect(
      container.querySelector(".conflict-pane-theirs .conflict-source-change")?.textContent,
    ).toBe("new");
  });

  it("resolves from the source panes, then saves with CRLF before staging", async () => {
    disk = CONFLICTED;
    await render();
    await act(async () => buttonByText("Use current")!.click());
    expect(conflictStatus()).toBe("Conflict 1 of 2 · 1 unresolved");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Next conflict"]')!.click(),
    );
    await act(async () => buttonByText("Use incoming")!.click());
    expect(conflictStatus()).toBe("Conflict 2 of 2 · 0 unresolved");
    expect(view().state.doc.toString()).toBe("top\nmine\nmiddle\nt2\nend\n");

    await act(async () => buttonByText("Save and stage")!.click());
    await act(async () =>
      vi.waitFor(() => expect(calls.some((call) => call.command === "git_stage_file")).toBe(true)),
    );
    expect(disk).toBe("top\r\nmine\r\nmiddle\r\nt2\r\nend\r\n");
    const order = calls.map((call) => call.command);
    expect(order.indexOf("write_text_file")).toBeLessThan(order.indexOf("git_stage_file"));
    expect(calls.find((call) => call.command === "git_stage_file")?.args).toMatchObject({
      cwd: CWD,
      relative: "notes.txt",
    });
  });

  it("shows no conflict UI for an ordinary file", async () => {
    disk = "plain\n";
    await render();
    expect(container.querySelector('[aria-label="Merge conflicts"]')).toBeNull();
  });

  it("does not save a marker-free preview while decisions remain unresolved", async () => {
    disk = CONFLICTED;
    await render();
    await act(async () =>
      view().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Resolve every conflict before saving",
    );
    expect(
      calls.some((call) => call.command === "write_text_file" || call.command === "git_stage_file"),
    ).toBe(false);
    expect(disk).toBe(CONFLICTED);
  });

  it("keeps a manual result pending until it is explicitly confirmed", async () => {
    disk = CONFLICTED;
    await render();
    const region = mergeResolution(view().state).regions[0];
    await act(async () =>
      view().dispatch({ changes: { from: region.from, to: region.to, insert: "custom\n" } }),
    );
    expect(conflictStatus()).toContain("2 unresolved");
    await act(async () => buttonByText("Use edited result")!.click());
    expect(conflictStatus()).toContain("1 unresolved");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Next conflict"]')!.click(),
    );
    await act(async () => buttonByText("Use incoming")!.click());
    await act(async () => buttonByText("Save and stage")!.click());
    expect(disk).toBe("top\r\ncustom\r\nmiddle\r\nt2\r\nend\r\n");
  });

  it("toggles blame, remembering the choice, and fetches for the open file", async () => {
    disk = "one\ntwo\n";
    await render(CWD, false);
    expect(blameToggle().getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".cm-blameGutter")).toBeNull();

    await act(async () => blameToggle().click());
    expect(localStorage.getItem("bycoda.inlineBlame")).toBe("1");
    expect(blameToggle().getAttribute("aria-pressed")).toBe("true");
    await act(async () =>
      vi.waitFor(() =>
        expect(calls.find((call) => call.command === "git_blame")?.args).toEqual({
          cwd: CWD,
          relative: "notes.txt",
        }),
      ),
    );
    await act(async () => vi.waitFor(() => expect(gutterText()).toContain("Ann ·")));

    await act(async () => blameToggle().click());
    expect(container.querySelector(".cm-blameGutter")).toBeNull();
  });

  it("starts with blame on when it was left on", async () => {
    localStorage.setItem("bycoda.inlineBlame", "1");
    disk = "one\ntwo\n";
    await render(CWD, false);
    await act(async () => vi.waitFor(() => expect(gutterText()).toContain("Ann ·")));
  });

  it("reports a blame failure quietly in the editor", async () => {
    localStorage.setItem("bycoda.inlineBlame", "1");
    blameResult = new Error("Could not blame this file");
    disk = "one\n";
    await render(CWD, false);
    // React state set while polling inside act() only lands once act exits,
    // so sleep past the fetch debounce instead of polling.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(calls.some((call) => call.command === "git_blame")).toBe(true);
    expect(container.textContent).toContain("Blame unavailable: Could not blame this file");
  });

  it("disables blame for a remote project until its host is known to support it", async () => {
    disk = "one\n";
    await render("remote://env/repo", false);
    expect(blameToggle().disabled).toBe(true);
    expect(blameToggle().title).toMatch(/machine/);
  });
});
