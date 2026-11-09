import { expect, it, vi } from "vitest";
import { SessionsQueueFinishParamsSchema } from "../../../shared/model/host-contracts/session-queue";
import { finishQueueAcknowledgement, type SendJournal } from "./sharedQueueAcknowledgement";
import type { SharedQueue } from "./sharedQueue";
import { createSessionQueueService } from "../../../../host/domains/sessions/queue-service";

const journal: SendJournal = {
  token: "token",
  id: "row",
  clientId: "desktop:one",
  accepted: false,
  held: false,
  stopped: true,
};
const queue: SharedQueue = {
  messages: [{ id: "row", text: "retained", attachments: [] }],
  revision: 1,
};

it("reconciles a lost accepted reply through the domain after another client advances", async () => {
  const advanced: SharedQueue = {
    messages: [],
    revision: 4,
    settled: { token: "next-token", clientId: "desktop:two", accepted: true },
  };
  const serve = vi.fn(async (..._args: unknown[]) => advanced);
  const service = createSessionQueueService({
    environmentId: "environment",
    transaction: async (work) => work(),
    sessionStatus: async () => "idle",
    desktopWatch: async () => undefined,
    queues: { get: async () => advanced, serve },
    attachments: { validateExposure: async () => {}, normalize: () => [] },
  });
  const context = { authorized: async () => true, exposeAttachments: async () => {} };
  const call = vi.fn(async (action: string, params?: Record<string, unknown>) => {
    const input = { sessionId: "session", clientId: journal.clientId, ...params };
    return action === "finish" ? service.finish(input, context) : service.get(input, context);
  });
  await expect(finishQueueAcknowledgement({ ...journal, accepted: true }, call)).resolves.toEqual({
    value: advanced,
  });
  expect(call.mock.calls.map(([action]) => action)).toEqual(["finish", "get"]);
  expect(serve).toHaveBeenCalledTimes(1);
  expect(serve.mock.calls[0]?.[0]).toBe("get");
});

it("sends only strict contract fields and preserves a proven pre-write wait", async () => {
  const call = vi.fn(async (_action: string, params?: Record<string, unknown>) => {
    SessionsQueueFinishParamsSchema.parse({
      sessionId: "session",
      clientId: journal.clientId,
      ...params,
    });
    return queue;
  });
  await expect(finishQueueAcknowledgement(journal, call)).resolves.toEqual({ value: queue });
  expect(call).toHaveBeenCalledWith("finish", {
    clientId: journal.clientId,
    token: "token",
    accepted: false,
    deferred: true,
  });
});

it.each([undefined, true])("never treats held=%s as proof of no provider write", async (held) => {
  const call = vi.fn(async () => queue);
  await finishQueueAcknowledgement({ ...journal, held }, call);
  expect(call).toHaveBeenCalledWith("finish", {
    clientId: journal.clientId,
    token: "token",
    accepted: false,
  });
});

it("retains the journal on running-turn recovery refusal", async () => {
  const call = vi.fn(async () => {
    throw new Error("Wait for the running turn");
  });
  await expect(finishQueueAcknowledgement({ ...journal, held: true }, call)).rejects.toThrow(
    "running turn",
  );
  expect(call).toHaveBeenCalledTimes(1);
});

it.each([
  "Queued send no longer belongs to this client.",
  "Queued send belongs to another client.",
])("reconciles an old acknowledgement after %s", async (error) => {
  const call = vi.fn(async (action: string) => {
    if (action === "finish") throw new Error(error);
    return queue;
  });
  await expect(finishQueueAcknowledgement({ ...journal, accepted: true }, call)).resolves.toEqual({
    value: queue,
    remove: "row",
  });
  await expect(finishQueueAcknowledgement(journal, call)).resolves.toEqual({ value: queue });
});

it.each([
  "Queued send no longer belongs to this client.",
  "Queued send belongs to another client.",
])("retains the same-token acknowledgement after %s", async (error) => {
  const call = async (action: string) => {
    if (action === "finish") throw new Error(error);
    return { ...queue, claim: { token: "token", id: "row", clientId: journal.clientId } };
  };
  await expect(finishQueueAcknowledgement(journal, call)).rejects.toThrow(error);
});
