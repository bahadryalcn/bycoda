import { expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend, TEXT_WORKSPACE_TTL_MS } from "./child-backend";
import { HostRunWriters } from "./run-writers";

type Workspace = { cwd: string; logPath: string };
const profile = "---\nname: bycoda-text\n---\nReturn text.";

/** A backend over an injected monotonic clock; cleanup closes it. */
function fixture(runWriters?: HostRunWriters) {
  let now = 100_000;
  const backend = new HostChildBackend({}, undefined, undefined, runWriters, () => now);
  return {
    backend,
    prepare: (args: Record<string, unknown> = {}) =>
      backend.invoke<Workspace>("harness_prepare_text_workspace", { content: profile, ...args }),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("releases an unused text sandbox after its TTL and every remaining one on close", async () => {
  const f = fixture();
  const first = await f.prepare();
  expect(readFileSync(join(first.cwd, ".agents", "agents", "bycoda-text.md"), "utf8")).toBe(
    profile,
  );
  f.advance(TEXT_WORKSPACE_TTL_MS - 1);
  const second = await f.prepare();
  expect(existsSync(first.cwd)).toBe(true);
  f.advance(1);
  const third = await f.prepare();
  await expect.poll(() => existsSync(first.cwd)).toBe(false);
  expect(existsSync(second.cwd)).toBe(true);
  await f.backend.close();
  expect(existsSync(second.cwd)).toBe(false);
  expect(existsSync(third.cwd)).toBe(false);
});

it("frees the host-run sandbox slot and grant when an unused sandbox expires", async () => {
  const writers = new HostRunWriters();
  const directory = mkdtempSync(join(tmpdir(), "bycoda-text-run-"));
  const f = fixture(writers);
  try {
    const hostRun = writers.reserve({
      owner: {},
      sessionId: "auxiliary",
      runId: randomUUID(),
      auxiliary: true,
      isCurrent: () => true,
    });
    await writers.setExecutionCwd(hostRun, directory);
    const internal = f.backend as unknown as {
      textWorkspaceSlots: Set<object>;
      findTextWorkspace: (cwd: string) => { grant?: object } | undefined;
    };
    const sandbox = await f.prepare({ hostRun });
    expect(internal.textWorkspaceSlots.size).toBe(1);
    expect(internal.findTextWorkspace.call(f.backend, sandbox.cwd)?.grant).toBeDefined();
    f.advance(TEXT_WORKSPACE_TTL_MS);
    const next = await f.prepare({ hostRun });
    await expect.poll(() => existsSync(sandbox.cwd)).toBe(false);
    expect(internal.findTextWorkspace.call(f.backend, sandbox.cwd)).toBeUndefined();
    expect(internal.textWorkspaceSlots.size).toBe(1);
    expect(existsSync(next.cwd)).toBe(true);
  } finally {
    await f.backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("removes a text sandbox once the provider that ran inside it has exited", async () => {
  const f = fixture();
  const directory = mkdtempSync(join(tmpdir(), "bycoda-text-exit-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log(JSON.stringify({cwd: process.cwd()})); process.exit(0);");
  const exits: unknown[] = [];
  const unlisten = await f.backend.listen("harness-exit", ({ payload }) => exits.push(payload));
  try {
    const sandbox = await f.prepare();
    await f.backend.invoke("harness_spawn", {
      sessionId: "text-session",
      command: file,
      args: [],
      cwd: sandbox.cwd,
    });
    await expect.poll(() => exits.length, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => existsSync(sandbox.cwd), { timeout: 15_000 }).toBe(false);
  } finally {
    unlisten();
    await f.backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
