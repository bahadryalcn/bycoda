import { expect, it } from "vitest";
import { handleSessionsRpc } from "./rpc-sessions";

type Gate = { promise: Promise<unknown>; resolve: (value: unknown) => void };

function gate(): Gate {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => (resolve = done));
  return { promise, resolve };
}

it("starts the independent desktop heartbeat parts together and keeps the result shape", async () => {
  const started: string[] = [];
  const gates = {
    deletions: gate(),
    inbox: gate(),
    adopted: gate(),
    queueLeases: gate(),
  };
  const waitFor = (name: keyof typeof gates) => {
    started.push(name);
    return gates[name].promise;
  };
  const dependencies = {
    desktop: { live: { beat: () => ({ commands: [{ id: "live" }] }) } },
    pushNotifications: { desktopPresence: () => undefined },
    desktopCommandDelivery: { poll: async () => [{ id: "durable" }] },
    renewRunLeases: async () => ({ s1: null }),
    heartbeatEffects: Promise.resolve(),
    withinBeat: (work: () => Promise<unknown>) => work(),
    desktopDelete: { beat: () => waitFor("deletions") },
    providerInbox: { beat: () => waitFor("inbox") },
    hostNotes: { revision: 7 },
    sessionQueues: { changesSince: () => ({ seq: 3 }) },
    adoptedChanges: { changesSince: () => waitFor("adopted") },
    renewQueueLeases: () => waitFor("queueLeases"),
  };
  const request = {
    input: { method: "sessions.desktopLive" },
    params: { clientId: "win1", queueSeq: 2, adoptedSeq: 4, deletions: [], inbox: [] },
    tokenHash: "token-hash",
    domainContext: {},
    result: undefined as unknown,
  };
  const done = handleSessionsRpc(dependencies as never, request as never);
  // Every part is already waiting on its store read before any of them resolves.
  await new Promise((resolve) => setImmediate(resolve));
  expect(started.sort()).toEqual(["adopted", "deletions", "inbox", "queueLeases"]);
  gates.deletions.resolve({ jobs: [{ id: "job" }], acked: [] });
  gates.inbox.resolve({ jobs: [], acked: ["m1"] });
  gates.adopted.resolve({ seq: 5, ids: ["a"] });
  gates.queueLeases.resolve({ q1: null });
  await done;
  expect(request.result).toEqual({
    commands: [{ id: "live" }, { id: "durable" }],
    deletions: { jobs: [{ id: "job" }], acked: [] },
    inbox: { jobs: [], acked: ["m1"] },
    notesRevision: 7,
    queues: { seq: 3 },
    adopted: { seq: 5, ids: ["a"] },
    queueLeases: { q1: null },
    runLeases: { s1: null },
  });
});
