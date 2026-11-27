import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHostShell, hostShellInputChunks, type HostShellDeps } from "./hostShell";

vi.mock("../../connections/public/hostFeatureClient", () => ({ featureHost: vi.fn() }));
vi.mock("../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../connections/public/transientFailure", () => ({
  classifyFailureLifetime: (error: unknown) =>
    (error as { transient?: boolean })?.transient ? "transient" : "permanent",
}));

const terminal = (state: "running" | "exited" = "running", exitCode: number | null = null) => ({
  id: "t1",
  projectId: "p1",
  name: "bash",
  cwd: "/srv/app",
  shell: "bash",
  transport: "pty",
  state,
  createdAt: 1,
  exitCode,
});

function setup(reads: Array<() => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const deps: HostShellDeps = {
    resolve: vi.fn(async () => ({
      machine: { id: "m1", environmentId: "env" },
      projectId: "p1",
    })),
    request: vi.fn(async (_machine, method, params) => {
      calls.push({ method, params });
      if (method === "terminals.create") return terminal();
      if (method === "terminals.read") {
        const next = reads.shift();
        if (!next)
          return { terminal: terminal(), output: "", cursor: 0, truncated: false, hasMore: false };
        return next();
      }
      return method === "terminals.close" ? { closed: true } : { accepted: true };
    }) as HostShellDeps["request"],
    newRequestId: () => "request-0001",
  };
  const handlers = { onOutput: vi.fn(), onExit: vi.fn(), onFailure: vi.fn() };
  return { calls, deps, handlers };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("creates one Host PTY in the checkout, streams its output and ends on exit", async () => {
  const { calls, deps, handlers } = setup([
    () => ({ terminal: terminal(), output: "$ ", cursor: 2, truncated: false, hasMore: true }),
    () => ({
      terminal: terminal("exited", 0),
      output: "bye",
      cursor: 5,
      truncated: false,
      hasMore: false,
    }),
  ]);
  const shell = createHostShell(
    { projectCwd: "remote://env/srv/app", cwd: "remote://env/srv/app/tree" },
    handlers,
    deps,
  );
  await shell.start(120, 40);
  expect(deps.resolve).toHaveBeenCalledWith("remote://env/srv/app", "transport.ws.terminals.v2");
  expect(calls[0]).toEqual({
    method: "terminals.create",
    params: {
      requestId: "request-0001",
      cwd: "/srv/app/tree",
      cols: 120,
      rows: 40,
      projectId: "p1",
    },
  });
  // hasMore reads the next page with no delay.
  await vi.advanceTimersByTimeAsync(1);
  expect(handlers.onOutput.mock.calls).toEqual([["$ "], ["bye"]]);
  expect(
    calls.filter((call) => call.method === "terminals.read").map((call) => call.params.after),
  ).toEqual([0, 2]);
  expect(handlers.onExit).toHaveBeenCalledWith(0);
  await expect(shell.write("ls\r")).rejects.toThrow("disconnected");
  await shell.close();
  expect(calls.at(-1)).toEqual({
    method: "terminals.close",
    params: { id: "t1", projectId: "p1" },
  });
});

it("writes input once, reads its echo at once and stops reading after close", async () => {
  const { calls, deps, handlers } = setup([]);
  const shell = createHostShell(
    { projectCwd: "remote://env/srv", cwd: "remote://other/x" },
    handlers,
    deps,
  );
  await shell.start(80, 24);
  expect(calls[0].params).not.toHaveProperty("cwd");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5000);
  const quietReads = calls.filter((call) => call.method === "terminals.read").length;
  await shell.write("pwd\r");
  await shell.resize(100, 30);
  await vi.advanceTimersByTimeAsync(0);
  const methods = calls.map((call) => call.method);
  expect(methods.filter((method) => method === "terminals.write")).toHaveLength(1);
  expect(methods).toContain("terminals.resize");
  expect(methods.filter((method) => method === "terminals.read").length).toBe(quietReads + 1);
  await shell.close();
  const closedAt = calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(calls).toHaveLength(closedAt);
  expect(handlers.onFailure).not.toHaveBeenCalled();
});

it("retries transient read failures and reports a lost terminal once", async () => {
  const { calls, deps, handlers } = setup([
    () => Promise.reject(Object.assign(new Error("offline"), { transient: true })),
    () => Promise.reject(new Error("Terminal is unavailable in this project")),
  ]);
  const shell = createHostShell(
    { projectCwd: "remote://env/srv", cwd: "remote://env/srv" },
    handlers,
    deps,
  );
  await shell.start(80, 24);
  await vi.advanceTimersByTimeAsync(0);
  expect(handlers.onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(handlers.onFailure).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls.filter((call) => call.method === "terminals.read")).toHaveLength(2);
});

it("splits long input within the Host byte limit without breaking a surrogate pair", () => {
  expect(hostShellInputChunks("abcdef", 4)).toEqual(["abcd", "ef"]);
  expect(hostShellInputChunks("abc😀d", 4)).toEqual(["abc", "😀d"]);
  const chunks = hostShellInputChunks("€".repeat(10_000));
  expect(chunks.join("")).toBe("€".repeat(10_000));
  for (const chunk of chunks)
    expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(16384);
});
