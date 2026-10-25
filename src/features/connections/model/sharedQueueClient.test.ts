// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreDatabase } from "../../../../host/store-db";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { SessionQueues } from "../../../../host/session-queue";
import { invoke } from "@tauri-apps/api/core";
import { SharedQueueClient, type QueueTransport } from "./sharedQueueClient";
import { mergeQueueChange, QUEUE_LEASE_TTL_MS, type SharedQueue } from "./sharedQueue";
import { recordRemoteCapabilities } from "./connections";
import {
  ATTACHMENT_OWNERSHIP_CAPABILITY,
  attachmentOwnerId,
  attachmentOwnershipScope,
} from "./attachmentOwnership";
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async (command: string) =>
    command === "session_attachment_references" ? { draftIds: [], queues: {} } : undefined,
  ),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
  getAllWindows: async () => [{ label: "main" }],
}));
import {
  editRemoteMessage,
  enqueueRemoteMessage,
  removeRemoteMessage,
  reorderRemoteMessages,
} from "./remoteQueue";

const databases: StoreDatabase[] = [];
function database() {
  const db = new StoreDatabase(
    ":memory:",
    pathToFileURL(resolve(__dirname, "../../../../host/store-worker.mjs")),
  );
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

const message = (id: string, text = id) => ({ id, text, attachments: [] });
beforeEach(() => localStorage.clear());
function fixture() {
  let queue: SharedQueue = { messages: [], revision: 0 };
  let offline = false;
  const request: QueueTransport = async (method, params) => {
    if (offline) throw new Error("offline");
    if (method.endsWith(".change")) {
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before as SharedQueue,
          after: params.after as SharedQueue,
        }),
        // A host from before drain leases: the first owner is permanent.
        ...(params.takeOwnership ? { consumer: String(params.clientId) } : {}),
        revision: queue.revision + 1,
      };
    }
    if (method.endsWith(".claim"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        claim: { id: String(params.id), clientId: String(params.clientId), token: "token" },
      };
    if (method.endsWith(".finish"))
      queue = {
        ...queue,
        revision: queue.revision + 1,
        messages: params.accepted
          ? queue.messages.filter((row) => row.id !== queue.claim?.id)
          : queue.messages,
        claim: undefined,
      };
    return structuredClone(queue) as never;
  };
  const upload = vi.fn(async (_machine, attachments) => attachments);
  const client = (id: string, session = "chat", environment = "host") =>
    new SharedQueueClient("machine", environment, session, id, request, upload);
  return {
    client,
    queue: () => queue,
    offline: (value: boolean) => {
      offline = value;
    },
    replace: (value: SharedQueue) => {
      queue = value;
    },
    upload,
  };
}

it.each(["reply", "error"])(
  "lets interactive retry overtake a stalled background read and ignores its late stale %s",
  async (settlement) => {
    const clientId = "desktop:interactive";
    let queue: SharedQueue = {
      messages: [message("a")],
      revision: 1,
      consumer: clientId,
      status: "paused",
    };
    let blockNextRead = false;
    let release!: (value: SharedQueue) => void;
    let fail!: (error: Error) => void;
    const calls: string[] = [];
    const request: QueueTransport = async (method, params) => {
      calls.push(method);
      if (method.endsWith(".get") && blockNextRead) {
        blockNextRead = false;
        return new Promise((resolve, reject) => {
          release = resolve as (value: SharedQueue) => void;
          fail = reject;
        });
      }
      if (method.endsWith(".claim"))
        queue = {
          ...queue,
          revision: queue.revision + 1,
          claim: { id: String(params.id), clientId, token: "interactive-token" },
        };
      return structuredClone(queue) as never;
    };
    const client = new SharedQueueClient("machine", "host", "interactive-chat", clientId, request);
    await client.initialize();
    const stale = structuredClone(queue);
    blockNextRead = true;
    const background = client.sync();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(release).toBeTypeOf("function");
    let retried = false;
    const interactive = client.retry().then(() => {
      retried = true;
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(retried).toBe(true);
    await interactive;
    const token = await client.claim("a", true);
    expect(token).toBe("interactive-token");
    if (settlement === "reply") release(stale);
    else fail(new Error("stale read failed"));
    await background;
    expect(client.snapshot().error).toBeUndefined();
    expect(client.snapshot().queue.claim?.token).toBe(token);
    expect(client.snapshot().queue.revision).toBe(queue.revision);
    expect(calls.filter((method) => method.endsWith(".claim"))).toHaveLength(1);
  },
);

it("does not overtake acknowledgement recovery or replay an unknown send", async () => {
  const clientId = "desktop:unknown";
  let queue: SharedQueue = { messages: [message("a")], revision: 1, consumer: clientId };
  let blockRead = false;
  let release!: (value: SharedQueue) => void;
  const calls: string[] = [];
  const request: QueueTransport = async (method, params) => {
    calls.push(method);
    if (method.endsWith(".get") && blockRead) {
      blockRead = false;
      return new Promise((resolve) => {
        release = resolve as (value: SharedQueue) => void;
      });
    }
    if (method.endsWith(".claim"))
      queue = {
        ...queue,
        revision: 2,
        claim: { id: String(params.id), clientId, token: "unknown-token" },
      };
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient("machine", "host", "unknown-chat", clientId, request);
  await client.initialize();
  await client.claim("a", true);
  blockRead = true;
  const recovery = client.sync();
  const rejectedRecovery = expect(recovery).rejects.toThrow("unknown");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const before = calls.length;
  let retried = false;
  const retry = client.retry().finally(() => {
    retried = true;
  });
  const rejectedRetry = expect(retry).rejects.toThrow("unknown");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(retried).toBe(false);
  expect(calls).toHaveLength(before);
  release(structuredClone(queue));
  await rejectedRecovery;
  await rejectedRetry;
  expect(client.snapshot().recovery).toBe("a");
  expect(client.canDrain()).toBe(false);
  expect(calls.filter((method) => method.endsWith(".claim"))).toHaveLength(1);
  expect(calls.some((method) => method.endsWith(".finish"))).toBe(false);
});

it("reconciles a superseded attachment export without adopting its stale cache", async () => {
  const environment = "superseded-attachment-host";
  recordRemoteCapabilities(environment, [ATTACHMENT_OWNERSHIP_CAPABILITY]);
  const queue: SharedQueue = { messages: [message("a")], revision: 1 };
  let blockRead = false;
  let release!: (value: SharedQueue) => void;
  const calls: string[] = [];
  const request: QueueTransport = async (method) => {
    calls.push(method);
    if (method === "attachments.claims") return { claims: [] } as never;
    if (method.startsWith("attachments.")) return undefined as never;
    if (blockRead) {
      blockRead = false;
      return new Promise((resolve) => {
        release = resolve as (value: SharedQueue) => void;
      });
    }
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient(
    "machine",
    environment,
    "attachment-chat",
    "desktop:attachments",
    request,
  );
  await client.initialize();
  await vi.waitFor(() => expect(calls).toContain("attachments.claims"));
  blockRead = true;
  const background = client.sync();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await client.retry();
  const previousInventories = calls.filter((method) => method === "attachments.claims").length;
  release({
    messages: [
      {
        ...message("stale"),
        attachments: [
          { id: "stale-file", name: "old.txt", kind: "file", mimeType: "text/plain", size: 1 },
        ],
      },
    ],
    revision: 0,
  });
  await background;
  await vi.waitFor(() =>
    expect(calls.filter((method) => method === "attachments.claims").length).toBeGreaterThan(
      previousInventories,
    ),
  );
  const scope = attachmentOwnershipScope(
    "machine",
    environment,
    attachmentOwnerId("desktop-queue", "attachment-chat"),
    request,
  );
  expect(scope.claimId("stale-file")).toBeUndefined();
  expect(client.snapshot().queue.messages.map((row) => row.id)).toEqual(["a"]);
});

it("shows queued messages on another computer and shares edits, order and deletion", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  const b = f.client("remote:b");
  await a.initialize();
  await b.initialize();
  a.update((queue) => enqueueRemoteMessage(queue, message("a")));
  a.update((queue) => enqueueRemoteMessage(queue, message("b")));
  await a.sync();
  await b.sync();
  expect(b.snapshot().queue.messages.map((row) => row.id)).toEqual(["a", "b"]);
  expect(a.canDrain()).toBe(true);
  expect(b.canDrain()).toBe(false);
  b.update((queue) => editRemoteMessage(queue, "a", "edited on pc2", []));
  b.update((queue) => reorderRemoteMessages(queue, ["b", "a"]));
  await b.sync();
  await a.sync();
  expect(a.snapshot().queue.messages.map((row) => row.text)).toEqual(["b", "edited on pc2"]);
  b.update((queue) => removeRemoteMessage(queue, "b"));
  await b.sync();
  await a.sync();
  expect(a.snapshot().queue.messages).toEqual([message("a", "edited on pc2")]);
});

it("keeps interactive retry behind an in-flight queue mutation", async () => {
  let queue: SharedQueue = { messages: [], revision: 0 };
  let release!: () => void;
  let changes = 0;
  let reads = 0;
  const request: QueueTransport = async (method, params) => {
    if (method.endsWith(".change")) {
      changes++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      queue = {
        ...mergeQueueChange(queue, {
          before: params.before as SharedQueue,
          after: params.after as SharedQueue,
        }),
        consumer: String(params.clientId),
        revision: queue.revision + 1,
      };
    } else if (method.endsWith(".get")) reads++;
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient(
    "machine",
    "host",
    "mutation-chat",
    "desktop:mutation",
    request,
  );
  await client.initialize();
  client.update((value) => enqueueRemoteMessage(value, message("a")));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(release).toBeTypeOf("function");
  const previousReads = reads;
  let retried = false;
  const interactive = client.retry().then(() => {
    retried = true;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(retried).toBe(false);
  expect(reads).toBe(previousReads);
  expect(changes).toBe(1);
  release();
  await interactive;
  expect(client.snapshot().queue.messages).toEqual([message("a")]);
  expect(changes).toBe(1);
  expect(client.canDrain()).toBe(true);
});

it("retains offline changes across a remount and applies them after reconnect", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  await a.initialize();
  f.offline(true);
  a.update((queue) => enqueueRemoteMessage(queue, message("offline")));
  await expect(a.sync()).rejects.toThrow("offline");
  expect(a.canDrain()).toBe(false);
  const restored = f.client("remote:new");
  f.offline(false);
  await restored.initialize();
  expect(f.queue().messages).toEqual([message("offline")]);
  expect(restored.canDrain()).toBe(true);
});

it("preserves a conflicting edit as a paused copy when the user retries", async () => {
  const f = fixture();
  const a = f.client("remote:a");
  const b = f.client("remote:b");
  await a.initialize({ messages: [message("a")], status: "active" });
  await b.initialize();
  a.update((queue) => editRemoteMessage(queue, "a", "first", []));
  await a.sync();
  b.update((queue) => editRemoteMessage(queue, "a", "second", []));
  await expect(b.sync()).rejects.toThrow(/another computer/);
  expect(b.snapshot().queue.messages[0].text).toBe("second");
  await b.retry();
  expect(f.queue().messages.map((row) => row.text)).toEqual(["first", "second"]);
  expect(f.queue().status).toBe("paused");
});

it("does not import stale backups into an already consumed host queue", async () => {
  const f = fixture();
  f.replace({ messages: [], revision: 12 });
  const a = f.client("remote:a");
  await a.initialize({ messages: [message("stale")], status: "restored" });
  expect(a.snapshot().queue.messages).toEqual([]);
});

it("restores unpublished local rows from the durable baseline without resurrecting a consumed row", async () => {
  const f = fixture();
  const a = f.client("desktop:a");
  await a.initialize({ messages: [message("consumed")], status: "active" });
  f.replace({ ...f.queue(), messages: [], status: undefined, revision: f.queue().revision + 1 });
  // The app restarted: the window keeps its identity, and with it its saved queue.
  const restored = f.client("desktop:a");
  await restored.initialize({
    messages: [message("consumed"), message("offline-new")],
    status: "restored",
  });
  expect(f.queue().messages).toEqual([message("offline-new")]);
  expect(f.queue().status).toBe("restored");
});

it("keeps host and session identities separate in its durable outbox", async () => {
  const f = fixture();
  const a = f.client("remote:a", "chat", "one");
  await a.initialize();
  f.offline(true);
  a.update((queue) => enqueueRemoteMessage(queue, message("one")));
  await expect(a.sync()).rejects.toThrow();
  const other = f.client("remote:b", "chat", "two");
  f.offline(false);
  await other.initialize();
  expect(other.snapshot().queue.messages).toEqual([]);
});

it("recovers an acknowledged desktop send after a lost finish response", async () => {
  const f = fixture();
  const a = f.client("desktop:a");
  await a.initialize({ messages: [message("a")], status: "active" });
  const token = await a.claim("a", false);
  f.offline(true);
  await expect(a.finish(token!, true)).rejects.toThrow();
  // The app restarted: the window keeps its identity, and with it its saved queue.
  const restored = f.client("desktop:a");
  f.offline(false);
  await restored.initialize();
  expect(restored.snapshot().queue.messages).toEqual([]);
});

it("atomically claims host-owned queue views on every reply and releases only after durable consume", async () => {
  recordRemoteCapabilities("managed-view-host", [ATTACHMENT_OWNERSHIP_CAPABILITY]);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let queue: SharedQueue = {
    revision: 1,
    consumer: "remote:managed-view",
    messages: [
      {
        id: "row",
        text: "queued",
        attachments: [
          {
            id: "host-file",
            name: "a.txt",
            kind: "file",
            mimeType: "text/plain",
            size: 1,
            hostEnvironmentId: "managed-view-host",
          },
        ],
      },
    ],
  };
  const request: QueueTransport = async (method, params) => {
    calls.push({ method, params });
    if (method === "attachments.claims") return { claims: [] } as never;
    if (method === "sessions.queue.claim")
      queue = { ...queue, claim: { id: "row", clientId: "remote:managed-view", token: "held" } };
    if (method === "sessions.queue.finish") queue = { ...queue, claim: undefined, messages: [] };
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient(
    "managed-view-machine",
    "managed-view-host",
    "managed-view-session",
    "remote:managed-view",
    request,
    vi.fn(async (_machine, files) => files),
  );
  await client.initialize();
  const snapshot = client.snapshot();
  expect(snapshot.queue.messages[0].attachments[0].id).toBe("host-file");
  expect(calls[0]).toMatchObject({
    method: "sessions.queue.get",
    params: { ownerId: expect.any(String), claimId: expect.any(String) },
  });
  const token = await client.claim("row", false);
  expect(token).toBe("held");
  expect(calls.some((call) => call.method === "attachments.release")).toBe(false);
  await client.finish(token!, true);
  await vi.waitFor(() =>
    expect(calls.some((call) => call.method === "attachments.release")).toBe(true),
  );
  for (const call of calls.filter((call) => call.method.startsWith("sessions.queue.")))
    expect(call.params).toMatchObject({ ownerId: expect.any(String), claimId: expect.any(String) });
});

it("hands closed-window queue claims to durable global drafts and retires them after that draft clears", async () => {
  recordRemoteCapabilities("closed-queue-host", [ATTACHMENT_OWNERSHIP_CAPABILITY]);
  let draftIds = ["exported-file"];
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "session_attachment_references" ? { draftIds, queues: {} } : undefined,
  );
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const request: QueueTransport = async (method, params) => {
    calls.push({ method, params });
    return (
      method === "attachments.claims" ? { claims: [] } : { messages: [], revision: 0 }
    ) as never;
  };
  const oldOwner = JSON.stringify(["desktop-queue", "closed-queue-session", "closed-window"]);
  await attachmentOwnershipScope(
    "closed-queue-machine",
    "closed-queue-host",
    oldOwner,
    request,
  ).acquire("cache", ["exported-file"]);
  const client = new SharedQueueClient(
    "closed-queue-machine",
    "closed-queue-host",
    "closed-queue-session",
    "remote:closed",
    request,
    vi.fn(async (_machine, files) => files),
  );
  try {
    await client.initialize();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) => call.method === "attachments.release" && call.params.ownerId === oldOwner,
        ),
      ).toBe(true),
    );
    const newClaim = calls.find(
      (call) => call.method === "attachments.claim" && call.params.ownerId !== oldOwner,
    );
    expect(newClaim?.params.ids).toEqual(["exported-file"]);
    expect(
      calls.some(
        (call) =>
          call.method === "attachments.release" && call.params.ownerId === newClaim?.params.ownerId,
      ),
    ).toBe(false);
    draftIds = [];
    await client.sync();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "attachments.release" &&
            call.params.ownerId === newClaim?.params.ownerId,
        ),
      ).toBe(true),
    );
  } finally {
    vi.mocked(invoke).mockImplementation(original);
  }
});

it("claims again against the new revision when another computer changed the queue first", async () => {
  const clientId = "desktop:racing";
  let queue: SharedQueue = {
    messages: [message("a")],
    revision: 1,
    consumer: clientId,
    status: "active",
  };
  let claims = 0;
  const request: QueueTransport = async (method, params) => {
    if (method.endsWith(".claim")) {
      claims++;
      // The other computer appends after the desktop read and before its claim lands.
      if (claims === 1) queue = { ...queue, revision: 2, messages: [message("a"), message("b")] };
      if (params.revision !== queue.revision)
        throw new Error("The shared queue changed. Refresh it before sending.");
      queue = {
        ...queue,
        revision: queue.revision + 1,
        claim: { id: String(params.id), clientId, token: "token" },
      };
    }
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient("machine", "host", "racing-chat", clientId, request);
  await client.initialize();
  expect(await client.claim("a", false)).toBe("token");
  expect(claims).toBe(2);
});

it("stops retrying a claim that keeps being refused and reports the refusal", async () => {
  const clientId = "desktop:racing";
  let queue: SharedQueue = {
    messages: [message("a")],
    revision: 1,
    consumer: clientId,
    status: "active",
  };
  let claims = 0;
  const request: QueueTransport = async (method) => {
    if (method.endsWith(".claim")) {
      claims++;
      queue = { ...queue, revision: queue.revision + 1 };
      throw new Error("The shared queue changed. Refresh it before sending.");
    }
    return structuredClone(queue) as never;
  };
  const client = new SharedQueueClient("machine", "host", "racing-chat", clientId, request);
  await client.initialize();
  await expect(client.claim("a", false)).rejects.toThrow(/shared queue changed/);
  expect(claims).toBeLessThan(10);
});

it("reports an unconfirmed send from its journal, but not while no send was started", async () => {
  const f = fixture();
  const a = f.client("desktop:a");
  await a.initialize({ messages: [message("a")], status: "active" });
  expect(await a.unconfirmed()).toBe(false);
  expect(await a.claim("a", false)).toBe("token");
  expect(await a.unconfirmed()).toBe(true);
  expect(a.snapshot().recovery).toBe("a");
  await a.resolveRecovery(true);
  expect(await a.unconfirmed()).toBe(false);
  expect(f.queue().messages).toEqual([]);
});

/** The host's durable queue behind its real RPC surface, with a clock the test moves. */
function leasedHost() {
  const clock = { at: 5_000_000 };
  const queues = new SessionQueues(database(), () => clock.at);
  const request: QueueTransport = async (method, params) => {
    const action = method.split(".").pop() as "get" | "change" | "claim" | "finish" | "lease";
    vi.setSystemTime(clock.at);
    return structuredClone(
      await queues.serve(
        action,
        String(params.sessionId),
        String(params.clientId),
        params,
        action === "change" ? { before: params.before, after: params.after } : undefined,
      ),
    ) as never;
  };
  const client = (id: string) =>
    new SharedQueueClient("machine", "host", "chat", id, request, async (_m, files) => files);
  return { clock, queues, client };
}
const waitingRow = (id: string) => ({ id, text: id, attachments: [] });

describe("acknowledgement replay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
  });
  afterEach(() => vi.useRealTimers());

  /** A host whose reply to `finish` can be lost after it applied the change. */
  function lossyHost() {
    const host = leasedHost();
    let lose = false;
    const request: QueueTransport = async (method, params) => {
      const action = method.split(".").pop() as "get" | "change" | "claim" | "finish" | "lease";
      const reply = structuredClone(
        await host.queues.serve(
          action,
          String(params.sessionId),
          String(params.clientId),
          params,
          action === "change" ? { before: params.before, after: params.after } : undefined,
        ),
      );
      if (lose && action === "finish") throw new Error("reply lost");
      return reply as never;
    };
    return {
      ...host,
      loseNextFinish: () => {
        lose = true;
      },
      reachable: () => {
        lose = false;
      },
      client: (id: string) =>
        new SharedQueueClient("machine", "host", "chat", id, request, async (_m, files) => files),
    };
  }
  const sendKey = (id: string) =>
    `bycoda:shared-queue:v2:${JSON.stringify(["host", "chat", id])}:send`;
  const twoRows = (queue: { messages: unknown[] }) => ({
    ...queue,
    messages: [waitingRow("a"), waitingRow("b")],
    status: "active" as const,
  });

  it("does not pause the queue when a delivered send is replayed after its reply was lost", async () => {
    const host = lossyHost();
    const first = host.client("desktop:win");
    await first.initialize();
    first.update(twoRows);
    await first.sync();
    const token = await first.claim("a", false);
    host.loseNextFinish();
    await expect(first.finish(token!, true)).rejects.toThrow("reply lost");
    host.reachable();
    // The app restarted before it learned the host had applied the change.
    const restarted = host.client("desktop:win");
    await restarted.initialize();
    expect(restarted.snapshot().error).toBeUndefined();
    expect(restarted.snapshot().recovery).toBeUndefined();
    expect((await host.queues.get("chat")).messages.map((row) => row.id)).toEqual(["b"]);
    expect((await host.queues.get("chat")).status).toBe("active");
    expect(restarted.canDrain()).toBe(true);
  });

  it("still holds the queue when a refused send is replayed", async () => {
    const host = lossyHost();
    const first = host.client("desktop:win");
    await first.initialize();
    first.update(twoRows);
    await first.sync();
    const token = await first.claim("a", false);
    host.loseNextFinish();
    await expect(first.finish(token!, false)).rejects.toThrow("reply lost");
    host.reachable();
    const restarted = host.client("desktop:win");
    await restarted.initialize();
    await restarted.sync();
    expect((await host.queues.get("chat")).messages.map((row) => row.id)).toEqual(["a", "b"]);
    expect((await host.queues.get("chat")).status).toBe("paused");
  });

  it("does not pause the queue when a wait for the host is replayed", async () => {
    const host = lossyHost();
    const first = host.client("desktop:win");
    await first.initialize();
    first.update(twoRows);
    await first.sync();
    const token = await first.claim("a", false);
    host.loseNextFinish();
    // Not accepted, but not a refusal either: the host was busy with its own turn.
    await expect(first.finish(token!, false, false)).rejects.toThrow("reply lost");
    host.reachable();
    const restarted = host.client("desktop:win");
    await restarted.initialize();
    expect((await host.queues.get("chat")).status).toBe("active");
  });

  it("settles a replay against a host that moved on, instead of failing every later read", async () => {
    const host = lossyHost();
    const first = host.client("desktop:win");
    await first.initialize();
    first.update(twoRows);
    await first.sync();
    const token = await first.claim("a", false);
    host.loseNextFinish();
    await expect(first.finish(token!, true)).rejects.toThrow("reply lost");
    host.reachable();
    // Meanwhile another send went through, so the host's record of this token is gone.
    const current = await host.queues.get("chat");
    const next = await host.queues.claim("chat", "b", "desktop:win", current.revision, false, {
      epoch: current.drain!.epoch,
    });
    await host.queues.finish("chat", next.claim!.token, true);
    const restarted = host.client("desktop:win");
    await restarted.initialize();
    expect(restarted.snapshot().error).toBeUndefined();
    expect(restarted.snapshot().recovery).toBeUndefined();
    expect(localStorage.getItem(sendKey("desktop:win"))).toBeNull();
  });

  it("takes the queue over from a live holder on request, without changing it", async () => {
    const host = lossyHost();
    const first = host.client("desktop:one");
    await first.initialize();
    first.update((queue) => ({ ...queue, messages: [waitingRow("a")], status: "active" }));
    await first.sync();
    const second = host.client("desktop:two");
    await second.initialize();
    expect(second.heldByOther()).toBe(true);
    await second.takeOver();
    expect(second.canDrain()).toBe(true);
    expect(second.heldByOther()).toBe(false);
    expect(await host.queues.get("chat")).toMatchObject({
      messages: [waitingRow("a")],
      status: "active",
      drain: { holder: "desktop:two", epoch: 2 },
    });
  });
});

describe("drain lease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("lets a desktop that sees waiting work take the lease, and never a remote computer", async () => {
    const host = leasedHost();
    const mac = host.client("remote:mac");
    await mac.initialize();
    mac.update((queue) => enqueueRemoteMessage(queue, waitingRow("m1")));
    await mac.sync();
    expect((await host.queues.get("chat")).drain).toBeUndefined();
    expect(mac.canDrain()).toBe(false);
    expect(mac.hostDrains()).toBe(true);
    const desktop = host.client("desktop:win");
    await desktop.initialize();
    expect(desktop.canDrain()).toBe(true);
    expect((await host.queues.get("chat")).drain).toMatchObject({
      holder: "desktop:win",
      epoch: 1,
    });
    expect(desktop.heldLease()).toEqual({ sessionId: "chat", epoch: 1 });
    expect(desktop.dispatch("m1")).toMatchObject({ leaseAware: true, epoch: 1 });
    // The Mac sees who holds it, and may still send a row it picked itself.
    await mac.sync();
    expect(mac.heldByOther()).toBe(true);
    expect(mac.canSendSelected()).toBe(false);
  });

  it("leaves a live lease to its holder, and takes the queue over only when asked to", async () => {
    const host = leasedHost();
    const first = host.client("desktop:one");
    await first.initialize();
    first.update((queue) => enqueueRemoteMessage(queue, waitingRow("a")));
    await first.sync();
    const second = host.client("desktop:two");
    await second.initialize();
    expect(second.canDrain()).toBe(false);
    expect(second.heldByOther()).toBe(true);
    // Resume: an explicit takeover.
    second.update((queue) => ({ ...queue, status: "active" }), true);
    await second.sync();
    expect(second.canDrain()).toBe(true);
    expect((await host.queues.get("chat")).drain).toMatchObject({
      holder: "desktop:two",
      epoch: 2,
    });
    // The first window finds it has lost the queue.
    await first.sync();
    expect(first.canDrain()).toBe(false);
    await expect(first.claim("a", false)).resolves.toBeUndefined();
  });

  it("stops draining the moment the heartbeat says the lease is gone, and when the lease ran out unrenewed", async () => {
    const host = leasedHost();
    const desktop = host.client("desktop:win");
    await desktop.initialize();
    desktop.update((queue) => enqueueRemoteMessage(queue, waitingRow("a")));
    await desktop.sync();
    expect(desktop.canDrain()).toBe(true);
    desktop.noteLease({ holder: "desktop:win", epoch: 1, expiresAt: Date.now() + 60_000 });
    vi.advanceTimersByTime(30_000);
    expect(desktop.canDrain()).toBe(true); // renewed by the heartbeat
    desktop.noteLease(null);
    expect(desktop.canDrain()).toBe(false);
    expect(desktop.heldLease()).toBeUndefined();
    // The next look takes it back under a new epoch.
    host.clock.at += QUEUE_LEASE_TTL_MS + 1_000;
    await desktop.sync();
    expect(desktop.canDrain()).toBe(true);
    expect((await host.queues.get("chat")).drain?.epoch).toBe(2);
    // Without renewals the client itself stops trusting its lease at expiry.
    vi.advanceTimersByTime(QUEUE_LEASE_TTL_MS + 5_000);
    expect(desktop.canDrain()).toBe(false);
  });

  it("keeps the lease of a hidden window that beats only about once a minute", async () => {
    const host = leasedHost();
    const desktop = host.client("desktop:win");
    await desktop.initialize();
    desktop.update((queue) => enqueueRemoteMessage(queue, waitingRow("a")));
    await desktop.sync();
    const lease = (await host.queues.get("chat")).drain!;
    // Three throttled beats in a row, each a minute after the last.
    for (let beat = 0; beat < 3; beat++) {
      host.clock.at += 60_000;
      expect(host.queues.live(await host.queues.get("chat"))).toBe(true);
      expect(await host.queues.renew("chat", "desktop:win", lease.epoch)).not.toBeNull();
    }
    expect((await host.queues.get("chat")).drain?.epoch).toBe(lease.epoch);
  });

  it("passes the host's extra bookkeeping along without tripping over it", async () => {
    const host = leasedHost();
    const plain = host.client("desktop:win");
    const request: QueueTransport = async (method, params) => {
      const reply = (await (plain as unknown as { request: QueueTransport }).request(
        method,
        params,
      )) as SharedQueue & Record<string, unknown>;
      return {
        ...reply,
        holdReason: "Provider crashed",
        ...(reply.claim ? { claim: { ...reply.claim, at: 1, legacy: true } } : {}),
        ...(reply.drain ? { drain: { ...reply.drain, legacy: true } } : {}),
        settled: { token: "old", clientId: "desktop:win", accepted: true, prior: "active" },
      } as never;
    };
    const client = new SharedQueueClient(
      "machine",
      "host",
      "chat",
      "desktop:win",
      request,
      async (_m, files) => files,
    );
    await client.initialize();
    client.update((queue) => ({
      ...enqueueRemoteMessage(queue, waitingRow("a")),
      status: "active",
    }));
    await client.sync();
    const token = await client.claim("a", false);
    expect(token).toBeDefined();
    await client.finish(token!, true);
    expect(client.snapshot().error).toBeUndefined();
    expect(client.snapshot().queue.messages).toEqual([]);
    expect((client.snapshot().queue as SharedQueue).holdReason).toBe("Provider crashed");
  });

  it("judges the lease by the host's clock, however far apart the two clocks are", async () => {
    const host = leasedHost();
    host.clock.at += 3_600_000; // the host runs an hour ahead of this computer
    const desktop = host.client("desktop:win");
    await desktop.initialize();
    desktop.update((queue) => enqueueRemoteMessage(queue, waitingRow("a")));
    await desktop.sync();
    expect(desktop.canDrain()).toBe(true);
  });
});

describe("desktop window storage", () => {
  beforeEach(() => localStorage.clear());
  it("keeps one saved queue per window, and hands the old shared one to the first window that starts", async () => {
    const f = fixture();
    const oldKey = `bycoda:shared-queue:v1:${JSON.stringify(["host", "chat", "desktop"])}`;
    const saved = { base: { messages: [], revision: 0 }, desired: { messages: [message("kept")] } };
    localStorage.setItem(oldKey, JSON.stringify(saved));
    const first = f.client("desktop:one");
    expect(first.snapshot().queue.messages).toEqual([message("kept")]);
    // A second window does not read the first one's pending edits.
    const second = f.client("desktop:two");
    expect(second.snapshot().queue.messages).toEqual([]);
  });

  it("copies the old queue and send journal instead of moving them, so a downgrade keeps pending state", async () => {
    const f = fixture();
    const oldKey = `bycoda:shared-queue:v1:${JSON.stringify(["host", "chat", "desktop"])}`;
    const saved = { base: { messages: [], revision: 0 }, desired: { messages: [message("kept")] } };
    const journal = { token: "t", clientId: "desktop", accepted: null };
    localStorage.setItem(oldKey, JSON.stringify(saved));
    localStorage.setItem(`${oldKey}:send`, JSON.stringify(journal));
    f.client("desktop:one");
    f.client("desktop:two");
    // An older build still finds exactly what it saved.
    expect(JSON.parse(localStorage.getItem(oldKey)!)).toEqual(saved);
    expect(JSON.parse(localStorage.getItem(`${oldKey}:send`)!)).toEqual(journal);
    // And only the first window adopted it.
    const v2 = (id: string) =>
      localStorage.getItem(`bycoda:shared-queue:v2:${JSON.stringify(["host", "chat", id])}`);
    expect(v2("desktop:one")).toEqual(JSON.stringify(saved));
    expect(v2("desktop:two")).toBeNull();
  });
});

describe("one host, two computers (review round 2)", () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id, text: id, attachments: [] }));
  function hosted(lose?: { claimReply?: boolean }) {
    const queues = new SessionQueues(database(), () => Date.now());
    const calls: string[] = [];
    const request: QueueTransport = async (method, params) => {
      const action = method.split(".").pop() as "get";
      calls.push(action);
      const reply = structuredClone(
        await queues.serve(
          action,
          String(params.sessionId),
          String(params.clientId),
          params,
          action === ("change" as string)
            ? { before: params.before, after: params.after }
            : undefined,
        ),
      );
      if (lose?.claimReply && action === ("claim" as string)) {
        lose.claimReply = false;
        throw new Error("reply lost");
      }
      return reply as never;
    };
    const make = (id: string) =>
      new SharedQueueClient("machine", "host", "chat", id, request, async (_m, files) => files);
    return { queues, calls, make };
  }

  it("does not pause the queue when only the reply to a claim was lost", async () => {
    const lose = { claimReply: false };
    const { queues, make } = hosted(lose);
    const desk = make("desktop:win");
    await desk.initialize();
    desk.update((queue) => ({ ...queue, messages: rows("a", "b"), status: "active" }));
    await desk.sync();
    lose.claimReply = true;
    await expect(desk.claim("a", false)).rejects.toThrow("reply lost");
    await desk.sync(true);
    expect((await queues.get("chat")).status).toBe("active");
    expect((await queues.get("chat")).claim).toBeUndefined();
    expect((await queues.get("chat")).messages.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("settles a competing edit by itself: kept as a new message, queue paused, reason shown", async () => {
    const { queues, make } = hosted();
    const desk = make("desktop:win");
    const mac = make("remote:mac");
    await desk.initialize();
    await mac.initialize();
    desk.update((queue) => ({ ...queue, messages: rows("a"), status: "active" }));
    await desk.sync();
    await mac.sync();
    mac.update((queue) => editRemoteMessage(queue, "a", "from the mac", []));
    await mac.sync();
    desk.update((queue) => editRemoteMessage(queue, "a", "from the desktop", []));
    await desk.sync().catch(() => {});
    await desk.sync();
    expect(desk.snapshot().error).toBeUndefined();
    expect(desk.snapshot().notice).toMatch(/another computer/i);
    expect((await queues.get("chat")).status).toBe("paused");
    expect((await queues.get("chat")).messages.map((row) => row.text).sort()).toEqual([
      "from the desktop",
      "from the mac",
    ]);
    // Syncing goes on: a later edit is accepted again.
    expect(desk.update((queue) => queue)).toBe(true);
  });

  it("a Stop pressed while a send is unsettled pauses the queue when a late success arrives", async () => {
    const { queues, make } = hosted();
    const desk = make("desktop:win");
    await desk.initialize();
    desk.update((queue) => ({ ...queue, messages: rows("a", "b"), status: "active" }));
    await desk.sync();
    const token = (await desk.claim("a", false))!;
    desk.noteStop();
    await desk.finish(token, true);
    expect((await queues.get("chat")).messages.map((row) => row.id)).toEqual(["b"]);
    expect((await queues.get("chat")).status).toBe("paused");
  });

  it("gives its lease back, and stops asking a host that has no such call", async () => {
    const calls: string[] = [];
    let unsupported = false;
    const base = hosted();
    const request: QueueTransport = async (method, params) => {
      if (method.endsWith(".release")) {
        calls.push(`release@${String(params.epoch)}`);
        if (unsupported) throw new Error("unknown method sessions.queue.release");
        return null as never;
      }
      const action = method.split(".").pop() as "get";
      return structuredClone(
        await base.queues.serve(
          action,
          String(params.sessionId),
          String(params.clientId),
          params,
          action === ("change" as string)
            ? { before: params.before, after: params.after }
            : undefined,
        ),
      ) as never;
    };
    const desk = new SharedQueueClient(
      "machine",
      "host",
      "chat",
      "desktop:win",
      request,
      async (_m, f) => f,
    );
    await desk.initialize();
    desk.update((queue) => ({ ...queue, messages: rows("a"), status: "active" }), true);
    await desk.sync();
    const lease = desk.heldLease();
    expect(lease).toBeDefined();
    await desk.releaseLease();
    expect(calls).toEqual([`release@${lease!.epoch}`]);
    expect(desk.heldLease()).toBeUndefined();
    unsupported = true;
    const other = new SharedQueueClient(
      "machine",
      "host",
      "other",
      "desktop:win",
      request,
      async (_m, f) => f,
    );
    await other.initialize();
    other.update((queue) => ({ ...queue, messages: rows("a"), status: "active" }), true);
    await other.sync();
    await other.releaseLease();
    await other.releaseLease();
    expect(calls.length).toBe(2); // the second attempt is not repeated
  });
});
