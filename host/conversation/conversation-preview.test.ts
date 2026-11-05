import { expect, it, vi } from "vitest";
import { ConversationPreviewWorkflow, type PreviewBrowserState } from "./conversation-preview";

const scope = { projectId: "project", sessionId: "session", principalId: "principal" };
function fixture(now?: () => number) {
  let state: PreviewBrowserState = {
    open: false,
    controlling: false,
    url: null,
    viewport: { width: 1280, height: 720 },
  };
  const browser = vi.fn(async (method: string, input: Record<string, unknown>) => {
    if (method === "browser.claim") state = { ...state, controlling: true, leaseId: "lease" };
    if (method === "browser.open")
      state = { ...state, open: true, url: String(input.url), navigationId: "navigation" };
    if (method === "browser.resize")
      state = { ...state, viewport: { width: Number(input.width), height: Number(input.height) } };
    return method === "browser.frame"
      ? {
          ...state,
          data: "frame",
          mimeType: "image/jpeg",
          width: state.viewport!.width,
          height: state.viewport!.height,
        }
      : { ...state };
  });
  return {
    workflow: new ConversationPreviewWorkflow(now),
    ports: {
      browser,
      present: vi.fn(async () => ({
        open: true,
        panels: [{ id: "panel", tab: "browser", machine: "project", mounted: true }],
      })),
      authorize: vi.fn(async () => {}),
    },
  };
}

it("verifies a mobile frame and the actual originating Host panel separately", async () => {
  const { workflow, ports } = fixture();
  const result = await workflow.run(
    { requestId: "mobile", url: "http://localhost:3000", width: 390, height: 844 },
    scope,
    ports,
  );
  expect(ports.browser.mock.calls.map(([method]) => method)).toEqual([
    "browser.status",
    "browser.claim",
    "browser.open",
    "browser.resize",
    "browser.frame",
  ]);
  expect(result.execution.state).toBe("succeeded");
  expect(result.presentation).toEqual({ state: "mounted", panelId: "panel" });
  expect(result.evidence.frame).toMatchObject({ width: 390, height: 844 });
  expect(ports.browser).toHaveBeenCalledWith("browser.resize", {
    width: 390,
    height: 844,
    leaseId: "lease",
  });
});

it("keeps verified browser work when the desktop is headless or its panel fails", async () => {
  const { workflow, ports } = fixture();
  ports.present.mockRejectedValue(new Error("Desktop relay is offline"));
  const result = await workflow.run(
    { requestId: "headless", url: "http://localhost:3000" },
    scope,
    ports,
  );
  expect(result.execution.state).toBe("succeeded");
  expect(result.evidence.frame?.data).toBe("frame");
  expect(result.presentation).toEqual({ state: "unavailable", error: "Desktop relay is offline" });
});

it("does not treat an unmounted or remote-targeted panel as successful presentation", async () => {
  for (const panel of [
    { id: "panel", tab: "browser", machine: "project", mounted: false },
    { id: "panel", tab: "browser", machine: "machine:other", mounted: true },
  ]) {
    const { workflow, ports } = fixture();
    ports.present.mockResolvedValue({ open: true, panels: [panel] });
    const result = await workflow.run(
      { requestId: "unmounted", url: "http://localhost:3000" },
      scope,
      ports,
    );
    expect(result.execution.state).toBe("succeeded");
    expect(result.presentation.state).toBe("blocked");
  }
});

it("still presents a confirmed open page when frame verification fails", async () => {
  const { workflow, ports } = fixture();
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, input) => {
    if (method === "browser.frame") throw new Error("Screenshot unavailable");
    return execute(method, input);
  });
  const result = await workflow.run(
    { requestId: "capture-failed", url: "http://localhost:3000" },
    scope,
    ports,
  );
  expect(result.execution).toEqual({
    state: "blocked",
    stage: "frame",
    error: "Screenshot unavailable",
  });
  expect(result.presentation.state).toBe("mounted");
  expect(result.evidence.frame).toBeUndefined();
});

it("does not take over a busy browser or silently fall back to another browser", async () => {
  const { workflow, ports } = fixture();
  ports.browser.mockImplementation(async (method) => {
    if (method === "browser.claim") throw new Error("Another client controls this browser");
    return { open: true, controlling: false, url: null };
  });
  const result = await workflow.run(
    { requestId: "busy", url: "http://localhost:3000" },
    scope,
    ports,
  );
  expect(result.execution).toEqual({
    state: "blocked",
    stage: "claim",
    error: "Another client controls this browser",
  });
  expect(ports.browser.mock.calls.map(([method]) => method)).toEqual([
    "browser.status",
    "browser.claim",
  ]);
  expect(ports.present).not.toHaveBeenCalled();
});

it("reuses the original request outcome without renavigating after a lost open acknowledgment", async () => {
  const { workflow, ports } = fixture();
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, input) => {
    if (method === "browser.open") throw new Error("Transport timed out after navigation");
    return execute(method, input);
  });
  const input = { requestId: "uncertain", url: "http://localhost:3000" };
  const result = await workflow.run(input, scope, ports);
  expect(result.execution.state).toBe("outcome-unknown");
  expect(await workflow.run(input, scope, ports)).toEqual(result);
  expect(ports.browser.mock.calls.filter(([method]) => method === "browser.open")).toHaveLength(1);
  await expect(
    workflow.run({ ...input, url: "http://localhost:4000" }, scope, ports),
  ).rejects.toThrow("different input");
});

it("keeps current same-page drafts and allows explicit background-only verification", async () => {
  const { workflow, ports } = fixture();
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, input) =>
    method === "browser.status"
      ? { open: true, controlling: true, leaseId: "lease", url: "http://localhost:3000/" }
      : execute(method, input),
  );
  const result = await workflow.run(
    { requestId: "same-page", url: "http://localhost:3000", show: false },
    scope,
    ports,
  );
  expect(ports.browser.mock.calls.map(([method]) => method)).toEqual([
    "browser.status",
    "browser.frame",
  ]);
  expect(result.presentation.state).toBe("not-requested");
  expect(ports.present).not.toHaveBeenCalled();
});

it("rechecks authorization before disclosing a cached frame", async () => {
  const { workflow, ports } = fixture();
  const input = { requestId: "cached", url: "http://localhost:3000" };
  await workflow.run(input, scope, ports);
  ports.authorize.mockRejectedValue(new Error("Session authority revoked"));
  await expect(workflow.run(input, scope, ports)).rejects.toThrow("revoked");
});

it("retains compact receipts beyond32 requests without retaining screenshot bytes or replaying navigation", async () => {
  const { workflow, ports } = fixture();
  for (let i = 0; i < 40; i++)
    expect(
      (
        await workflow.run(
          { requestId: `request-${i}`, url: "http://localhost:3000" },
          scope,
          ports,
        )
      ).evidence.frame?.data,
    ).toBe("frame");
  const count = ports.browser.mock.calls.length;
  const receipt = await workflow.run(
    { requestId: "request-0", url: "http://localhost:3000" },
    scope,
    ports,
  );
  expect(receipt.execution.state).toBe("succeeded");
  expect(receipt.evidence.frame).toMatchObject({
    mimeType: "image/jpeg",
    width: 1280,
    height: 720,
  });
  expect(receipt.evidence.frame?.data).toBeUndefined();
  expect(ports.browser.mock.calls).toHaveLength(count);
  workflow.revoke(scope.principalId);
  ports.authorize.mockRejectedValue(new Error("Session authority revoked"));
  await expect(
    workflow.run({ requestId: "request-0", url: "http://localhost:3000" }, scope, ports),
  ).rejects.toThrow("revoked");
  workflow.close();
  await expect(
    workflow.run({ requestId: "request-0", url: "http://localhost:3000" }, scope, ports),
  ).rejects.toThrow("closed");
});

it("rejects invalid URL and viewport inputs before any browser or UI effect", async () => {
  for (const change of [{ url: "file:///private" }, { width: 390 }, { width: 5000, height: 844 }]) {
    const { workflow, ports } = fixture();
    await expect(
      workflow.run({ requestId: "invalid", url: "http://localhost:3000", ...change }, scope, ports),
    ).rejects.toThrow();
    expect(ports.browser).not.toHaveBeenCalled();
    expect(ports.present).not.toHaveBeenCalled();
  }
});

it("expires over 4096 confirmed receipts without replaying retired IDs", async () => {
  let now = 0;
  const { workflow, ports } = fixture(() => now);
  for (let i = 0; i < 4100; i++) {
    const result = await workflow.run(
      { requestId: `completed-${i}`, url: "http://localhost:3000", show: false },
      scope,
      ports,
    );
    expect(result.execution.state).toBe("succeeded");
    now += 10 * 60 * 1000 + 1;
  }
  const count = ports.browser.mock.calls.length;
  await expect(
    workflow.run(
      { requestId: "completed-0", url: "http://localhost:3000", show: false },
      scope,
      ports,
    ),
  ).rejects.toThrow("receipt expired");
  expect(ports.browser).toHaveBeenCalledTimes(count);
});

it("retains unknown outcomes and their input identity beyond TTL and revocation", async () => {
  let now = 0;
  const { workflow, ports } = fixture(() => now);
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, args) => {
    if (method === "browser.open") throw new Error("unknown after open");
    return execute(method, args);
  });
  const input = { requestId: "unknown-ttl", url: "http://localhost:3000" };
  expect((await workflow.run(input, scope, ports)).execution.state).toBe("outcome-unknown");
  now += 20 * 60 * 1000;
  expect((await workflow.run(input, scope, ports)).execution.state).toBe("outcome-unknown");
  await expect(
    workflow.run({ ...input, url: "http://localhost:4000" }, scope, ports),
  ).rejects.toThrow("different input");
  workflow.revoke(scope.principalId);
  await expect(workflow.run(input, scope, { ...ports, authorize: async () => {} })).rejects.toThrow(
    "revoked",
  );
  expect(ports.browser.mock.calls.filter(([method]) => method === "browser.open")).toHaveLength(1);
});

it("requires original authority even when a new callback approves replay", async () => {
  const { workflow, ports } = fixture();
  let original = true;
  const input = { requestId: "original-auth", url: "http://localhost:3000" };
  const originalPorts = {
    ...ports,
    authorize: async () => {
      if (!original) throw new Error("original revoked");
    },
  };
  await workflow.run(input, scope, originalPorts);
  original = false;
  await expect(workflow.run(input, scope, { ...ports, authorize: async () => {} })).rejects.toThrow(
    "original revoked",
  );
});

it("retains in-flight work after revocation and never repeats its pending effect", async () => {
  const { workflow, ports } = fixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, args) => {
    if (method === "browser.open") {
      entered();
      await gate;
    }
    return execute(method, args);
  });
  const input = { requestId: "pending-revoke", url: "http://localhost:3000" };
  const running = workflow.run(input, scope, ports);
  await started;
  workflow.revoke(scope.principalId);
  await expect(workflow.run(input, scope, ports)).rejects.toThrow("revoked");
  release();
  await expect(running).rejects.toThrow("revoked");
  expect(ports.browser.mock.calls.filter(([method]) => method === "browser.open")).toHaveLength(1);
});

it("keeps pending work past TTL and joins the original in-flight request", async () => {
  let now = 0;
  const { workflow, ports } = fixture(() => now);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, args) => {
    if (method === "browser.open") {
      entered();
      await gate;
    }
    return execute(method, args);
  });
  const input = { requestId: "pending-ttl", url: "http://localhost:3000", show: false };
  const first = workflow.run(input, scope, ports);
  await started;
  now += 20 * 60 * 1000;
  const second = workflow.run(input, scope, ports);
  release();
  const [a, b] = await Promise.all([first, second]);
  expect(a.execution.state).toBe("succeeded");
  expect(b.execution.state).toBe("succeeded");
  expect(ports.browser.mock.calls.filter(([method]) => method === "browser.open")).toHaveLength(1);
});

it("retains unknown effects in concurrent admission even after TTL", async () => {
  let now = 0;
  const { workflow, ports } = fixture(() => now);
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, args) => {
    if (method === "browser.open") throw new Error("unknown after open");
    return execute(method, args);
  });
  for (let i = 0; i < 4; i++) {
    expect(
      (
        await workflow.run(
          { requestId: `unknown-${i}`, url: "http://localhost:3000" },
          scope,
          ports,
        )
      ).execution.state,
    ).toBe("outcome-unknown");
    now += 20 * 60 * 1000;
  }
  await expect(
    workflow.run({ requestId: "another", url: "http://localhost:3000" }, scope, ports),
  ).rejects.toThrow("busy");
});

it("expires confirmed read-only status failures while preserving their request fence", async () => {
  let now = 0;
  const { workflow, ports } = fixture(() => now);
  ports.browser.mockRejectedValue(new Error("status unavailable"));
  const input = { requestId: "status-only", url: "http://localhost:3000" };
  expect((await workflow.run(input, scope, ports)).execution).toMatchObject({
    state: "blocked",
    stage: "status",
  });
  now += 10 * 60 * 1000 + 1;
  await expect(workflow.run(input, scope, ports)).rejects.toThrow("receipt expired");
  expect(ports.browser).toHaveBeenCalledOnce();
});

it("rejects disclosure when a receipt expires during original authorization", async () => {
  let now = 0;
  let block = false;
  let entered!: () => void;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const { workflow, ports } = fixture(() => now);
  const original = {
    ...ports,
    authorize: async () => {
      if (block) {
        entered();
        await gate;
      }
    },
  };
  const input = { requestId: "auth-cross-expiry", url: "http://localhost:3000", show: false };
  await workflow.run(input, scope, original);
  block = true;
  const replay = workflow.run(input, scope, ports);
  await started;
  now += 10 * 60 * 1000 + 1;
  release();
  await expect(replay).rejects.toThrow("receipt expired");
});

it("preserves first caller frame while its authority check is delayed", async () => {
  const { workflow, ports } = fixture();
  let calls = 0;
  let release!: () => void;
  let entered!: () => void;
  let frameObserved!: () => void;
  const frameReady = new Promise<void>((resolve) => {
    frameObserved = resolve;
  });
  const execute = ports.browser.getMockImplementation()!;
  ports.browser.mockImplementation(async (method, args) => {
    const value = await execute(method, args);
    if (method === "browser.frame") frameObserved();
    return value;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    entered = resolve;
  });
  ports.authorize.mockImplementation(async () => {
    if (++calls === 3) {
      entered();
      await gate;
    }
  });
  const result = workflow.run(
    { requestId: "first-frame", url: "http://localhost:3000", show: false },
    scope,
    ports,
  );
  await blocked;
  await frameReady;
  release();
  expect((await result).evidence.frame?.data).toBe("frame");
});
