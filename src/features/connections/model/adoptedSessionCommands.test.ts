// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { sendAdoptedFollowUp, cancelAdoptedTurn } from "./adoptedSessionCommands";
import { DeliveryUnknownError } from "../../../shared/lib/deliveryUnknown";
import { QueueDeferredError } from "./sharedQueue";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  request: vi.fn(),
  upload: vi.fn(),
  wake: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("./connections", () => ({
  remoteRequest: io.request,
  loadRemoteCapabilities: io.capabilities,
}));
vi.mock("./remoteAttachments", () => ({ uploadRemoteAttachments: io.upload }));
vi.mock("./sharedQueueClient", () => ({ desktopQueueClientId: "desktop:this-window" }));
vi.mock("./hostWake", () => ({ noteAdoptedBeat: io.wake }));
const running = {
  status: "running",
  runId: "host-run",
  desktop: { updatedAt: 0 },
  executionOwner: "host",
};
let snapshot: (typeof running | { status: string; runId?: string; executionOwner?: string }) & {
  authorityGeneration?: number;
};
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = running;
  io.invoke.mockResolvedValue([
    { id: "local", localHost: true, endpoint: "http://127.0.0.1:3776", environmentId: "home" },
  ]);
  io.upload.mockResolvedValue([]);
  io.capabilities.mockResolvedValue([
    "sessions.steer",
    "commands.status",
    "sessions.queue.claimDispatch",
  ]);
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "sessions.queue.get") return { revision: 7, messages: [] };
    if (method === "commands.dispatch") return { commandId: "accepted" };
    return null;
  });
});
const input = () => ({ sessionId: "s", text: "follow-up", attachments: [], isCurrent: () => true });

it("retains a claimed row on an older Host without attempting an incompatible command", async () => {
  io.capabilities.mockResolvedValue(["sessions.steer", "commands.status"]);
  io.request.mockImplementation(async (_machine, method) =>
    method === "sessions.get"
      ? snapshot
      : { revision: 7, claim: { id: "q", clientId: "desktop:this-window", token: "claim" } },
  );
  await expect(sendAdoptedFollowUp({ ...input(), queuedMessageId: "q" })).rejects.toBeInstanceOf(
    QueueDeferredError,
  );
  expect(io.request.mock.calls.some(([, method]) => method === "commands.dispatch")).toBe(false);
});

it("keeps a definitive validation refusal distinct from a coordination wait", async () => {
  const refusal = Object.assign(new Error("RPC_WS_VALIDATION: Invalid attachment"), {
    code: "RPC_WS_VALIDATION",
  });
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    throw refusal;
  });
  await expect(sendAdoptedFollowUp(input())).rejects.toBe(refusal);
});

it("passes the existing desktop claim and drain epoch to the Host", async () => {
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "sessions.queue.get")
      return {
        revision: 7,
        messages: [],
        leased: true,
        drain: { holder: "desktop:this-window", epoch: 3 },
        claim: { id: "q", clientId: "desktop:this-window", token: "claim" },
      };
    return { commandId: "accepted" };
  });
  expect(await sendAdoptedFollowUp({ ...input(), queuedMessageId: "q" })).toBe(true);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({
      queued: {
        id: "q",
        clientId: "desktop:this-window",
        revision: 7,
        selected: true,
        leaseAware: true,
        epoch: 3,
        claimToken: "claim",
      },
    }),
  );
});

it("retains creation-time generation through upload and final live-run lookup", async () => {
  snapshot = { ...running, authorityGeneration: 2 };
  io.upload.mockImplementation(async () => {
    snapshot = { ...running, authorityGeneration: 3 };
    return [];
  });
  expect(await sendAdoptedFollowUp({ ...input(), authorityGeneration: 2 })).toBe(true);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({ authorityGeneration: 2 }),
  );
});

it("never blesses an old queued intent or Stop from a newly read authority floor", async () => {
  snapshot = { ...running, authorityGeneration: 3 };
  await sendAdoptedFollowUp({ ...input(), queuedMessageId: "old-row" });
  const dispatched = io.request.mock.calls.find(([, method]) => method === "commands.dispatch")![2];
  expect(dispatched).not.toHaveProperty("authorityGeneration");
  io.request.mockClear();
  await cancelAdoptedTurn("s", "host-run", 2);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({ authorityGeneration: 2 }),
  );
});
it("steers the home host despite its desktop sharing marker, without a local provider run", async () => {
  expect(await sendAdoptedFollowUp(input())).toBe(true);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({ type: "steer", runId: "host-run", text: "follow-up" }),
  );
  expect(io.wake).toHaveBeenCalledWith({ ids: ["s"], reset: false });
});
it("uses the final run after upload, and sends through the same host if that run finished", async () => {
  io.upload.mockImplementation(async () => {
    snapshot = { status: "idle" };
    return [];
  });
  expect(await sendAdoptedFollowUp(input())).toBe(true);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({ type: "send", sessionId: "s" }),
  );
});
it("atomically consumes the selected queued row on its host instead of locally claiming it", async () => {
  expect(await sendAdoptedFollowUp({ ...input(), queuedMessageId: "row" })).toBe(true);
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({
      queued: { id: "row", clientId: "desktop:this-window", revision: 7, selected: true },
    }),
  );
});
it("does not send after Stop or a conflicting edit during preparation", async () => {
  expect(await sendAdoptedFollowUp({ ...input(), isCurrent: () => false })).toBe(false);
  expect(io.request.mock.calls.some(([, method]) => method === "commands.dispatch")).toBe(false);
});
it("never substitutes a second command when the dispatch acknowledgement is lost", async () => {
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "commands.dispatch") throw new Error("connection closed");
    if (method === "commands.status") return { commandId: "recovered" };
  });
  expect(await sendAdoptedFollowUp(input())).toBe(true);
  expect(io.request.mock.calls.filter(([, method]) => method === "commands.dispatch")).toHaveLength(
    1,
  );
});
it("holds ambiguous delivery for review when no receipt can be recovered", async () => {
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "commands.dispatch") throw new Error("connection closed");
    return null;
  });
  await expect(sendAdoptedFollowUp(input())).rejects.toBeInstanceOf(DeliveryUnknownError);
});
it("does not steer a desktop-owned turn even when its synchronization marker looks the same", async () => {
  snapshot = { ...running, executionOwner: "desktop", runId: "desktop" };
  await expect(sendAdoptedFollowUp(input())).rejects.toBeInstanceOf(QueueDeferredError);
  expect(io.request.mock.calls.some(([, method]) => method === "commands.dispatch")).toBe(false);
});

it("defers a command proven not sent without marking its delivery unknown", async () => {
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "commands.dispatch")
      throw Object.assign(new Error("RPC_WS_OVERLOAD: busy"), { code: "RPC_WS_OVERLOAD" });
    return null;
  });
  await expect(sendAdoptedFollowUp(input())).rejects.toBeInstanceOf(QueueDeferredError);
  expect(io.request.mock.calls.some(([, method]) => method === "commands.status")).toBe(false);
});

it("defers a host run race without pausing the follow-up queue", async () => {
  io.request.mockImplementation(async (_machine, method) => {
    if (method === "sessions.get") return snapshot;
    if (method === "commands.dispatch")
      throw new Error(
        "Host rejected request: This desktop-owned turn cannot be redirected through the host. Queue the message or stop it first.",
      );
    return null;
  });
  await expect(sendAdoptedFollowUp(input())).rejects.toBeInstanceOf(QueueDeferredError);
});
it("fences Stop to the host run rather than stopping a local provider", async () => {
  await cancelAdoptedTurn("s");
  expect(io.request).toHaveBeenCalledWith(
    "local",
    "commands.dispatch",
    expect.objectContaining({ type: "cancel", runId: "host-run" }),
  );
});
it("does not stop a successor that replaced the mirrored host run", async () => {
  await cancelAdoptedTurn("s", "previous-run");
  expect(io.request.mock.calls.some(([, method]) => method === "commands.dispatch")).toBe(false);
});
it("guards duplicate submissions for the entire upload and acknowledgement", async () => {
  let finish!: () => void;
  io.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
  );
  const first = sendAdoptedFollowUp(input());
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(await sendAdoptedFollowUp(input())).toBe(false);
  finish();
  expect(await first).toBe(true);
  expect(io.request.mock.calls.filter(([, method]) => method === "commands.dispatch")).toHaveLength(
    1,
  );
});
