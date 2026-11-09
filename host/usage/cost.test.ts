import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createUsagePricing } from "../../src/features/providers/model/usagePricing";
import { aggregateCost, costParams, windowStart } from "./cost-report";
import {
  clearScanCache,
  parseClaudeLine,
  parseCodexLine,
  scanLogs,
  type LogRequest,
} from "./cost-scan";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const pricing = createUsagePricing([]);
const meta = {
  environmentId: "env",
  pricing: "built-in" as const,
  filesScanned: 1,
  truncated: false,
};
const req = (iso: string, over: Partial<LogRequest> = {}): LogRequest => ({
  ts: Date.parse(iso) / 1000,
  model: "claude-sonnet-4-5",
  project: "/work/app",
  input: 1_000_000,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  output: 0,
  ...over,
});

it("validates the cost window", () => {
  expect(costParams(undefined)).toEqual({ days: 30, utcOffsetMinutes: 0 });
  expect(() => costParams({ days: 0 })).toThrow();
  expect(() => costParams({ days: 91 })).toThrow();
  expect(() => costParams({ utcOffsetMinutes: 900 })).toThrow();
  expect(() => costParams([])).toThrow();
});

it("buckets cost per local day with breakdowns by provider, model and project", () => {
  const params = { days: 3, utcOffsetMinutes: 180 };
  const report = aggregateCost(
    [
      { provider: "claude", request: req("2026-11-09T10:00:00Z") },
      // 22:30 UTC on the 8th is already the 9th at UTC+3.
      {
        provider: "claude",
        request: req("2026-11-08T22:30:00Z", { project: "C:\\work\\other", output: 1_000_000 }),
      },
      { provider: "codex", request: req("2026-11-07T10:00:00Z", { model: "mystery-model" }) },
      // Before the window.
      { provider: "claude", request: req("2026-11-01T10:00:00Z") },
    ],
    NOW,
    params,
    pricing,
    meta,
  );
  expect(report.daily.map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09"]);
  expect(report.daily.map((d) => d.costUsd)).toEqual([0, 0, 21]);
  expect(report.totals).toMatchObject({ costUsd: 21, activeDays: 2 });
  expect(report.providers[0]).toMatchObject({ provider: "claude", costUsd: 21 });
  expect(report.projects.map((p) => p.label)).toEqual(["other", "app"]);
  expect(report.coverage.unpricedModels).toEqual(["mystery-model"]);
  expect(windowStart(NOW, params)).toBe(Date.parse("2026-11-06T21:00:00Z"));
});

it("parses Claude lines once per request and skips synthetic models", () => {
  const line = (model: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-09T06:01:00Z",
      cwd: "/work/app",
      requestId: "r1",
      message: {
        id: "m1",
        model,
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 4,
          output_tokens: 5,
          cache_creation_input_tokens: 300,
          cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
        },
      },
    });
  expect(parseClaudeLine(line("claude-opus-5"))).toEqual([
    "m1:r1",
    expect.objectContaining({
      input: 2,
      cacheRead: 4,
      cacheWrite5m: 100,
      cacheWrite1h: 200,
      output: 5,
      project: "/work/app",
    }),
  ]);
  expect(parseClaudeLine(line("<synthetic>"))).toBeNull();
});

it("parses Codex token counts, skipping a repeated running total", () => {
  const carry = { project: "", model: "", lastTotal: null as number | null };
  expect(
    parseCodexLine(
      JSON.stringify({ type: "turn_context", payload: { cwd: "/w", model: "gpt-5.5" } }),
      carry,
    ),
  ).toBeNull();
  const count = (total: number) =>
    JSON.stringify({
      type: "event_msg",
      timestamp: "2026-11-09T06:01:00Z",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: total },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
        },
      },
    });
  expect(parseCodexLine(count(107), carry)?.[1]).toMatchObject({
    input: 60,
    cacheRead: 40,
    output: 7,
    model: "gpt-5.5",
    project: "/w",
  });
  expect(parseCodexLine(count(107), carry)).toBeNull();
});

let dir: string | undefined;
afterEach(async () => {
  clearScanCache();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

it("scans log files, merging growing Claude requests and ignoring old logs", async () => {
  dir = await mkdtemp(join(tmpdir(), "usage-scan-"));
  await mkdir(join(dir, "p"), { recursive: true });
  const entry = (output: number) =>
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-09T06:01:00Z",
      requestId: "r",
      message: {
        id: "m",
        model: "claude-opus-5",
        usage: { input_tokens: 1, output_tokens: output },
      },
    });
  await writeFile(join(dir, "p", "a.jsonl"), [entry(3), entry(9), "not json"].join("\n"));
  const scan = await scanLogs([dir, join(dir, "missing")], "claude", 0);
  expect(scan.files).toBe(1);
  expect(scan.requests).toHaveLength(1);
  expect(scan.requests[0].output).toBe(9);
  expect((await scanLogs([dir], "claude", Date.now() + 86_400_000)).requests).toEqual([]);
});
