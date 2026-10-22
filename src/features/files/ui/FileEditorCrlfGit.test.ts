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
import { diffNavigablePositions, stageChunkAt } from "../editor/editorGit";
import { FileEditor } from "./FileEditor";

const bridge = vi.hoisted(() => ({
  invoke: (_command: string, _args?: Record<string, unknown>): unknown => undefined,
}));
// Keep the editor and Git behavior real; replace only native transport.
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  invoke: async (command: string, args?: Record<string, unknown>) => bridge.invoke(command, args),
}));

// Every test spawns ~15-20 real `git` processes with execFileSync. Measured on
// this Windows machine, a test takes 0.7-1.5 s, but roughly 1% of ALL process
// spawns (git, hostname.exe, ... - it is not git specific) stall for a fixed
// ~5.05-5.15 s inside the OS before the child starts executing. One stall
// already exceeds vitest's 5 s default, so the budget allows normal runtime
// plus three stalls (1.5 + 3 * 5.2 = ~17 s).
const TEST_TIMEOUT_MS = 20_000;

describe("CRLF editor Git boundaries", () => {
  let directory: string;
  let root: Root;
  let container: HTMLDivElement;
  let gitEnvironment: NodeJS.ProcessEnv;
  // Body of the running test. execFileSync blocks the event loop, so a stalled
  // spawn can make vitest declare a timeout and start teardown while the body
  // is still mid-flight; afterEach waits for it so a slow test can never
  // overlap act() calls, or reuse shared state, with the next test.
  let running: Promise<unknown> | undefined;
  const scenario = (name: string, body: () => Promise<void>) =>
    it(
      name,
      async () => {
        running = body();
        await running;
      },
      TEST_TIMEOUT_MS,
    );
  const filename = "notes.txt";
  const git = (args: string[], input?: string) =>
    execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      input,
      env: gitEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const write = (content: string) => writeFileSync(join(directory, filename), content);
  const disk = () => readFileSync(join(directory, filename), "utf8");
  const index = () => git(["show", `:${filename}`]);
  function baseline(content: string, autocrlf = "false") {
    // Command-scope config via the environment instead of five `git config`
    // spawns: fewer processes means fewer chances to hit an OS spawn stall.
    const config = [
      ["user.name", "CRLF Test"],
      ["user.email", "crlf@example.invalid"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", autocrlf],
      ["core.safecrlf", "false"],
    ];
    gitEnvironment = {
      ...gitEnvironment,
      GIT_CONFIG_COUNT: String(config.length),
    };
    config.forEach(([key, value], i) => {
      gitEnvironment[`GIT_CONFIG_KEY_${i}`] = key;
      gitEnvironment[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    git(["init", "-q"]);
    write(content);
    git(["add", "--", filename]);
    git(["commit", "-qm", "Initial content"]);
  }
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "bycoda-crlf-git-"));
    gitEnvironment = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(directory, "empty-config"),
    };
    writeFileSync(join(directory, "empty-config"), "");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", new Storage());
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    bridge.invoke = (command, args) => {
      if (command === "read_text_file") return disk();
      if (command === "stat_files") return [];
      if (command === "git_diff_files") {
        const status = git(["status", "--porcelain", "--", filename]);
        return {
          files: status
            ? [
                {
                  relative: filename,
                  staged: status[0] !== " " && status[0] !== "?",
                  unstaged: status[1] !== " ",
                },
              ]
            : [],
        };
      }
      if (command === "git_file_diff") {
        const staged = !!args?.staged;
        const exists =
          git(
            staged
              ? ["ls-tree", "--name-only", "HEAD", "--", filename]
              : ["ls-files", "--", filename],
          ).trim() !== "";
        return {
          original: exists ? git(["show", `${staged ? "HEAD:" : ":"}${filename}`]) : "",
          current: staged ? index() : disk(),
          binary: false,
          tooLarge: false,
        };
      }
      if (command === "git_stage_contents") {
        const hash = git(
          ["hash-object", "-w", "--path", filename, "--stdin"],
          args?.contents as string,
        ).trim();
        git(["update-index", "--add", "--cacheinfo", "100644", hash, filename]);
        return;
      }
      throw new Error(`Unexpected native command: ${command}`);
    };
  });
  afterEach(async () => {
    await Promise.race([
      running?.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
    running = undefined;
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  async function render() {
    const cwd = directory.replaceAll("\\", "/");
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: `${cwd}/${filename}`,
          cwd,
          active: true,
          showDiff: true,
          onDirtyChange: () => {},
        }),
      ),
    );
    await act(async () =>
      vi.waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull()),
    );
    return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  }

  scenario("shows staged hunks under autocrlf without rewriting staged siblings", async () => {
    const original = "old first\n" + "context\n".repeat(16) + "old last\n";
    const changed = original.replace("old first", "new first").replace("old last", "new last");
    baseline(original, "true");
    write(changed.replaceAll("\n", "\r\n"));
    git(["add", "--", filename]);
    const view = await render();
    await act(async () => vi.waitFor(() => expect(diffNavigablePositions(view)).toHaveLength(2)));
    expect(view.state.doc.toString()).toBe(changed);
    await act(async () => expect(await stageChunkAt(view, 0)).toBe(false));
    expect(index()).toBe(changed);
    expect(disk()).toBe(changed.replaceAll("\n", "\r\n"));
  });

  scenario("does not confuse a real CRLF-only change with a clean working tree", async () => {
    baseline("old\nline\n");
    write("new\nline\n");
    git(["add", "--", filename]);
    write("new\r\nline\r\n");
    const view = await render();
    await act(async () =>
      vi.waitFor(() => expect(container.querySelector('[role="status"]')).not.toBeNull()),
    );
    expect(diffNavigablePositions(view)).toEqual([]);
    expect(git(["diff", "--name-only", "--", filename]).trim()).toBe(filename);
    expect(index()).toBe("new\nline\n");
  });

  scenario("keeps the index EOL when staging only one CRLF editor hunk", async () => {
    const original = "old first\n" + "context\n".repeat(16) + "old last\n";
    const changed = original.replace("old first", "new first").replace("old last", "new last");
    baseline(original);
    write(changed.replaceAll("\n", "\r\n"));
    const view = await render();
    await act(async () => vi.waitFor(() => expect(diffNavigablePositions(view)).toHaveLength(2)));
    await act(async () => expect(await stageChunkAt(view, 0)).toBe(true));
    expect(index()).toBe(original.replace("old first", "new first"));
    expect(disk()).toBe(changed.replaceAll("\n", "\r\n"));
  });

  scenario("keeps CRLF when staging a file without an index baseline", async () => {
    baseline("");
    git(["rm", "--cached", "--", filename]);
    git(["commit", "-qm", "Remove file from index"]);
    write("first\r\nsecond\r\n");
    const view = await render();
    await act(async () => vi.waitFor(() => expect(diffNavigablePositions(view)).toHaveLength(1)));
    await act(async () => expect(await stageChunkAt(view, 0)).toBe(true));
    expect(index()).toBe("first\r\nsecond\r\n");
    expect(disk()).toBe(index());
  });
});
