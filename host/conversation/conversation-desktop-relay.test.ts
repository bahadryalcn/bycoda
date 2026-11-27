import { expect, it, vi } from "vitest";
import { NATIVE_SERVICES_RPC_SCHEMAS } from "../../src/shared/model/host-contracts/native-services";
import {
  CAPTURE_REQUEST_MS,
  ConversationDesktopRelay,
  DESKTOP_RELAY_STALE_MS,
  SESSION_FULL_ACCESS_ACTIONS,
} from "./conversation-desktop-relay";

const principal = {
  kind: "session" as const,
  projectId: "p",
  sessionId: "s",
  provider: "codex",
};
const action = "servers.ssh.execute";
const permission = "servers.ssh.execute.permission";

it("pins Room SSH control to the original Native device across queued relay waits", async () => {
  const owner = "a".repeat(64);
  const replacement = "b".repeat(64);
  const relay = new ConversationDesktopRelay("host");
  await relay.take(owner);
  const pending = relay.callAssistantThread(
    "servers.ssh.cancel",
    { requestId: "original" },
    { threadId: "room", environmentId: "host", targetDeviceHash: owner },
    () => true,
  );
  void pending.catch(() => undefined);
  expect(await relay.take(replacement)).toEqual([]);
  const [request] = await relay.take(owner);
  expect(request).toBeDefined();
  expect(await relay.authorize(String(request.id), "servers.ssh.cancel", replacement)).toEqual({
    authorized: false,
  });
  await relay.finish(String(request.id), { state: "cancelled" }, undefined, owner);
  await expect(pending).resolves.toEqual({ state: "cancelled" });
  relay.close();
});

it("holds an idle take until a queued request wakes it", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const held = relay.take("native", { waitMs: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  void relay.call(action, {}, "/project", principal, () => true).catch(() => undefined);
  const requests = await held;
  expect(requests).toHaveLength(1);
  relay.close();
});

it("ends an idle held take after its wait with no requests", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const started = Date.now();
  expect(await relay.take("native", { waitMs: 50 })).toEqual([]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  relay.close();
});

it("ends a held take when its caller aborts or its authority is revoked", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const controller = new AbortController();
  const aborted = relay.take("native", {
    waitMs: 5_000,
    signal: controller.signal,
  });
  controller.abort();
  expect(await aborted).toEqual([]);
  let authorized = true;
  const revoked = relay.take("native", {
    waitMs: 5_000,
    authorized: () => authorized,
  });
  setTimeout(() => {
    authorized = false;
  }, 20);
  expect(await revoked).toEqual([]);
  relay.close();
});

it("bounds the held-take key to the relay wait and rejects other keys", () => {
  const schema = NATIVE_SERVICES_RPC_SCHEMAS["native.services.conversation.desktop.take"].params;
  expect(schema.parse({ waitMs: 25_000 })).toEqual({ waitMs: 25_000 });
  expect(() => schema.parse({ waitMs: 25_001 })).toThrow();
  expect(() => schema.parse({ owner: "forged-principal" })).toThrow();
});

it("Host critical exclusions can only narrow a Room native grant and revoke queued approval", async () => {
  let requiresOwner = false;
  const relay = new ConversationDesktopRelay("host", async () => requiresOwner);
  await relay.take("native");
  const pending = relay.call(
    "management.write.authorize",
    { operation: { action: "social.send" } },
    "/project",
    {
      kind: "assistant-thread",
      threadId: "thread",
      projectId: "p",
      provider: "assistant",
    },
  );
  void pending.catch(() => undefined);
  await Promise.resolve();
  const [request] = await relay.take("native");
  expect((request.input as { requireOwnerApproval: boolean }).requireOwnerApproval).toBe(false);
  requiresOwner = true;
  expect(await relay.authorize(String(request.id), "management.write.authorize", "native")).toEqual(
    { authorized: false },
  );
  relay.close();
  await expect(pending).rejects.toThrow("Host stopped");
});

it.each(["supervised", "auto-accept-edits", "auto", "full-access"])(
  "uses current original-session permission for SSH: %s",
  async (initialMode) => {
    const relay = new ConversationDesktopRelay("host");
    await relay.take("native");
    let mode = initialMode;
    let authorized = true;
    const pending = relay.call(
      action,
      {},
      "/project",
      principal,
      () => authorized,
      () => mode === "full-access",
    );
    const [request] = await relay.take("native");
    const id = String(request.id);
    expect(await relay.authorize(id, action, "native")).toEqual({
      authorized: true,
    });
    expect(await relay.authorize(id, permission, "native")).toEqual({
      authorized: true,
      fullAccess: initialMode === "full-access",
    });
    mode = "supervised";
    expect(await relay.authorize(id, permission, "native")).toEqual({
      authorized: true,
      fullAccess: false,
    });
    mode = "full-access";
    expect(await relay.authorize(id, permission, "native")).toEqual({
      authorized: true,
      fullAccess: true,
    });
    for (const [requestedAction, owner] of [
      [action, "other"],
      ["servers.ssh.cancel", "native"],
    ])
      expect(await relay.authorize(id, requestedAction, owner)).toEqual({
        authorized: false,
      });
    authorized = false;
    expect(await relay.authorize(id, permission, "native")).toEqual({
      authorized: false,
    });
    await relay.finish(id, {}, undefined, "native");
    await expect(pending).rejects.toThrow("revoked");
    relay.close();
  },
);

it("defaults to approval and ignores tool-supplied permission fields", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const pending = relay.call(
    action,
    { fullAccess: true, runtimeMode: "full-access" },
    "/project",
    principal,
  );
  const [request] = await relay.take("native");
  expect(await relay.authorize(String(request.id), permission, "native")).toEqual({
    authorized: true,
    fullAccess: false,
  });
  await relay.finish(String(request.id), {}, undefined, "native");
  await pending;
  relay.close();
});

it("keeps Assistant Room SSH approval even without a project session", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const pending = relay.callAssistantThread(
    action,
    {},
    { threadId: "room", environmentId: "host" },
    () => true,
  );
  const [request] = await relay.take("native");
  expect(await relay.authorize(String(request.id), permission, "native")).toEqual({
    authorized: true,
    fullAccess: false,
  });
  await relay.finish(String(request.id), {}, undefined, "native");
  await pending;
  relay.close();
});

it("rechecks expiry after permission lookup and preserves non-SSH authorization", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  let finishLookup!: (value: boolean) => void;
  const pending = relay.call(
    action,
    {},
    "/project",
    principal,
    () => true,
    () =>
      new Promise<boolean>((resolve) => {
        finishLookup = resolve;
      }),
  );
  const [request] = await relay.take("native");
  const authorization = relay.authorize(String(request.id), permission, "native");
  await vi.waitFor(() => expect(finishLookup).toBeTypeOf("function"));
  const clock = vi.spyOn(Date, "now").mockReturnValue(Number(request.deadline));
  finishLookup(true);
  try {
    expect(await authorization).toEqual({ authorized: false });
  } finally {
    clock.mockRestore();
  }
  await relay.finish(String(request.id), {}, undefined, "native");
  await pending;
  const other = relay.call(
    "terminals.list",
    {},
    "/project",
    principal,
    () => true,
    () => true,
  );
  const [otherRequest] = await relay.take("native");
  expect(await relay.authorize(String(otherRequest.id), "terminals.list", "native")).toEqual({
    authorized: true,
  });
  expect(await relay.authorize(String(otherRequest.id), permission, "native")).toEqual({
    authorized: false,
  });
  await relay.finish(String(otherRequest.id), {}, undefined, "native");
  await other;
  relay.close();
});

it("stays online through the desktop's slowest idle poll and goes offline once silent past the window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  try {
    const relay = new ConversationDesktopRelay("host");
    const source = { threadId: "thread", environmentId: "host" };
    const capture = () =>
      relay.callAssistantThread(
        "privacy.account.capture",
        { requestId: "request", operationHash: "a".repeat(64) },
        source,
        () => true,
      );
    await relay.take("desktop");
    vi.advanceTimersByTime(15_000);
    const accepted = capture();
    accepted.catch(() => {});
    vi.advanceTimersByTime(DESKTOP_RELAY_STALE_MS + 1_000);
    expect(() => capture()).toThrow("Desktop relay is offline");
    await relay.take("desktop");
    vi.advanceTimersByTime(15_000);
    const recovered = capture();
    recovered.catch(() => {});
    relay.close();
  } finally {
    vi.useRealTimers();
  }
});

it("judges a request aimed at one device by that device's own polls, not by another desktop's", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  try {
    const relay = new ConversationDesktopRelay("host");
    const phone = "b".repeat(64);
    const capture = () =>
      relay.callAssistantThread(
        "privacy.account.capture",
        { requestId: "request", operationHash: "a".repeat(64) },
        { threadId: "thread", environmentId: "host", targetDeviceHash: phone },
        () => true,
      );
    await relay.take(phone);
    vi.advanceTimersByTime(DESKTOP_RELAY_STALE_MS + 1_000);
    // The main desktop keeps polling while the targeted device has gone silent.
    await relay.take("desktop");
    expect(() => capture()).toThrow("Desktop relay is offline");
    await relay.take(phone);
    const accepted = capture();
    accepted.catch(() => {});
    relay.close();
  } finally {
    vi.useRealTimers();
  }
});

it("does not count the time the Host machine slept as desktop silence, and still goes offline afterwards", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  try {
    const relay = new ConversationDesktopRelay("host");
    const capture = () =>
      relay.callAssistantThread(
        "privacy.account.capture",
        { requestId: "request", operationHash: "a".repeat(64) },
        { threadId: "thread", environmentId: "host" },
        () => true,
      );
    await relay.take("desktop");
    // The whole machine sleeps for half an hour: the desktop could not poll either.
    vi.setSystemTime(Date.now() + 30 * 60_000);
    const accepted = capture();
    accepted.catch(() => {});
    // A desktop that stays silent after waking is offline one window later.
    for (let elapsed = 0; elapsed <= DESKTOP_RELAY_STALE_MS + 5_000; elapsed += 5_000)
      vi.advanceTimersByTime(5_000);
    expect(() => capture()).toThrow("Desktop relay is offline");
    relay.close();
  } finally {
    vi.useRealTimers();
  }
});

it("hands the desktop session and assistant Room requests that match the take contract", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const pending = [
    relay.call(action, {}, "/project", principal),
    relay.call("management.write.authorize", {}, "/project", {
      kind: "assistant-thread",
      threadId: "thread",
      projectId: "p",
      provider: "assistant",
    }),
    relay.callAssistantThread(
      "privacy.scope.capture",
      { action: "room.disclosure", requestId: "r", operationHash: "h" },
      {
        threadId: "thread",
        environmentId: "host",
        projectId: "p",
        targetProjectCwd: "/project",
      },
      () => true,
    ),
    relay.callAssistantThread(
      "privacy.account.capture",
      { requestId: "r", operationHash: "h" },
      { threadId: "thread", environmentId: "host" },
      () => true,
    ),
  ];
  for (const request of pending) request.catch(() => undefined);
  const taken = await relay.take("native");
  expect(taken).toHaveLength(4);
  expect(
    NATIVE_SERVICES_RPC_SCHEMAS["native.services.conversation.desktop.take"].result.parse(taken),
  ).toEqual(taken);
  relay.close();
});

it("sends a Global thread's desktop approval with no project folder and refuses a project source", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const pending = relay.callAssistantThread(
    "desktop.act.authorize",
    { operation: { kind: "app", app: "Chrome" }, operationHash: "h" },
    { threadId: "room", environmentId: "host" },
    () => true,
  );
  pending.catch(() => undefined);
  const [request] = await relay.take("native");
  expect(request).toMatchObject({
    action: "desktop.act.authorize",
    threadId: "room",
  });
  expect(request).not.toHaveProperty("projectId");
  expect(request).not.toHaveProperty("cwd");
  expect(() =>
    relay.callAssistantThread(
      "desktop.act.authorize",
      {},
      { threadId: "room", environmentId: "host", projectId: "p" },
      () => true,
    ),
  ).toThrow("Invalid global desktop approval source.");
  relay.close();
});

it("fails a claimed request once the desktop that claimed it goes silent, and frees its slot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  try {
    const relay = new ConversationDesktopRelay("host");
    await relay.take("desktop");
    const pending = relay.call(action, {}, "/project", principal);
    const settled = pending.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    expect(await relay.take("desktop")).toHaveLength(1);
    // The desktop keeps polling: the claim survives past the stale window.
    for (let elapsed = 0; elapsed < DESKTOP_RELAY_STALE_MS + 10_000; elapsed += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      await relay.take("desktop");
    }
    // Silence from the claiming desktop fails the claim,
    // even when nothing else touches the relay.
    await vi.advanceTimersByTimeAsync(DESKTOP_RELAY_STALE_MS + 10_000);
    await expect(settled).resolves.toContain("Desktop disconnected");
    relay.close();
  } finally {
    vi.useRealTimers();
  }
});

const device = "c".repeat(64);
const capture = (relay: ConversationDesktopRelay, signal?: AbortSignal) =>
  relay.callAssistantThread(
    "privacy.scope.capture",
    {
      action: "room.disclosure",
      requestId: "r",
      operationHash: "d".repeat(64),
    },
    {
      threadId: "room",
      environmentId: "host",
      projectId: "project",
      targetProjectCwd: "/project",
      targetDeviceHash: device,
    },
    () => true,
    { signal },
  );

it("gives a privacy capture the lifetime of the proof it asks for, not the relay's four minutes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
  try {
    const relay = new ConversationDesktopRelay("host");
    await relay.take(device);
    const pending = capture(relay);
    const settled = pending.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    const [request] = await relay.take(device);
    // The desktop claims it, keeps polling, and never answers: the claim must not outlive its proof.
    expect(Number(request.deadline) - Date.now()).toBe(CAPTURE_REQUEST_MS);
    for (let elapsed = 0; elapsed < CAPTURE_REQUEST_MS; elapsed += 10_000) {
      await vi.advanceTimersByTimeAsync(10_000);
      await relay.take(device);
    }
    await expect(settled).resolves.toContain("timed out");
    // The slot is free and a late answer from the desktop is refused.
    await expect(relay.finish(String(request.id), {}, undefined, device)).rejects.toThrow(
      "expired",
    );
    relay.close();
  } finally {
    vi.useRealTimers();
  }
});

it("drops a pending capture when its caller gives up, so no desktop claims it later", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take(device);
  const abort = new AbortController();
  const pending = capture(relay, abort.signal);
  const settled = pending.then(
    () => "resolved",
    (error: Error) => error.message,
  );
  abort.abort();
  await expect(settled).resolves.toContain("cancelled");
  expect(await relay.take(device)).toEqual([]);
  // A caller that is already gone never queues anything.
  expect(() => capture(relay, abort.signal)).toThrow("cancelled");
  expect(await relay.take(device)).toEqual([]);
  relay.close();
});

it("cancels a capture the desktop already claimed and refuses its late answer", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take(device);
  const abort = new AbortController();
  const pending = capture(relay, abort.signal);
  const settled = pending.catch((error: Error) => error.message);
  const [request] = await relay.take(device);
  abort.abort();
  await expect(settled).resolves.toContain("cancelled");
  expect(await relay.authorize(String(request.id), "privacy.scope.capture", device)).toEqual({
    authorized: false,
  });
  await expect(relay.finish(String(request.id), {}, undefined, device)).rejects.toThrow("expired");
  relay.close();
});

it("keeps an answered capture's result when its caller aborts afterwards", async () => {
  const relay = new ConversationDesktopRelay("host");
  await relay.take(device);
  const abort = new AbortController();
  const pending = capture(relay, abort.signal);
  const [request] = await relay.take(device);
  await relay.finish(String(request.id), { operationJson: "{}" }, undefined, device);
  abort.abort();
  await expect(pending).resolves.toMatchObject({
    relayId: request.id,
    envelope: { operationJson: "{}" },
    deviceHash: device,
  });
  relay.close();
});

it("answers the session Full access query for task and inbox approvals only", async () => {
  for (const approval of ["tasks.write.authorize", "inbox.write.authorize"]) {
    const relay = new ConversationDesktopRelay("host");
    await relay.take("native");
    let mode = "full-access";
    const pending = relay.call(
      approval,
      { operation: {}, fullAccess: false },
      "/project",
      principal,
      () => true,
      () => mode === "full-access",
    );
    const [request] = await relay.take("native");
    const id = String(request.id);
    expect(await relay.authorize(id, `${approval}.permission`, "native")).toEqual({
      authorized: true,
      fullAccess: true,
    });
    mode = "auto";
    expect(await relay.authorize(id, `${approval}.permission`, "native")).toEqual({
      authorized: true,
      fullAccess: false,
    });
    // A query for another request's action never matches this one.
    expect(await relay.authorize(id, permission, "native")).toEqual({ authorized: false });
    await relay.finish(id, { approved: true }, undefined, "native");
    await pending;
    relay.close();
  }
  const relay = new ConversationDesktopRelay("host");
  await relay.take("native");
  const pending = relay.call(
    "terminals.create",
    {},
    "/project",
    principal,
    () => true,
    () => true,
  );
  void pending.catch(() => undefined);
  const [request] = await relay.take("native");
  expect(
    await relay.authorize(String(request.id), "terminals.create.permission", "native"),
  ).toEqual({ authorized: false });
  relay.close();
});

it("lets native send every Full access permission query the relay answers", () => {
  // Native validates against this contract before sending; a missing action rejected the
  // query with RPC_WS_VALIDATION and blocked every agent inbox comment.
  const schema =
    NATIVE_SERVICES_RPC_SCHEMAS["native.services.conversation.desktop.authorize"].params;
  for (const action of SESSION_FULL_ACCESS_ACTIONS)
    expect(schema.safeParse({ id: "r", action: `${action}.permission` }).success, action).toBe(
      true,
    );
});
