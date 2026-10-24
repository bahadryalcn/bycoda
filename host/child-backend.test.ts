import { expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostChildBackend } from "./child-backend";
import { REMOTE_PROVIDERS } from "../src/features/connections/model/protocol";
import type { SocialService } from "./social";

it("discovers Social MCP for a resolved desktop session and numeric child suffix", async () => {
  const backend = new HostChildBackend();
  const sessionIdentity = vi.fn((id: string) => {
    if (id !== "desktop-session") throw new Error("Unknown session");
    return {};
  });
  backend.setSocialAccess({ sessionIdentity } as unknown as SocialService, "http://127.0.0.1:1234");
  expect(
    await backend.invoke("harness_social_bridge", { sessionId: "desktop-session#2" }),
  ).toMatchObject({
    mcpUrl: "http://127.0.0.1:1234/mcp/social",
  });
  expect(sessionIdentity).toHaveBeenCalledWith("desktop-session");
  expect(await backend.invoke("harness_social_bridge", { sessionId: "unknown" })).toBeNull();
});

it("reads bounded task output tails and rejects mismatched task paths", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-output-test-"));
  const tasks = join(directory, "tasks");
  mkdirSync(tasks);
  const path = join(tasks, "b1.output");
  writeFileSync(path, "x".repeat(40000) + "\nlast line\n");
  const backend = new HostChildBackend();
  try {
    const output = await backend.invoke<{ text: string; truncated: boolean }>(
      "harness_read_task_output",
      { path, taskId: "b1" },
    );
    expect(output.truncated).toBe(true);
    expect(Buffer.byteLength(output.text)).toBe(32768);
    expect(output.text.endsWith("last line\n")).toBe(true);
    await expect(
      backend.invoke("harness_read_task_output", { path, taskId: "b2" }),
    ).rejects.toThrow("Invalid task output path");
    await expect(
      backend.invoke("harness_read_task_output", {
        path: join(directory, "b1.output"),
        taskId: "b1",
      }),
    ).rejects.toThrow("Invalid task output path");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("prepares a unique text-only workspace without project files", async () => {
  const backend = new HostChildBackend();
  const profile = "---\nname: bycoda-text\nexcludeDefaultComponents: true\n---\nReturn text.";
  const workspace = await backend.invoke<{ cwd: string; logPath: string }>(
    "harness_prepare_text_workspace",
    { content: profile },
  );
  try {
    expect(workspace.cwd.startsWith(join(tmpdir(), "bycoda-antigravity-text-"))).toBe(true);
    expect(readFileSync(join(workspace.cwd, ".agents", "agents", "bycoda-text.md"), "utf8")).toBe(
      profile,
    );
    expect(workspace.logPath).toBe(join(workspace.cwd, "agent.log"));
    await expect(
      backend.invoke("harness_prepare_text_workspace", { content: "x".repeat(20_001) }),
    ).rejects.toThrow("Invalid text agent");
  } finally {
    rmSync(workspace.cwd, { recursive: true, force: true });
  }
});

it.each([
  [process.platform === "win32" ? "agy.exe" : "agy", "stream-json"],
  ["agy_acp_server.par", "acp"],
])("detects Antigravity transport for %s", async (name, transport) => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-agy-transport-"));
  const binary = join(directory, name);
  writeFileSync(binary, "fixture");
  try {
    const backend = new HostChildBackend({ antigravity: binary });
    expect(await backend.invoke("harness_resolve_antigravity")).toMatchObject({ transport });
    expect(
      await new HostChildBackend().invoke("harness_resolve_configured", {
        provider: "antigravity",
        binaryPath: binary,
      }),
    ).toMatchObject({ path: binary, transport });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("validates configured binaries and reports a missing working directory by name", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-configured-binary-"));
  const wrong = join(directory, "not-codex.exe");
  writeFileSync(wrong, "fixture");
  const backend = new HostChildBackend({ codex: join(directory, "missing-codex") });
  try {
    await expect(backend.invoke("harness_resolve_codex")).rejects.toThrow(
      "Configured codex binary was not found",
    );
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "codex", binaryPath: "codex" }),
    ).rejects.toThrow("must be an absolute path");
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "codex", binaryPath: wrong }),
    ).rejects.toThrow("must be named codex");
    await expect(
      backend.invoke("harness_resolve_configured", { provider: "gemini", binaryPath: wrong }),
    ).rejects.toThrow("Unsupported provider: gemini");
    const missing = join(directory, "gone");
    await expect(
      backend.invoke("harness_spawn", {
        sessionId: "missing-cwd",
        command: process.execPath,
        args: ["-e", ""],
        cwd: missing,
      }),
    ).rejects.toThrow(`Working directory does not exist on this host: ${missing}`);
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["stdout", "stderr"])(
  "bridges large %s output with explicit overflow diagnostics",
  async (stream) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-large-frame-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `
const output = process.${stream};
const frame = JSON.stringify({ id: 2, result: 'a'.repeat(9 * 1024 * 1024) }) + '\\n';
output.write(frame);
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend();
    const lines: string[] = [];
    const exits: Array<{ code: number | null; reason?: string }> = [];
    const unlisten = await backend.listen<{ line: string }>(`harness-${stream}`, ({ payload }) =>
      lines.push(payload.line),
    );
    const unlistenExit = await backend.listen<{
      code: number | null;
      reason?: string;
    }>("harness-exit", ({ payload }) => exits.push(payload));
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "large",
        command: file,
        args: [],
        cwd: process.cwd(),
      });
      if (stream === "stdout") {
        await vi.waitFor(() => expect(lines).toHaveLength(1), {
          timeout: 5000,
        });
        expect(JSON.parse(lines[0]).result.length).toBe(9 * 1024 * 1024);
        expect(exits).toEqual([]);
        await backend.kill("large");
        await vi.waitFor(() => expect(exits).toHaveLength(1), {
          timeout: 5000,
        });
        expect(exits[0].reason).toBeUndefined();
      } else {
        await vi.waitFor(() => expect(exits).toHaveLength(1), {
          timeout: 5000,
        });
        expect(lines).toEqual([]);
        expect(exits[0].reason).toBe(
          "Provider stderr message exceeded the 8 MiB limit; bycoda host stopped the process.",
        );
      }
    } finally {
      unlisten();
      unlistenExit();
      await backend.close();
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  },
);

it("resolves every provider and runs only allowed catalog commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-catalog-test-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log(JSON.stringify(process.argv.slice(2)))");
  const backend = new HostChildBackend(
    Object.fromEntries(REMOTE_PROVIDERS.map((provider) => [provider, file])),
  );
  try {
    for (const provider of REMOTE_PROVIDERS) {
      const resolved = await backend.invoke<{ path: string; args?: string[] }>(
        `harness_resolve_${provider}`,
      );
      expect(resolved.path).toBe(file);
      if (provider === "antigravity")
        expect(resolved.args).toEqual(process.platform === "linux" ? ["--uid="] : []);
    }
    const output = await backend.invoke<string>("harness_exec", {
      command: file,
      args: ["models", "--json"],
      binaryProvider: "fx",
      cwd: directory,
    });
    expect(JSON.parse(output)).toEqual(["models", "--json"]);
    const cleanupArgs = [
      "--no-auto-update",
      "sessions",
      "delete",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    const cleanupOutput = await backend.invoke<string>("harness_exec", {
      command: file,
      args: cleanupArgs,
      binaryProvider: "grok",
      cwd: directory,
    });
    expect(JSON.parse(cleanupOutput)).toEqual(cleanupArgs);
    await expect(
      backend.invoke("harness_exec", {
        command: file,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "fx",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
    for (const args of [
      ["service", "status"],
      ["service", "start"],
      ["service", "get", "password"],
    ]) {
      const serviceOutput = await backend.invoke<string>("harness_exec", {
        command: file,
        args,
        binaryProvider: "opencode",
        cwd: directory,
      });
      expect(JSON.parse(serviceOutput)).toEqual(args);
    }
    for (const [provider, args] of [
      ["fx", ["service", "start"]],
      ["opencode", ["service", "stop"]],
      ["opencode", ["service get", "password"]],
      ["opencode", ["service", "get", "password", "--json"]],
      ["opencode", ["models --json"]],
      ["cursor", cleanupArgs],
      ["grok", ["--no-auto-update", "sessions", "delete", "--all"]],
      ["grok", ["--no-auto-update", "sessions", "delete", "../sessions"]],
      ["grok", [...cleanupArgs, "--all"]],
    ] as const) {
      await expect(
        backend.invoke("harness_exec", {
          command: file,
          args,
          binaryProvider: provider,
        }),
      ).rejects.toThrow("Unsupported headless catalog command");
    }
    writeFileSync(join(directory, "note.txt"), "host-owned transcript");
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "note.txt"),
      }),
    ).toBe("host-owned transcript");
    const transcript = "x".repeat(1024 * 1024 + 1);
    writeFileSync(join(directory, "large-transcript.txt"), transcript);
    expect(
      await backend.invoke("harness_read_text_file", {
        path: join(directory, "large-transcript.txt"),
      }),
    ).toBe(transcript);
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("bridges OpenCode HTTP and event streams on loopback", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"type":"ready"}\n\n');
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No server address");
  const backend = new HostChildBackend();
  const events: string[] = [];
  const unlisten = await backend.listen<{ data: string }>("harness-sse", ({ payload }) =>
    events.push(payload.data),
  );
  try {
    const base = `http://127.0.0.1:${address.port}`;
    expect(await backend.invoke("harness_http", { url: base, method: "GET" })).toEqual({
      status: 200,
      body: '{"ok":true}',
    });
    await backend.invoke("harness_sse_open", {
      sessionId: "fixture",
      url: `${base}/event`,
    });
    await vi.waitFor(() => expect(events).toEqual(['{"type":"ready"}']));
    await backend.invoke("harness_sse_close", { sessionId: "fixture" });
    await expect(
      backend.invoke("harness_http", {
        url: "https://example.com/",
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
  } finally {
    unlisten();
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("runs the resolved Claude version fallback in headless mode", async () => {
  const backend = new HostChildBackend({ claude: process.execPath });
  try {
    const version = await backend.invoke<string>("harness_exec", {
      command: process.execPath,
      args: ["--version"],
      binaryProvider: "claude",
      cwd: process.cwd(),
    });
    expect(version.trim()).toBe(process.version);
    await expect(
      backend.invoke("harness_exec", {
        command: process.execPath,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "claude",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
  } finally {
    await backend.close();
  }
});

it.each([false, true])(
  "stops a provider tree (ignores SIGTERM: %s)",
  async (stubborn) => {
    const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-tree-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(`${stubborn ? "process.on('SIGTERM', () => {});" : ""} console.log('ready'); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => console.log(JSON.stringify({ child: child.pid })));
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend();
    let descendant: number | undefined;
    const stopListening = await backend.listen<{ line: string }>(
      "harness-stdout",
      ({ payload }) => {
        descendant = JSON.parse(payload.line).child;
      },
    );
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "tree",
        command: file,
        args: [],
        cwd: directory,
      });
      await vi.waitFor(() => expect(descendant).toBeTruthy(), { timeout: 5000 });
      await backend.kill("tree");
      await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), {
        timeout: 5000,
      });
    } finally {
      stopListening();
      await backend.close();
      if (descendant) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

it("stops a provider tree when its host pipe closes unexpectedly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-provider-crash-"));
  const treeFile = join(directory, "tree.json");
  const providerFile = join(directory, "provider.cjs");
  writeFileSync(
    providerFile,
    `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(treeFile)}, JSON.stringify({ provider: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`,
  );
  const guard = spawn(
    process.execPath,
    [resolve("build/host/provider-guard.mjs"), process.execPath, providerFile],
    {
      cwd: directory,
      stdio: ["pipe", "ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  let guardClosed = false;
  guard.once("close", () => {
    guardClosed = true;
  });
  let tree: { provider: number; descendant: number } | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(treeFile)).toBe(true), { timeout: 5000 });
    tree = JSON.parse(readFileSync(treeFile, "utf8"));
    guard.stdio[3]?.destroy();
    await vi.waitFor(
      () => {
        expect(() => process.kill(tree!.provider, 0)).toThrow();
        expect(() => process.kill(tree!.descendant, 0)).toThrow();
      },
      { timeout: 5_000 },
    );
    // The guard's cwd keeps this directory locked on Windows until it exits.
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
  } finally {
    guard.stdio[3]?.destroy();
    guard.kill("SIGKILL");
    for (const pid of [tree?.provider, tree?.descendant]) {
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
    }
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}, 10_000);
