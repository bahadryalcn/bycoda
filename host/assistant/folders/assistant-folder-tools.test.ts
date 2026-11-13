import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCommand } from "./assistant-command-process";
import { assistantFolderId } from "./assistant-folders";
import {
  createAssistantFolderTools,
  type FolderPrincipal,
  type FolderToolPorts,
} from "./assistant-folder-tools";

const global: FolderPrincipal = {
  kind: "assistant-thread",
  threadId: "thread-1",
  environmentId: "env-1",
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const yes = async () => true;

describe("Assistant folder tools", () => {
  let base: string;
  let path: string;
  let state: {
    folders: { id: string; path: string }[];
    runWithoutAsking: boolean;
    allowChangesWithoutAsking?: boolean;
  };
  let receipts: Map<string, unknown>;
  let approvals: { action: string; input: Record<string, unknown> }[];
  let decision: boolean;
  const make = (extra: Partial<FolderToolPorts> = {}) =>
    createAssistantFolderTools({
      folders: async () => state,
      receipt: async (key) => receipts.get(key) as never,
      saveReceipt: async (key, value) => void receipts.set(key, value),
      approve: async (operation) => {
        approvals.push({ action: operation.action, input: operation.input });
        return { approved: decision, operationHash: operation.operationHash };
      },
      inlineWaitMs: 5000,
      ...extra,
    });
  const id = () => state.folders[0].id;
  const node = (code: string, extra: Record<string, unknown> = {}) => ({
    root: id(),
    command: process.execPath,
    args: ["-e", code],
    requestId: "run-1",
    ...extra,
  });

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "assistant-tools-"));
    path = await realpath(base);
    await mkdir(join(path, "docs"), { recursive: true });
    await writeFile(join(path, "docs", "a.txt"), "hello world");
    state = { folders: [{ id: assistantFolderId(path), path }], runWithoutAsking: false };
    receipts = new Map();
    approvals = [];
    decision = true;
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  describe("files", () => {
    it("requires a separate explicit full-access grant for file changes and reads revocation live", async () => {
      decision = false;
      state.runWithoutAsking = true;
      const tools = make();
      const input = {
        root: id(),
        path: "docs/a.txt",
        content: "changed",
        expectedHash: sha("hello world"),
        requestId: "write-1",
      };
      await tools.call("files.write", input, global, yes);
      expect(approvals).toHaveLength(1);
      expect(await readFile(join(path, "docs/a.txt"), "utf8")).toBe("hello world");
      state.allowChangesWithoutAsking = true;
      await tools.call("files.write", { ...input, requestId: "write-2" }, global, yes);
      expect(approvals).toHaveLength(1);
      expect(await readFile(join(path, "docs/a.txt"), "utf8")).toBe("changed");
      state.allowChangesWithoutAsking = false;
      await tools.call(
        "files.write",
        { ...input, expectedHash: sha("changed"), content: "blocked", requestId: "write-3" },
        global,
        yes,
      );
      expect(approvals).toHaveLength(2);
      expect(await readFile(join(path, "docs/a.txt"), "utf8")).toBe("changed");
    });
    it("lists the roots and the run setting", async () => {
      const result = (await make().call("files.roots", {}, global, yes)) as {
        roots: { id: string; available: boolean }[];
        runWithoutAsking: boolean;
      };
      expect(result.roots).toEqual([{ id: id(), path, available: true }]);
      expect(result.runWithoutAsking).toBe(false);
    });

    it("reads, lists and searches without approval", async () => {
      const tools = make();
      const read = (await tools.call(
        "files.read",
        { root: id(), path: "docs/a.txt" },
        global,
        yes,
      )) as { text: string; hash: string };
      expect(read.text).toBe("hello world");
      expect(read.hash).toBe(sha("hello world"));
      const list = (await tools.call("files.list", { root: id(), path: "docs" }, global, yes)) as {
        items: { name: string }[];
      };
      expect(list.items.map((item) => item.name)).toContain("a.txt");
      const found = (await tools.call(
        "files.searchContent",
        { root: id(), query: "hello" },
        global,
        yes,
      )) as { items: unknown[] };
      expect(found.items.length).toBeGreaterThan(0);
      expect(approvals).toEqual([]);
    });

    it("keeps credential folders closed inside a folder that holds the home folder", async () => {
      vi.stubEnv("USERPROFILE", path);
      vi.stubEnv("HOME", path);
      try {
        await mkdir(join(path, ".ssh"));
        await writeFile(join(path, ".ssh", "id"), "hello key");
        const tools = make();
        const call = (action: string, input: Record<string, unknown>) =>
          tools.call(action, { root: id(), requestId: "r-1", ...input }, global, yes);
        await expect(call("files.read", { path: ".ssh/id" })).rejects.toThrow(/credential/);
        await expect(call("files.list", { path: ".ssh" })).rejects.toThrow(/credential/);
        await expect(
          call("files.create", { parent: ".", name: ".ssh", isDir: true }),
        ).rejects.toThrow(/credential/);
        const found = (await call("files.searchContent", { query: "hello" })) as {
          items: { path: string }[];
        };
        expect(found.items.some((item) => item.path.startsWith(".ssh"))).toBe(false);
        expect(found.items.length).toBeGreaterThan(0);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects an unknown root, a missing root and path traversal", async () => {
      const tools = make();
      await expect(
        tools.call("files.read", { root: "fdeadbeefdeadbeef", path: "docs/a.txt" }, global, yes),
      ).rejects.toThrow(/Unknown Assistant folder/);
      await expect(tools.call("files.read", { path: "docs/a.txt" }, global, yes)).rejects.toThrow(
        /Unknown Assistant folder/,
      );
      await expect(
        tools.call("files.read", { root: id(), path: "../outside.txt" }, global, yes),
      ).rejects.toThrow(/outside the workspace/);
      await expect(
        tools.call("files.read", { root: id(), path: "docs/../../outside.txt" }, global, yes),
      ).rejects.toThrow(/outside the workspace/);
      await expect(
        tools.call("files.read", { root: id(), path: join(base, "..", "x") }, global, yes),
      ).rejects.toThrow();
    });

    it("does not follow a link out of the folder", async () => {
      const outside = await mkdtemp(join(tmpdir(), "assistant-outside-"));
      try {
        await writeFile(join(outside, "secret.txt"), "secret");
        try {
          await symlink(outside, join(path, "escape"), "junction");
        } catch {
          return; // links unavailable on this machine
        }
        await expect(
          make().call("files.read", { root: id(), path: "escape/secret.txt" }, global, yes),
        ).rejects.toThrow();
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });

    it("requires exact approval for a write and shows the folder it targets", async () => {
      const tools = make();
      const write = {
        root: id(),
        path: "docs/a.txt",
        expectedHash: sha("hello world"),
        content: "changed",
      };
      decision = false;
      const denied = (await tools.call(
        "files.write",
        { ...write, requestId: "w1" },
        global,
        yes,
      )) as {
        state: string;
      };
      expect(denied.state).toBe("failed");
      expect(await readFile(join(path, "docs", "a.txt"), "utf8")).toBe("hello world");
      expect(approvals[0].action).toBe("files.write");
      expect(approvals[0].input).toMatchObject({ root: id(), rootPath: path });

      decision = true;
      const done = (await tools.call(
        "files.write",
        { ...write, requestId: "w2" },
        global,
        yes,
      )) as {
        state: string;
      };
      expect(done.state).toBe("completed");
      expect(await readFile(join(path, "docs", "a.txt"), "utf8")).toBe("changed");
    });

    it("refuses a write without a stable request id and with a stale hash", async () => {
      const tools = make();
      await expect(
        tools.call(
          "files.write",
          { root: id(), path: "docs/a.txt", expectedHash: sha("hello world"), content: "x" },
          global,
          yes,
        ),
      ).rejects.toThrow(/requestId/);
      const stale = (await tools.call(
        "files.write",
        {
          root: id(),
          path: "docs/a.txt",
          expectedHash: sha("other"),
          content: "x",
          requestId: "w3",
        },
        global,
        yes,
      )) as { state: string; error: string };
      expect(stale.state).toBe("uncertain");
      expect(await readFile(join(path, "docs", "a.txt"), "utf8")).toBe("hello world");
    });

    it("renames, copies, moves and deletes inside the folder after approval", async () => {
      const tools = make();
      const hash = sha("hello world");
      const call = (action: string, input: Record<string, unknown>, requestId: string) =>
        tools.call(action, { root: id(), ...input, requestId }, global, yes) as Promise<{
          state: string;
          error?: string;
          result?: { path?: string };
        }>;
      const renamed = await call(
        "files.rename",
        { path: "docs/a.txt", name: "b.txt", expectedHash: hash },
        "r1",
      );
      expect(renamed.error).toBeUndefined();
      expect(await readFile(join(path, "docs", "b.txt"), "utf8")).toBe("hello world");
      await mkdir(join(path, "dest"));
      const copied = await call(
        "files.copy",
        { path: "docs/b.txt", destinationParent: "dest", expectedHash: hash },
        "r2",
      );
      expect(copied.error).toBeUndefined();
      expect(await readFile(join(path, "dest", "b.txt"), "utf8")).toBe("hello world");
      const moved = await call(
        "files.move",
        { path: "docs/b.txt", destinationParent: "docs/..", expectedHash: hash },
        "r3",
      );
      expect(moved.error).toBeUndefined();
      expect(await readFile(join(path, "b.txt"), "utf8")).toBe("hello world");
      const removed = await call("files.delete", { path: "dest/b.txt", expectedHash: hash }, "r4");
      expect(removed.error).toBeUndefined();
      await expect(readFile(join(path, "dest", "b.txt"))).rejects.toThrow();
      expect(approvals.map((entry) => entry.action)).toEqual([
        "files.rename",
        "files.copy",
        "files.move",
        "files.delete",
      ]);
    });

    it("refuses to move outside the folder or to touch the folder root", async () => {
      const tools = make();
      const hash = sha("hello world");
      const moved = (await tools.call(
        "files.move",
        {
          root: id(),
          path: "docs/a.txt",
          destinationParent: "..",
          expectedHash: hash,
          requestId: "m1",
        },
        global,
        yes,
      )) as { state: string };
      expect(moved.state).not.toBe("completed");
      expect(await readFile(join(path, "docs", "a.txt"), "utf8")).toBe("hello world");
      await expect(
        tools.call("files.inspect", { root: id(), path: "." }, global, yes),
      ).rejects.toThrow();
    });

    it("reads a write's receipt by operation id and reports unknown for none", async () => {
      const tools = make();
      const original = {
        root: id(),
        path: "docs/a.txt",
        expectedHash: sha("hello world"),
        content: "z",
      };
      await tools.call("files.write", { ...original, requestId: "w9" }, global, yes);
      const status = (await tools.call(
        "files.operation.status",
        { operationId: "w9", action: "files.write", originalInput: original },
        global,
        yes,
      )) as { state: string };
      expect(status.state).toBe("completed");
      const missing = (await tools.call(
        "files.operation.status",
        { operationId: "nope", action: "files.write", originalInput: original },
        global,
        yes,
      )) as { state: string };
      expect(missing.state).toBe("unknown");
      await expect(
        tools.call(
          "files.operation.status",
          {
            operationId: "w9",
            action: "files.write",
            originalInput: { ...original, content: "q" },
          },
          global,
          yes,
        ),
      ).rejects.toThrow(/identity changed/);
    });

    it("stops when owner authority is revoked", async () => {
      await expect(
        make().call("files.read", { root: id(), path: "docs/a.txt" }, global, async () => false),
      ).rejects.toThrow(/revoked/);
    });
  });

  describe("commands.run", () => {
    it("asks for exact approval and returns the exit code and output", async () => {
      const result = (await make().call(
        "commands.run",
        node('process.stdout.write("hi"); process.stderr.write("warn"); process.exit(2)'),
        global,
        yes,
      )) as Record<string, unknown>;
      expect(approvals).toHaveLength(1);
      expect(approvals[0].action).toBe("commands.run");
      expect(approvals[0].input).toMatchObject({
        root: id(),
        rootPath: path,
        command: process.execPath,
        args: ["-e", expect.any(String)],
        cwd: ".",
        resolvedCwd: path,
        mode: "direct",
        timeoutSeconds: 120,
      });
      expect(result).toMatchObject({
        requestId: "run-1",
        status: "completed",
        exitCode: 2,
        stdout: "hi",
        stderr: "warn",
      });
      expect(typeof result.durationMs).toBe("number");
    });

    it("never runs a denied command", async () => {
      const start = vi.fn(startCommand);
      decision = false;
      const result = (await make({ start }).call(
        "commands.run",
        node("process.exit(0)"),
        global,
        yes,
      )) as { state: string; error: string };
      expect(result).toMatchObject({ state: "failed", error: "Native owner approval required." });
      expect(start).not.toHaveBeenCalled();
    });

    it("skips approval only when the owner enabled running without asking", async () => {
      state.runWithoutAsking = true;
      const tools = make();
      const result = (await tools.call(
        "commands.run",
        node("process.stdout.write('ok')"),
        global,
        yes,
      )) as { status: string; stdout: string };
      expect(result).toMatchObject({ status: "completed", stdout: "ok" });
      expect(approvals).toEqual([]);
      // The setting is read live: turning it off asks again.
      state.runWithoutAsking = false;
      await tools.call("commands.run", node("0", { requestId: "run-2" }), global, yes);
      expect(approvals).toHaveLength(1);
    });

    it("reports the deadline and keeps the exit code empty", async () => {
      const result = (await make().call(
        "commands.run",
        node("setInterval(() => {}, 1000)", { timeoutSeconds: 1 }),
        global,
        yes,
      )) as { status: string; exitCode: number | null };
      expect(result).toMatchObject({ status: "timed-out", exitCode: null });
    });

    it("answers running after the inline wait, then status and cancel settle it", async () => {
      const tools = make({ inlineWaitMs: 150 });
      const first = (await tools.call(
        "commands.run",
        node("setInterval(() => {}, 1000)"),
        global,
        yes,
      )) as { status: string };
      expect(first.status).toBe("running");
      const running = (await tools.call(
        "commands.run.status",
        { requestId: "run-1" },
        global,
        yes,
      )) as { status: string };
      expect(running.status).toBe("running");
      const cancelled = (await tools.call(
        "commands.run.cancel",
        { requestId: "run-1" },
        global,
        yes,
      )) as { status: string; cancelRequested: boolean };
      expect(cancelled).toMatchObject({ status: "cancelled", cancelRequested: true });
    });

    it("reuses a request id for identical input without a second process and rejects changes", async () => {
      const start = vi.fn(startCommand);
      const tools = make({ start, inlineWaitMs: 150 });
      const input = node("setInterval(() => {}, 1000)");
      await tools.call("commands.run", input, global, yes);
      const again = (await tools.call("commands.run", input, global, yes)) as { status: string };
      expect(again.status).toBe("running");
      expect(start).toHaveBeenCalledTimes(1);
      expect(approvals).toHaveLength(1);
      await expect(
        tools.call("commands.run", { ...input, args: ["-e", "1"] }, global, yes),
      ).rejects.toThrow(/different input/);
      await tools.call("commands.run.cancel", { requestId: "run-1" }, global, yes);
    });

    it("never replays an uncertain run after a restart", async () => {
      const first = make({ inlineWaitMs: 150 });
      await first.call("commands.run", node("setInterval(() => {}, 1000)"), global, yes);
      await first.call("commands.run.cancel", { requestId: "run-1" }, global, yes);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // A new Host process: no ledger, only the durable receipt. Make it look unfinished.
      const key = [...receipts.keys()][0];
      receipts.set(key, {
        ...(receipts.get(key) as object),
        state: "completed",
        result: { status: "running", exitCode: null, durationMs: 150 },
      });
      const start = vi.fn(startCommand);
      const restarted = make({ start });
      const status = (await restarted.call(
        "commands.run.status",
        { requestId: "run-1" },
        global,
        yes,
      )) as { status: string; outcomeUnknown: boolean };
      expect(status).toMatchObject({ status: "unknown", outcomeUnknown: true });
      const retried = (await restarted.call(
        "commands.run",
        node("setInterval(() => {}, 1000)"),
        global,
        yes,
      )) as { status: string; outcomeUnknown: boolean };
      expect(retried).toMatchObject({ status: "unknown", outcomeUnknown: true });
      expect(start).not.toHaveBeenCalled();
    });

    it("keeps the working directory inside the folder", async () => {
      const tools = make();
      for (const cwd of ["..", "docs/../..", join(base, "..")])
        await expect(
          tools.call("commands.run", node("0", { cwd, requestId: `c-${cwd.length}` }), global, yes),
        ).rejects.toThrow();
      const inside = (await tools.call(
        "commands.run",
        node("process.stdout.write(require('node:path').basename(process.cwd()))", {
          cwd: "docs",
          requestId: "c-ok",
        }),
        global,
        yes,
      )) as { stdout: string };
      expect(inside.stdout).toBe("docs");
    });

    it("runs a command line through the shell only when no args are given", async () => {
      const result = (await make().call(
        "commands.run",
        {
          root: id(),
          command: "echo line",
          requestId: "shell-1",
        },
        global,
        yes,
      )) as { stdout: string };
      expect(result.stdout).toContain("line");
      expect(approvals[0].input).toMatchObject({ mode: "shell" });
      expect(approvals[0].input).not.toHaveProperty("args");
    });

    it("runs in the project working copy for a project Room and refuses a folder root", async () => {
      const project: FolderPrincipal = {
        kind: "assistant-thread",
        threadId: "t",
        projectId: "p",
        provider: "assistant",
        projectCwd: path,
      };
      const tools = make();
      const ran = (await tools.call(
        "commands.run",
        { command: process.execPath, args: ["-e", "process.stdout.write('p')"], requestId: "p1" },
        project,
        yes,
      )) as { stdout: string };
      expect(ran.stdout).toBe("p");
      expect(approvals[0].input).toMatchObject({ projectPath: path });
      await expect(
        tools.call(
          "commands.run",
          { root: id(), command: process.execPath, args: [], requestId: "p2" },
          project,
          yes,
        ),
      ).rejects.toThrow(/only available in the global Room/);
      await expect(tools.call("files.roots", {}, project, yes)).rejects.toThrow(/global Room/);
      await expect(
        tools.call("files.read", { root: id(), path: "docs/a.txt" }, project, yes),
      ).rejects.toThrow();
    });

    it("holds a project target through the caller's scope at least once", async () => {
      const project: FolderPrincipal = {
        kind: "assistant-thread",
        threadId: "t",
        projectId: "p",
        provider: "assistant",
        projectCwd: path,
      };
      const qualify = vi.fn(<T>(effect: () => Promise<T>) => effect());
      await make().call(
        "commands.run.status",
        { requestId: "nothing" },
        project,
        yes,
        qualify as never,
      );
      expect(qualify).toHaveBeenCalled();
    });

    it("stops a running command when authority is revoked", async () => {
      let allowed = true;
      const tools = make({ inlineWaitMs: 1000 });
      const pending = tools.call(
        "commands.run",
        node("setInterval(() => {}, 1000)", { timeoutSeconds: 30 }),
        global,
        async () => allowed,
      );
      setTimeout(() => (allowed = false), 300);
      const result = (await pending) as { state: string };
      expect(result.state).toBe("uncertain");
    });
  });
});
