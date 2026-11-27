import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { clearScanCache } from "./cost-scan";
import { clearUsageRowsCache, readUsageRows } from "./rows-read";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const dirs: string[] = [];
afterEach(async () => {
  clearScanCache();
  clearUsageRowsCache();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const line = (iso: string, id: string, input = 100) =>
  JSON.stringify({
    type: "assistant",
    timestamp: iso,
    cwd: "/work/app",
    message: {
      id,
      model: "claude-sonnet-4-5",
      usage: { input_tokens: input, output_tokens: 10 },
    },
  });

async function logDir(files: Record<string, string[]>) {
  const dir = await mkdtemp(join(tmpdir(), "usage-rows-"));
  dirs.push(dir);
  await mkdir(dir, { recursive: true });
  for (const [name, lines] of Object.entries(files))
    await writeFile(join(dir, name), lines.join("\n"));
  return dir;
}

const account = (accountId: string, root: string) => ({
  provider: "claude" as const,
  accountId,
  label: accountId,
  roots: [root],
});

it("sums requests in one 15-minute slot and keeps another slot separate", async () => {
  const dir = await logDir({
    "s.jsonl": [
      line("2026-11-09T10:01:00Z", "m1", 100),
      line("2026-11-09T10:14:00Z", "m2", 50),
      line("2026-11-09T10:16:00Z", "m3", 7),
    ],
  });
  const result = await readUsageRows(
    { environmentId: "env", now: () => NOW, accounts: async () => [account("a", dir)] },
    { sinceMs: NOW - 86_400_000 },
  );
  const rows = result.accounts[0].rows;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ input: 150, output: 20, project: "/work/app" });
  expect(rows[0].slot % 900).toBe(0);
  expect(rows[1]).toMatchObject({ input: 7, slot: rows[0].slot + 900 });
  expect(result.coverage.filesScanned).toBe(1);
});

it("clamps the start to 90 days", async () => {
  const dir = await logDir({ "s.jsonl": [line("2026-11-09T10:01:00Z", "m1")] });
  const result = await readUsageRows(
    { environmentId: "env", now: () => NOW, accounts: async () => [account("a", dir)] },
    { sinceMs: 0 },
  );
  expect(result.sinceMs).toBe(NOW - 90 * 86_400_000);
  expect(result.sampledAt).toBe(NOW);
});

it("keeps accounts separate", async () => {
  const a = await logDir({ "a.jsonl": [line("2026-11-09T10:01:00Z", "m1", 1)] });
  const b = await logDir({ "b.jsonl": [line("2026-11-09T10:01:00Z", "m2", 2)] });
  const result = await readUsageRows(
    {
      environmentId: "env",
      now: () => NOW,
      accounts: async () => [account("a", a), account("b", b)],
    },
    { sinceMs: NOW - 86_400_000 },
  );
  expect(result.accounts.map((x) => [x.accountId, x.rows[0].input])).toEqual([
    ["a", 1],
    ["b", 2],
  ]);
});

it("rejects invalid params", async () => {
  const deps = { environmentId: "env", now: () => NOW, accounts: async () => [] };
  await expect(readUsageRows(deps, { sinceMs: -1 })).rejects.toThrow();
  await expect(readUsageRows(deps, { sinceMs: 1, extra: 1 })).rejects.toThrow();
  await expect(readUsageRows(deps, undefined)).rejects.toThrow();
});
