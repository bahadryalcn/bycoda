import { expect, it, vi } from "vitest";
import { NATIVE_SERVICES_RPC_SCHEMAS } from "../../src/shared/model/host-contracts/native-services";
import { ConversationDesktopRelay, DESKTOP_RELAY_STALE_MS } from "./conversation-desktop-relay";

const principal = { kind: "session" as const, projectId: "p", sessionId: "s", provider: "codex" };
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

it("Host critical exclusions can only narrow a Room native grant and revoke queued approval", async () => {
  let requiresOwner = false;
  const relay = new ConversationDesktopRelay("host", async () => requiresOwner);
  await relay.take("native");
  const pending = relay.call(
    "management.write.authorize",
    { operation: { action: "social.send" } },
    "/project",
    { kind: "assistant-thread", threadId: "thread", projectId: "p", provider: "assistant" },
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
    expect(await relay.authorize(id, action, "native")).toEqual({ authorized: true });
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
      expect(await relay.authorize(id, requestedAction, owner)).toEqual({ authorized: false });
    authorized = false;
    expect(await relay.authorize(id, permission, "native")).toEqual({ authorized: false });
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
      { threadId: "thread", environmentId: "host", projectId: "p", targetProjectCwd: "/project" },
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
  expect(request).toMatchObject({ action: "desktop.act.authorize", threadId: "room" });
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
