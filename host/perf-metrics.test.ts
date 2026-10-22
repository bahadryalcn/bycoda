import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PerfMetrics,
  MAX_METRICS,
  mcpMetricName,
  perfMetrics,
  measure,
  recordDuration,
} from "./perf-metrics";
import { ResourceDiagnostics } from "./resource-diagnostics";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

it("approximates nearest-rank percentiles within 5%, with exact counts and max", () => {
  const metrics = new PerfMetrics(["rpc.read"]);
  for (let ms = 1; ms <= 10_000; ms++) metrics.recordDuration("rpc.read", ms);
  const result = metrics.snapshot().metrics[0];
  expect(result.count).toBe(10_000);
  expect(result.max).toBe(10_000);
  for (const [value, expected] of [
    [result.p50, 5000],
    [result.p95, 9500],
    [result.p99, 9900],
  ]) {
    expect(value).toBeGreaterThanOrEqual(expected);
    expect(value).toBeLessThanOrEqual(expected * 1.05);
  }
});

it("handles zero, sub-microsecond values, empty data, overflow and invalid durations", () => {
  const metrics = new PerfMetrics(["zero", "tiny", "overflow"]);
  expect(metrics.snapshot().metrics).toEqual([]);
  expect(metrics.snapshot().eventLoop).toMatchObject({ count: 0, max: 0, p99: 0 });
  metrics.recordDuration("zero", 0);
  metrics.recordDuration("tiny", 0.0001);
  metrics.recordDuration("overflow", Number.MAX_VALUE);
  for (const invalid of [NaN, Infinity, -Infinity, -1]) metrics.recordDuration("zero", invalid);
  expect(metrics.snapshot().metrics).toEqual([
    { name: "zero", count: 1, p50: 0, p95: 0, p99: 0, max: 0 },
    { name: "tiny", count: 1, p50: 0.0001, p95: 0.0001, p99: 0.0001, max: 0.0001 },
    {
      name: "overflow",
      count: 1,
      p50: Number.MAX_VALUE,
      p95: Number.MAX_VALUE,
      p99: Number.MAX_VALUE,
      max: Number.MAX_VALUE,
    },
  ]);
});

it("bounds series, label length, histogram bytes and output under high cardinality", () => {
  const metrics = new PerfMetrics();
  for (let i = 0; i < 50_000; i++) {
    metrics.register(`static.${i}`);
    metrics.recordDuration(`static.${i}`, i);
    metrics.recordDuration(`secret-${i}`, i);
  }
  const result = metrics.snapshot();
  expect(result.limits.registeredMetrics).toBe(MAX_METRICS);
  expect(result.limits.histogramBytes).toBe(MAX_METRICS * 768 * 8);
  expect(result.metrics).toHaveLength(MAX_METRICS);
  expect(result.metrics.reduce((sum, entry) => sum + entry.count, 0)).toBe(100_000);
  expect(JSON.stringify(result)).not.toContain("secret-");
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64 * 1024);
  metrics.register("a".repeat(1_000_000));
  expect(metrics.snapshot().limits).toEqual(result.limits);
});

it("preserves sync/async results and errors, and never serializes content", async () => {
  const metrics = new PerfMetrics(["rpc.read"]);
  const payload = { token: "private-token", prompt: "private-content" };
  expect(metrics.measure("rpc.read", () => payload)).toBe(payload);
  expect(await metrics.measure("rpc.read", async () => payload)).toBe(payload);
  const error = new Error("private-error");
  expect(() =>
    metrics.measure("rpc.read", () => {
      throw error;
    }),
  ).toThrow(error);
  await expect(
    metrics.measure("rpc.read", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  metrics.recordDuration("private-token", 1);
  metrics.recordDuration(payload, 1);
  const encoded = JSON.stringify(metrics.snapshot());
  for (const secret of ["private-token", "private-content", "private-error", "prompt"])
    expect(encoded).not.toContain(secret);
  expect(metrics.snapshot().metrics.find((entry) => entry.name === "rpc.read")?.count).toBe(4);
});

it("uses copied, non-destructive read-only diagnostics snapshots", () => {
  const metrics = new PerfMetrics(["rpc.read"]);
  metrics.recordDuration("rpc.read", 10);
  const diagnostics = new ResourceDiagnostics(Date.now, () => metrics.snapshot());
  const first = diagnostics.read("credential") as ReturnType<ResourceDiagnostics["read"]> & {
    performance: ReturnType<PerfMetrics["snapshot"]>;
  };
  first.performance.metrics[0].count = 999;
  first.performance.metrics.push({ name: "injected", count: 1, p50: 0, p95: 0, p99: 0, max: 0 });
  expect(metrics.snapshot().metrics).toHaveLength(1);
  expect(metrics.snapshot().metrics[0].count).toBe(1);
  expect(JSON.stringify(diagnostics.read("credential"))).not.toContain("credential");
  diagnostics.close();
});

it("classifies only fixed MCP route scopes without retaining URLs or consuming bodies", () => {
  expect(mcpMetricName("/rpc")).toBeUndefined();
  expect(mcpMetricName("/mcp-secret")).toBeUndefined();
  expect(mcpMetricName("/mcp")).toBe("mcp.all");
  for (const group of ["conversation", "runtime-logs", "social"]) {
    expect(mcpMetricName(`/mcp/${group}?token=secret`)).toBe(`mcp.${group}`);
    expect(mcpMetricName(`/mcp?scope=${group}`)).toBe(`mcp.${group}`);
  }
  expect(mcpMetricName("/mcp/private-token")).toBe("mcp.other");
  expect(mcpMetricName("/mcp?scope=private-content")).toBe("mcp.other");
});

it("monitors real event-loop delay in milliseconds and releases the monitor", async () => {
  const metrics = new PerfMetrics();
  metrics.start();
  metrics.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 70));
    const result = metrics.snapshot().eventLoop;
    expect(result.count).toBeGreaterThan(0);
    expect(result.p50).toBeGreaterThan(0);
    expect(result.max).toBeLessThan(10_000);
    metrics.close();
    expect(metrics.snapshot().eventLoop.count).toBeGreaterThan(0);
  } finally {
    metrics.close();
  }
  expect(metrics.snapshot().eventLoop.count).toBe(0);
});

it("keeps the RPC allowlist aligned with the dispatch literals, including J2 token RPCs", () => {
  const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const methods = [...source.matchAll(/(?:case |input\.method [!=]== )"([\w.]+)"/g)].map(
    (match) => match[1],
  );
  for (const name of new Set([
    ...methods,
    "mcp.tokens.create",
    "mcp.tokens.list",
    "mcp.tokens.revoke",
  ])) {
    recordDuration(name, 1);
    expect(
      perfMetrics.snapshot().metrics.some((entry) => entry.name === name),
      name,
    ).toBe(true);
  }
  expect(measure("resources.read", () => 42)).toBe(42);
});

it("exposes completed dispatches and MCP scopes through authenticated resources.read", async () => {
  const { HostStore } = await import("./store");
  const { HostEngine } = await import("./engine");
  const { createHostServer } = await import("./server");
  const directory = mkdtempSync(join(tmpdir(), "bycoda-perf-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const server = createHostServer(engine, []);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const device = store.issueDevice("perf-test");
    const call = async (method: string, params = {}) => {
      const response = await fetch(`${origin}/rpc`, {
        method: "POST",
        headers: { Authorization: `Bearer ${device.token}` },
        body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
      });
      return { status: response.status, value: await response.json() };
    };
    const counts = () =>
      new Map(perfMetrics.snapshot().metrics.map((entry) => [entry.name, entry.count]));
    const before = counts();
    expect((await call("mcp.tokens.list")).status).toBe(200); // J2 early return
    expect(
      (await call("files.list", { projectId: "private-project", content: "private-content" }))
        .status,
    ).toBe(400);
    expect((await call("private-secret-method")).status).toBe(400);
    for (const path of ["/mcp/social", "/mcp?scope=conversation", "/mcp/runtime-logs", "/mcp"]) {
      const response = await fetch(`${origin}${path}`, { method: "POST" });
      expect(response.status).toBe(401);
      await response.text();
    }
    const response = await call("resources.read");
    expect(response.status).toBe(200);
    const summary = response.value.result.performance;
    const after = new Map<string, number>(
      summary.metrics.map((entry: { name: string; count: number }) => [entry.name, entry.count]),
    );
    for (const name of [
      "mcp.tokens.list",
      "files.list",
      "other",
      "mcp.social",
      "mcp.conversation",
      "mcp.runtime-logs",
      "mcp.all",
    ])
      expect(after.get(name)).toBe((before.get(name) ?? 0) + 1);
    const serialized = JSON.stringify(summary);
    for (const secret of [
      device.token,
      "private-project",
      "private-content",
      "private-secret-method",
    ])
      expect(serialized).not.toContain(secret);
  } finally {
    await engine.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
