// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// Keep the editor and Git behavior real; replace only native transport.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  invoke: async (command: string, args?: Record<string, unknown>) => bridge.invoke(command, args),
}));

const NAME = "notes.txt";
const BASE = "old first\n" + "context\n".repeat(16) + "old last\n";
const CHANGED = BASE.replace("old first", "new first").replace("old last", "new last");
const crlf = (text: string) => text.replaceAll("\n", "\r\n");
// Every native call here spawns real git, which is slow on Windows.
const waitFor = <T>(check: () => T) => vi.waitFor(check, { timeout: 8_000 });

describe("hunk actions in the split editor layout", { timeout: 20_000 }, () => {
  let directory: string;
  let root: Root;
  let container: HTMLDivElement;
  let gitEnvironment: NodeJS.ProcessEnv;
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      input,
      env: gitEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const write = (content: string) => writeFileSync(join(directory, NAME), content);
  const disk = () => readFileSync(join(directory, NAME), "utf8");
  const index = () => git(["show", `:${NAME}`]);

  function baseline(content: string) {
    git(["init", "-q"]);
    git(["config", "user.name", "Split Test"]);
    git(["config", "user.email", "split@example.invalid"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git(["config", "core.safecrlf", "false"]);
    write(content);
    git(["add", "--", NAME]);
    git(["commit", "-qm", "Initial content"]);
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "bycoda-split-hunks-"));
    gitEnvironment = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(directory, "empty-config"),
    };
    writeFileSync(join(directory, "empty-config"), "");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const storage = new Storage();
    storage.setItem("bycoda.diffLayout", "split");
    storage.setItem("bycoda.formatOnSave", "0");
    storage.setItem("bycoda.autosave", "0");
    vi.stubGlobal("localStorage", storage);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge.invoke = (command, args) => {
      if (command === "read_text_file") return disk();
      if (command === "stat_files") return [];
      if (command === "write_text_file") {
        write(args?.content as string);
        return;
      }
      if (command === "git_diff_files") {
        const status = git(["status", "--porcelain", "--", NAME]);
        return {
          files: status
            ? [
                {
                  relative: NAME,
                  staged: status[0] !== " " && status[0] !== "?",
                  unstaged: status[1] !== " ",
                },
              ]
            : [],
        };
      }
      if (command === "git_file_diff") {
        const staged = !!args?.staged;
        return {
          original: git(["show", `${staged ? "HEAD" : ""}:${NAME}`]),
          current: staged ? index() : disk(),
          binary: false,
          tooLarge: false,
        };
      }
      if (command === "git_stage_contents") {
        const hash = git(
          ["hash-object", "-w", "--path", NAME, "--stdin"],
          args?.contents as string,
        ).trim();
        git(["update-index", "--add", "--cacheinfo", "100644", hash, NAME]);
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
    rmSync(directory, { recursive: true, force: true });
  });

  async function render() {
    const cwd = directory.replaceAll("\\", "/");
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: `${cwd}/${NAME}`,
          cwd,
          active: true,
          showDiff: true,
          onDirtyChange: () => {},
        }),
      ),
    );
    await act(async () =>
      waitFor(() => expect(container.querySelectorAll(".cm-editor.cm-merge-b")).toHaveLength(1)),
    );
    // Both hunks are drawn with a control each once the panes have measured.
    await act(async () =>
      waitFor(() => expect(container.querySelectorAll(".cm-split-hunk")).toHaveLength(2)),
    );
    return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor.cm-merge-b")!)!;
  }
  const control = (chunk: number, action: "revert" | "stage") =>
    container
      .querySelectorAll<HTMLElement>(".cm-split-hunk")
      [chunk]!.querySelector<HTMLElement>(`.cm-split-hunk-${action}`)!;
  async function click(button: HTMLElement) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
  }

  it("stages one hunk of a CRLF working copy, keeping the index LF", async () => {
    baseline(BASE);
    write(crlf(CHANGED));
    await render();
    await click(control(0, "stage"));
    await act(async () =>
      waitFor(() => expect(index()).toBe(BASE.replace("old first", "new first"))),
    );
    expect(disk()).toBe(crlf(CHANGED));
  });

  it("stages one hunk of a CRLF index, keeping the index CRLF", async () => {
    baseline(crlf(BASE));
    write(crlf(CHANGED));
    await render();
    await click(control(1, "stage"));
    await act(async () =>
      waitFor(() => expect(index()).toBe(crlf(BASE.replace("old last", "new last")))),
    );
    expect(disk()).toBe(crlf(CHANGED));
  });

  it("shows the staged hunk as unchanged on the left right away", async () => {
    baseline(BASE);
    write(CHANGED);
    await render();
    await click(control(0, "stage"));
    await act(async () =>
      waitFor(() => expect(container.querySelectorAll(".cm-split-hunk")).toHaveLength(1)),
    );
    expect(index()).toBe(BASE.replace("old first", "new first"));
  });

  it("reverts one hunk in the editor without touching disk or the index", async () => {
    baseline(BASE);
    write(crlf(CHANGED));
    const view = await render();
    await click(control(0, "revert"));
    expect(view.state.doc.toString()).toBe(CHANGED.replace("new first", "old first"));
    expect(disk()).toBe(crlf(CHANGED));
    expect(index()).toBe(BASE);
  });

  it("hides the stage control when the changes cannot be staged", async () => {
    baseline(BASE);
    write(CHANGED);
    git(["add", "--", NAME]);
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: `${directory.replaceAll("\\", "/")}/${NAME}`,
          cwd: directory.replaceAll("\\", "/"),
          active: true,
          showDiff: true,
          onDirtyChange: () => {},
        }),
      ),
    );
    await act(async () =>
      waitFor(() => expect(container.querySelectorAll(".cm-split-hunk")).toHaveLength(2)),
    );
    expect(container.querySelector(".cm-mergeView")?.classList.contains("cm-split-can-stage")).toBe(
      false,
    );
  });
});
