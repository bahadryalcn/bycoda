import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { clearScanCache, sessionOf } from "./cost-scan";
import { readPlanShare } from "./plan-share-read";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  clearScanCache();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const line = (iso: string, id: string) =>
  JSON.stringify({
    type: "assistant",
    timestamp: iso,
    cwd: "/work/app",
    message: {
      id,
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
  });

it("names the session after its transcript, subagents after their parent", () => {
  expect(sessionOf("/p/proj/abc.jsonl")).toBe("abc");
  expect(sessionOf(String.raw`C:\p\proj\abc.jsonl.zst`)).toBe("abc");
  expect(sessionOf("/p/proj/abc/subagents/agent-1.jsonl")).toBe("abc");
});

it("reads each account's logs separately and attributes the observed increase", async () => {
  // Offline: the built-in price table prices the requests.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  const dir = await mkdtemp(join(tmpdir(), "plan-share-"));
  dirs.push(dir);
  const a = join(dir, "a");
  const b = join(dir, "b");
  await mkdir(a, { recursive: true });
  await mkdir(b, { recursive: true });
  await writeFile(join(a, "s1.jsonl"), line("2026-11-09T10:00:00Z", "m1"));
  await writeFile(join(b, "s2.jsonl"), line("2026-11-09T10:00:00Z", "m2"));
  const resetsAt = NOW + 2 * 3_600_000;
  const observation = (account: string, usedPercent: number) => ({
    account,
    at: NOW - 60_000,
    usedPercent,
    windowMinutes: 300,
    resetsAt,
  });
  const result = await readPlanShare(
    {
      environmentId: "env",
      now: () => NOW,
      accountRoots: async () => ({
        "claude:a": { provider: "claude", roots: [a] },
        "claude:b": { provider: "claude", roots: [b] },
      }),
    },
    {
      window: "fiveHour",
      observations: [observation("claude:a", 12), observation("claude:b", 30)],
    },
  );
  expect(result.estimate).toBe(true);
  const [first, second] = result.accounts;
  expect(first.jobs).toMatchObject([{ sessionId: "s1", label: "app", estimatedPercent: 12 }]);
  expect(second.jobs).toMatchObject([{ sessionId: "s2", estimatedPercent: 30 }]);
  expect(first.untrackedPercent).toBe(0);
});

it("rejects a malformed request", async () => {
  await expect(
    readPlanShare(
      { environmentId: "env", accountRoots: async () => ({}) },
      { window: "daily", observations: [] },
    ),
  ).rejects.toThrow();
});
