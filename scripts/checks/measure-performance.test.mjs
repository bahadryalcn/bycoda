import { test } from "node:test";
import assert from "node:assert/strict";
import {
  argumentsFor,
  commandRole,
  attribute,
  aggregate,
  linuxStat,
  summarize,
  compareReports,
} from "./measure-performance.mjs";

const options = () => ({ roots: [], sessions: [], mcps: [] });
const p = (pid, ppid, name, command = "", memoryBytes = 100) => ({
  pid,
  ppid,
  name,
  command,
  memoryBytes,
  startedAt: "2026-01-01T00:00:00Z",
  cpuMs: 50,
});

test("embedded host serve commands in provider configuration cannot become host roots", () => {
  assert.equal(
    commandRole(p(1, 0, "codex.exe", 'codex.exe -c mcp.server="node host.mjs serve"')),
    "provider",
  );
  assert.equal(
    commandRole(p(1, 0, "node.exe", '"C:\\node.exe" "C:\\codex.js" -c "host.mjs serve"')),
    "provider",
  );
  assert.equal(
    commandRole(p(1, 0, "node.exe", '"C:\\node.exe" "C:\\host.mjs" serve --data-dir ignored')),
    "host",
  );
  assert.equal(commandRole(p(1, 0, "node.exe", "node.exe host.mjs conversation-mcp")), "mcp");
  assert.equal(commandRole(p(1, 0, "pwsh.exe", 'pwsh.exe -Command "host.mjs serve"')), "other");
});

test("unique totals include provider wrappers, MCP descendants and shared MCP exactly once", () => {
  const rows = [
    p(1, 0, "bycoda.exe"),
    p(2, 1, "node.exe", "node codex.js"),
    p(3, 2, "codex.exe"),
    p(4, 3, "node.exe", "node host.mjs social-mcp"),
    p(5, 4, "python.exe"),
    p(6, 1, "msedgewebview2.exe"),
    p(7, 1, "node.exe", "node host.mjs serve"),
    p(8, 7, "node.exe", "node shared-mcp.js"),
    p(9, 0, "codex.exe"),
  ];
  const got = attribute(rows, options());
  assert.equal(got.length, 8);
  assert.equal(new Set(got.map((p) => p.pid)).size, 8);
  assert.equal(new Set(got.map((p) => p.session).filter(Boolean)).size, 1);
  assert.equal(got.find((p) => p.pid === 5).role, "mcp");
  assert.equal(got.find((p) => p.pid === 8).session, null);
  assert.equal(aggregate(got, null, null, 4).memory.bytes, 800);
});

test("explicit mappings include detached processes; reused PID loses ownership", () => {
  const opts = { ...options(), sessions: [{ name: "owner-session", pid: 40 }] },
    pins = new Map();
  assert.equal(attribute([p(40, 0, "custom-cli")], opts, pins)[0].session, "owner-session");
  assert.equal(
    attribute([{ ...p(40, 0, "unrelated"), startedAt: "2026-02-01T00:00:00Z" }], opts, pins).length,
    0,
  );
  const mcpOpts = { ...options(), mcps: [50] },
    mcpPins = new Map();
  assert.equal(attribute([p(50, 0, "python")], mcpOpts, mcpPins).length, 1);
  assert.equal(
    attribute([{ ...p(50, 0, "unrelated"), startedAt: "2026-02-01T00:00:00Z" }], mcpOpts, mcpPins)
      .length,
    0,
  );
});

test("sampler and its descendants are excluded even inside an app process tree", () => {
  const got = attribute(
    [p(1, 0, "bycoda.exe"), p(process.pid, 1, "node.exe"), p(56, process.pid, "powershell.exe")],
    options(),
  );
  assert.deepEqual(
    got.map((p) => p.pid),
    [1],
  );
});

test("missing memory, PID reuse and first CPU sample cannot masquerade as measured zero", () => {
  const row = p(42, 1, "node.exe", "", null);
  assert.equal(aggregate([row], null, null, 8).memory.bytes, null);
  assert.equal(aggregate([row], null, null, 8).cpu.oneCorePercent, null);
  assert.equal(aggregate([{ ...row, cpuMs: 1050 }], [row], 1000, 8).cpu.machinePercent, 12.5);
  assert.equal(
    aggregate([{ ...row, startedAt: "2026-02-01", cpuMs: 1050 }], [row], 1000, 8).cpu
      .oneCorePercent,
    null,
  );
  assert.equal(
    aggregate([{ ...row, startedAt: "2026-02-01", cpuMs: 500 }], [], 1000, 8, "2026-01-31").cpu
      .oneCorePercent,
    50,
  );
});

test("Linux stat parser handles spaces and parentheses in comm; uses runtime CLK_TCK", () => {
  const fields = Array(22).fill("0");
  fields[0] = "S";
  fields[1] = "7";
  fields[11] = "50";
  fields[12] = "25";
  fields[19] = "125";
  const got = linuxStat(`10 (strange ) name) ${fields.join(" ")}`, 250, Date.UTC(2026, 0, 1));
  assert.equal(got.ppid, 7);
  assert.equal(got.cpuMs, 300);
  assert.equal(got.startedAt, "2026-01-01T00:00:00.500Z");
});

test("CLI rejects ambiguous phases, malformed PIDs and nonfinite intervals", () => {
  for (const args of [
    ["--phase", "quiet"],
    ["--seconds", "NaN"],
    ["--interval-ms", "0"],
    ["--session", "foo:0"],
    ["--root", "wrong:42"],
    ["--unknown", "x"],
  ])
    assert.throws(() => argumentsFor(args));
  assert.equal(argumentsFor(["--session", "id:42"]).sessions[0].pid, 42);
});

test("summary retains missing data and before/after comparison rejects differing semantics", () => {
  const total = aggregate([p(1, 0, "x")], null, null, 4);
  const summary = summarize([{ total, byRole: {}, sessions: {} }]);
  assert.equal(summary.total.memoryBytes.mean, 100);
  assert.equal(summary.total.cpuMachinePercent.mean, null);
  const report = {
    schemaVersion: 1,
    environment: { platform: "win32" },
    memoryMetric: "private-working-set",
    phase: "active",
    summary,
  };
  assert.equal(compareReports(report, { ...report, memoryMetric: "pss" }).compatible, false);
  assert.equal(compareReports(report, report).totalMemoryBytes.absolute, 0);
});
