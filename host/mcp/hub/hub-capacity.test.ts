import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpHub } from "./hub";
import type { InventoryDefinition } from "./inventory";

// Mock-only: every child is the local fake stdio server; no real MCP server or network is used.
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url));
const dirs: string[] = [];
const hubs: McpHub[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-capacity-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.shutdown();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const definition = (
  name: string,
  dir: string,
  env: Record<string, string> = {},
): InventoryDefinition => ({
  name,
  source: "claude",
  sources: ["claude"],
  aliases: [{ provider: "claude", name }],
  kind: "stdio",
  command: process.execPath,
  args: [FIXTURE],
  env: { FAKE_MCP_START_LOG: join(dir, `${name}.starts`), ...env },
});

const pids = (dir: string, name: string): number[] => {
  const file = join(dir, `${name}.starts`);
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(Number) : [];
};

const tool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name, arguments: args },
});

const hubWith = (
  dir: string,
  defs: InventoryDefinition[],
  extra: Partial<ConstructorParameters<typeof McpHub>[0]> = {},
) => {
  const hub = new McpHub({
    dataDir: dir,
    inventory: async () => defs,
    files: {
      claudeConfig: join(dir, "no.json"),
      pluginsDir: join(dir, "no-plugins"),
      codexConfig: join(dir, "config.toml"),
    },
    accountDirs: async () => ({ claude: [], codex: [] }),
    policy: async () => ({ version: 1, mode: "always", direct: [] }),
    stopGraceMs: 50,
    ...extra,
  });
  hubs.push(hub);
  return hub;
};

const until = async (check: () => boolean | Promise<boolean>, ms = 5_000) => {
  const stop = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > stop) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("MCP hub capacity", () => {
  it("queues a start behind a busy child and keeps the busy call running", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir), definition("fake-b", dir)], {
      maxChildren: 1,
    });
    const busy = hub.serve("fake-a", "s1", tool("slow", { ms: 400 }));
    await until(async () => ((await hub.status()).children[0]?.pending ?? 0) >= 1);

    const queued = await hub.serve("fake-b", "s2", tool("echo", { text: "b" }));

    // The busy call finished with its own result instead of being evicted for the newcomer.
    expect((await busy)?.result.content[0].text).toMatch(/^slow:\d+$/);
    expect(queued?.result.content[0].text).toMatch(/^b:\d+$/);
    expect(pids(dir, "fake-a")).toHaveLength(1);
    expect(pids(dir, "fake-b")).toHaveLength(1);
    expect((await hub.status()).running).toBe(1);
  });

  it("fails after the bounded wait and leaves the active call untouched", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir), definition("fake-b", dir)], {
      maxChildren: 1,
      capacityWaitMs: 150,
    });
    const busy = hub.serve("fake-a", "s1", tool("hold"));
    await until(async () => ((await hub.status()).children[0]?.pending ?? 0) >= 1);

    const began = Date.now();
    const refused = await hub.serve("fake-b", "s2", tool("echo", { text: "b" }));

    expect(refused?.error?.message).toContain("at capacity");
    expect(Date.now() - began).toBeLessThan(2_000);
    expect(pids(dir, "fake-b")).toHaveLength(0);
    const status = await hub.status();
    expect(status.children.map((child) => child.name)).toEqual(["fake-a"]);
    expect(status.children[0].pending).toBeGreaterThanOrEqual(1);
    expect(alive(pids(dir, "fake-a")[0])).toBe(true);
    hub.shutdown();
    expect((await busy)?.error?.message).toContain("stopped");
  });

  it("stops waiting when the caller cancels and never spawns for it afterwards", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir), definition("fake-b", dir)], {
      maxChildren: 1,
      capacityWaitMs: 5_000,
    });
    const busy = hub.serve("fake-a", "s1", tool("slow", { ms: 300 }));
    await until(async () => ((await hub.status()).children[0]?.pending ?? 0) >= 1);

    const cancel = new AbortController();
    const waiting = hub.serve(
      "fake-b",
      "s2",
      tool("echo", { text: "b" }),
      undefined,
      cancel.signal,
    );
    setTimeout(() => cancel.abort(), 50);

    const began = Date.now();
    const reply = await waiting;
    expect(reply?.error?.code).toBe(-32800);
    expect(Date.now() - began).toBeLessThan(250);

    // Once the slot frees, nothing is started for the cancelled caller.
    expect((await busy)?.result.content[0].text).toMatch(/^slow:/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pids(dir, "fake-b")).toHaveLength(0);
  });

  it("keeps the shared slot wait while one of two joined callers is still waiting", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir), definition("fake-b", dir)], {
      maxChildren: 1,
      capacityWaitMs: 5_000,
    });
    const busy = hub.serve("fake-a", "s1", tool("slow", { ms: 300 }));
    await until(async () => ((await hub.status()).children[0]?.pending ?? 0) >= 1);

    // Same (name, scope): both calls join one start attempt for fake-b.
    const cancel = new AbortController();
    const first = hub.serve("fake-b", "s2", tool("echo", { text: "1" }), undefined, cancel.signal);
    const second = hub.serve("fake-b", "s2", tool("echo", { text: "2" }));
    setTimeout(() => cancel.abort(), 50);

    expect((await first)?.error?.code).toBe(-32800);
    expect((await second)?.result.content[0].text).toMatch(/^2:\d+$/);
    await busy;
    expect(pids(dir, "fake-b")).toHaveLength(1);
  });

  it("evicts a child stuck in its handshake only after the startup grace", async () => {
    const dir = tempDir();
    const defs = [definition("fake-a", dir, { FAKE_MCP_NO_INIT: "1" }), definition("fake-b", dir)];

    // Inside the grace period the starting child is not evictable, so the waiter gives up.
    const patient = hubWith(dir, defs, {
      maxChildren: 1,
      capacityWaitMs: 150,
      startupGraceMs: 60_000,
    });
    const stuck = patient.serve("fake-a", "s1", tool("echo"));
    await until(() => pids(dir, "fake-a").length === 1);
    const refused = await patient.serve("fake-b", "s2", tool("echo", { text: "b" }));
    expect(refused?.error?.message).toContain("at capacity");
    expect(alive(pids(dir, "fake-a")[0])).toBe(true);
    patient.shutdown();
    await stuck;
  });

  it("frees a stalled starting child's slot and kills its process once the grace passes", async () => {
    const dir = tempDir();
    const hub = hubWith(
      dir,
      [definition("fake-a", dir, { FAKE_MCP_NO_INIT: "1" }), definition("fake-b", dir)],
      { maxChildren: 1, capacityWaitMs: 5_000, startupGraceMs: 100 },
    );
    const stuck = hub.serve("fake-a", "s1", tool("echo"));
    await until(() => pids(dir, "fake-a").length === 1);
    const [stuckPid] = pids(dir, "fake-a");

    const served = await hub.serve("fake-b", "s2", tool("echo", { text: "b" }));

    expect(served?.result.content[0].text).toMatch(/^b:\d+$/);
    // The evicted starter's own caller is told it failed rather than hanging.
    expect((await stuck)?.error?.message).toContain("failed to start");
    await until(() => !alive(stuckPid));
    const status = await hub.status();
    expect(status.children.map((child) => child.name)).toEqual(["fake-b"]);
  });

  it("never runs more than the cap when starts arrive together", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir)], { maxChildren: 2 });
    let peak = 0;
    const sampler = setInterval(() => {
      void hub.status().then((status) => {
        peak = Math.max(peak, status.running);
      });
    }, 5);
    try {
      const replies = await Promise.all(
        ["s1", "s2", "s3", "s4"].map((session) =>
          hub.serve("fake-a", session, tool("slow", { ms: 60 })),
        ),
      );
      expect(replies.map((reply) => reply?.result?.content[0].text)).toEqual(
        replies.map(() => expect.stringMatching(/^slow:\d+$/)),
      );
    } finally {
      clearInterval(sampler);
    }
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("ends queued starts without spawning when the hub shuts down", async () => {
    const dir = tempDir();
    const hub = hubWith(dir, [definition("fake-a", dir), definition("fake-b", dir)], {
      maxChildren: 1,
      capacityWaitMs: 5_000,
    });
    const busy = hub.serve("fake-a", "s1", tool("hold"));
    await until(async () => ((await hub.status()).children[0]?.pending ?? 0) >= 1);
    const waiting = hub.serve("fake-b", "s2", tool("echo", { text: "b" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    hub.shutdown();

    expect((await waiting)?.error?.message).toContain("shutting down");
    await busy;
    expect(pids(dir, "fake-b")).toHaveLength(0);
  });
});
