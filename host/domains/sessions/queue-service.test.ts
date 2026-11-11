import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { sessionNotFound } from "../../sessions/session-authority";
import { SessionQueues, QUEUE_RENEW_AFTER_MS } from "../../sessions/session-queue";
import {
  createSessionQueueService,
  type QueueDomainContext,
  type SessionQueueAction,
} from "./queue-service";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function mockFixture() {
  const access = { allowed: true };
  const result = {
    messages: [{ id: "row", text: "queued", attachments: [{ id: "upload" }] }],
    revision: 4,
    claim: { clientId: "desktop:one", token: "token" },
    settled: undefined as
      | { clientId: string; token: string; accepted: boolean; reaped?: boolean }
      | undefined,
  };
  const context: QueueDomainContext = {
    authorized: vi.fn(async () => access.allowed),
    exposeAttachments: vi.fn(async () => {}),
  };
  const ports = {
    environmentId: "environment",
    transaction: vi.fn(async <T>(work: () => Promise<T>): Promise<T> => work()),
    sessionStatus: vi.fn(async () => "idle"),
    desktopWatch: vi.fn(async () => undefined as { running?: boolean } | undefined),
    queues: { get: vi.fn(async () => result), serve: vi.fn(async (..._args: unknown[]) => result) },
    attachments: {
      validateExposure: vi.fn(async (_params: Record<string, unknown>) => {}),
      normalize: vi.fn(
        (raw: unknown) => (raw as { id: string; hostEnvironmentId?: string }[] | undefined) ?? [],
      ),
    },
  };
  return { service: createSessionQueueService(ports), ports, context, access, result };
}
const base = { sessionId: "session", clientId: "desktop:one", leaseAware: true };
const changes = {
  before: { messages: [] },
  after: { messages: [{ id: "row", text: "queued", attachments: [] }] },
};

it.each(["get", "change", "claim", "finish", "release", "lease"] as const)(
  "routes %s once through the existing queue owner and exposes its returned attachment ids",
  async (action) => {
    const f = mockFixture();
    const extras: Record<SessionQueueAction, object> = {
      get: {},
      change: changes,
      claim: { id: "row", revision: 4, epoch: 2 },
      finish: { token: "claim-token", accepted: true, epoch: 2 },
      release: { epoch: 2 },
      lease: { takeover: true },
    };
    const params = { ...base, ...extras[action] };
    expect(await f.service[action](params, f.context)).toBe(f.result);
    expect(f.ports.transaction).toHaveBeenCalledTimes(1);
    expect(f.ports.queues.serve).toHaveBeenCalledTimes(1);
    expect(f.ports.queues.serve.mock.calls[0]?.slice(0, 4)).toEqual([
      action,
      "session",
      "desktop:one",
      params,
    ]);
    expect(f.context.exposeAttachments).toHaveBeenCalledWith(["upload"], params);
  },
);

it("rejects canonical extra fields/coerced identifiers/epochs but retains HTTP legacy tolerance", async () => {
  const f = mockFixture();
  await expect(f.service.get({ ...base, extra: true }, f.context)).rejects.toThrow();
  await expect(f.service.get({ ...base, sessionId: 17 }, f.context)).rejects.toThrow();
  await expect(f.service.get({ ...base, epoch: "2" }, f.context)).rejects.toThrow();
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
  const legacy = { ...base, sessionId: 17, epoch: "2", extra: true };
  await f.service.get(legacy, f.context, { legacy: true });
  expect(f.ports.sessionStatus).toHaveBeenCalledWith("17", false);
  expect(f.ports.queues.serve).toHaveBeenCalledWith("get", "17", "desktop:one", legacy, undefined);
});

it("retains legacy invalid-client and finish-acknowledgement errors", async () => {
  const f = mockFixture();
  await expect(
    f.service.get({ ...base, clientId: 17 }, f.context, { legacy: true }),
  ).rejects.toThrow("Invalid queue client");
  await expect(
    f.service.finish({ ...base, token: "claim", accepted: "yes" }, f.context, { legacy: true }),
  ).rejects.toThrow("Invalid queue acknowledgement");
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
});

it.each(["get", "lease"] as const)(
  "refuses %s for a session nobody stores before any queue effect, as not sent",
  async (action) => {
    const f = mockFixture();
    f.ports.sessionStatus.mockRejectedValue(sessionNotFound());
    await expect(f.service[action](base, f.context)).rejects.toMatchObject({
      name: "HostDomainRefusalError",
      message: "Session not found on this machine",
      delivery: "not-sent",
    });
    expect(f.ports.transaction).not.toHaveBeenCalled();
    expect(f.ports.queues.serve).not.toHaveBeenCalled();
    expect(f.context.exposeAttachments).not.toHaveBeenCalled();
  },
);

it("does no exposure/session IO for an unauthorized request and rechecks after preparation", async () => {
  const f = mockFixture();
  f.access.allowed = false;
  await expect(f.service.get(base, f.context)).rejects.toThrow("revoked");
  expect(f.ports.attachments.validateExposure).not.toHaveBeenCalled();
  expect(f.ports.sessionStatus).not.toHaveBeenCalled();
  f.access.allowed = true;
  f.ports.attachments.validateExposure.mockImplementation(async () => {
    f.access.allowed = false;
  });
  await expect(f.service.get(base, f.context)).rejects.toThrow("revoked");
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
  expect(f.context.exposeAttachments).not.toHaveBeenCalled();
});

it("rechecks at actual transaction admission after waiting behind another writer", async () => {
  const f = mockFixture();
  f.ports.transaction.mockImplementation(async (work) => {
    f.access.allowed = false;
    return work();
  });
  await expect(f.service.get(base, f.context)).rejects.toThrow("revoked");
  expect(f.ports.sessionStatus).toHaveBeenCalledTimes(1);
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
});

it("revocation after an accepted queue effect suppresses exposure and never retries/undoes the owner call", async () => {
  const f = mockFixture();
  f.ports.queues.serve.mockImplementation(async () => {
    f.access.allowed = false;
    return f.result;
  });
  await expect(f.service.get(base, f.context)).rejects.toThrow("revoked");
  expect(f.ports.queues.serve).toHaveBeenCalledTimes(1);
  expect(f.context.exposeAttachments).not.toHaveBeenCalled();
});

it("rechecks delayed attachment disclosure and reports cancellation after accepted work honestly", async () => {
  const f = mockFixture();
  vi.mocked(f.context.exposeAttachments).mockImplementation(async () => {
    f.access.allowed = false;
  });
  await expect(f.service.get(base, f.context)).rejects.toThrow("revoked");
  const g = mockFixture(),
    abort = new AbortController();
  g.ports.queues.serve.mockImplementation(async () => {
    abort.abort();
    return g.result;
  });
  await expect(g.service.get(base, { ...g.context, signal: abort.signal })).rejects.toThrow(
    "cancelled",
  );
  expect(g.ports.queues.serve).toHaveBeenCalledTimes(1);
  expect(g.context.exposeAttachments).not.toHaveBeenCalled();
});

it("normalizes attachment references with authoritative environment while preserving legacy extension fields", async () => {
  const f = mockFixture();
  f.ports.attachments.normalize.mockReturnValue([
    { id: "normalized", hostEnvironmentId: "spoofed" },
  ]);
  const params = {
    ...base,
    before: { messages: [], extension: "preserve" },
    after: {
      messages: [
        { id: "row", text: "queued", attachments: [{ id: "caller" }], draftExtension: "keep" },
      ],
      extension: "preserve",
    },
  };
  await f.service.change(params, f.context, { legacy: true });
  expect(f.ports.queues.serve.mock.calls[0]?.[4]).toEqual({
    before: { messages: [], extension: "preserve" },
    after: {
      messages: [
        {
          id: "row",
          text: "queued",
          attachments: [{ id: "normalized", hostEnvironmentId: "environment" }],
          draftExtension: "keep",
        },
      ],
      extension: "preserve",
    },
  });
  expect(params.after.messages[0].attachments).toEqual([{ id: "caller" }]);
});

it("requires finish ownership and refuses rejected-send recovery while native or Host turn runs", async () => {
  const f = mockFixture();
  f.result.claim.clientId = "desktop:other";
  await expect(
    f.service.finish({ ...base, token: "token", accepted: true }, f.context),
  ).rejects.toThrow("another client");
  f.result.claim.clientId = "desktop:one";
  f.ports.desktopWatch.mockResolvedValue({ running: true });
  await expect(
    f.service.finish({ ...base, token: "token", accepted: false }, f.context),
  ).rejects.toThrow("running turn");
  f.ports.desktopWatch.mockResolvedValue(undefined);
  f.ports.sessionStatus.mockResolvedValue("running");
  await expect(
    f.service.finish({ ...base, token: "token", accepted: false }, f.context),
  ).rejects.toThrow("running turn");
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
});

it("releases a proven pre-write deferral while the original turn still runs", async () => {
  const f = mockFixture();
  f.ports.sessionStatus.mockResolvedValue("running");
  f.ports.desktopWatch.mockResolvedValue({ running: true });
  await expect(
    f.service.finish({ ...base, token: "token", accepted: false, deferred: true }, f.context),
  ).resolves.toBe(f.result);
  expect(f.ports.queues.serve).toHaveBeenCalledTimes(1);
});

it("replays an exact settled verdict without blocking on a later running turn", async () => {
  const f = mockFixture();
  f.result.settled = { clientId: base.clientId, token: "token", accepted: false };
  f.ports.sessionStatus.mockResolvedValue("running");
  await expect(
    f.service.finish({ ...base, token: "token", accepted: false }, f.context),
  ).resolves.toBe(f.result);
});

it("does not use a foreign token or a changed verdict to bypass running-turn recovery", async () => {
  const f = mockFixture();
  f.result.settled = { clientId: base.clientId, token: "old", accepted: true };
  f.ports.sessionStatus.mockResolvedValue("running");
  for (const params of [
    { token: "foreign", accepted: false, deferred: true },
    { token: "old", accepted: false },
  ])
    await expect(f.service.finish({ ...base, ...params }, f.context)).rejects.toThrow(
      "running turn",
    );
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
});

it("keeps reaped unknown-delivery owner recovery blocked while a turn runs", async () => {
  const f = mockFixture();
  f.result.settled = { clientId: base.clientId, token: "token", accepted: false, reaped: true };
  f.result.claim.token = "new-token";
  f.ports.sessionStatus.mockResolvedValue("running");
  await expect(
    f.service.finish({ ...base, token: "token", accepted: false }, f.context),
  ).rejects.toThrow("running turn");
  expect(f.ports.queues.serve).not.toHaveBeenCalled();
});

async function realFixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-domain-queue-"));
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  let now = 100;
  const queues = new SessionQueues(store.db, () => now);
  await queues.ready;
  const context: QueueDomainContext = {
    authorized: async () => true,
    exposeAttachments: vi.fn(async () => {}),
  };
  const service = createSessionQueueService({
    environmentId: store.environmentId,
    transaction: (work) => store.transaction(work),
    sessionStatus: async () => "idle",
    desktopWatch: async () => undefined,
    queues,
    attachments: {
      validateExposure: async () => {},
      normalize: (raw: unknown) => (raw as { id: string }[] | undefined) ?? [],
    },
  });
  const row = { id: "row", text: "queued", attachments: [] };
  return {
    store,
    queues,
    service,
    context,
    row,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("real legacy get renews an existing lease and re-exposes returned attachments on every call", async () => {
  const f = await realFixture();
  await f.service.change(
    {
      ...base,
      leaseAware: false,
      takeOwnership: true,
      before: { messages: [] },
      after: { messages: [f.row], status: "paused" },
    },
    f.context,
  );
  const before = await f.queues.get("session");
  expect(before.drain?.holder).toBe("desktop:one");
  f.advance(QUEUE_RENEW_AFTER_MS + 1);
  const first = await f.service.get({ sessionId: "session", clientId: "desktop:one" }, f.context);
  const second = await f.service.get({ sessionId: "session", clientId: "desktop:one" }, f.context);
  expect(first.drain!.expiresAt).toBeGreaterThan(before.drain!.expiresAt);
  expect(first.consumer).toBe("desktop:one");
  expect(second.drain!.epoch).toBe(before.drain!.epoch);
  expect(f.context.exposeAttachments).toHaveBeenCalledTimes(3);
});

it("real epoch fencing rejects a stale claim while stale release cannot relinquish another lease", async () => {
  const f = await realFixture();
  await f.service.change(
    { ...base, before: { messages: [] }, after: { messages: [f.row], status: "active" } },
    f.context,
  );
  const first = await f.service.lease(base, f.context);
  const current = await f.service.lease(
    { ...base, clientId: "desktop:two", takeover: true },
    f.context,
  );
  expect(current.drain!.epoch).toBeGreaterThan(first.drain!.epoch);
  await expect(
    f.service.claim(
      { ...base, id: "row", revision: current.revision, epoch: first.drain!.epoch },
      f.context,
    ),
  ).rejects.toThrow();
  await f.service.release({ ...base, epoch: first.drain!.epoch }, f.context);
  expect((await f.queues.get("session")).drain).toEqual(current.drain);
  const claimed = await f.service.claim(
    {
      ...base,
      clientId: "desktop:two",
      id: "row",
      revision: current.revision,
      epoch: current.drain!.epoch,
    },
    f.context,
  );
  expect(claimed.claim?.clientId).toBe("desktop:two");
  await expect(
    f.service.finish(
      {
        ...base,
        clientId: "desktop:two",
        token: claimed.claim!.token,
        accepted: true,
        epoch: first.drain!.epoch,
      },
      f.context,
    ),
  ).rejects.toThrow();
  const finished = await f.service.finish(
    {
      ...base,
      clientId: "desktop:two",
      token: claimed.claim!.token,
      accepted: true,
      epoch: current.drain!.epoch,
    },
    f.context,
  );
  expect(finished.messages).toEqual([]);
});

it("real queue owner rejects conflicting row edits and preserves accepted content", async () => {
  const f = await realFixture();
  const before = await f.service.get(base, f.context);
  const original = await f.service.change(
    { ...base, before, after: { messages: [f.row], status: "paused" } },
    f.context,
  );
  const edited = await f.service.change(
    {
      ...base,
      before: original,
      after: { ...original, messages: [{ ...f.row, text: "accepted edit" }] },
    },
    f.context,
  );
  await expect(
    f.service.change(
      {
        ...base,
        before: original,
        after: { ...original, messages: [{ ...f.row, text: "stale competing edit" }] },
      },
      f.context,
    ),
  ).rejects.toThrow("changed on another computer");
  expect((await f.queues.get("session")).messages).toEqual(edited.messages);
});
