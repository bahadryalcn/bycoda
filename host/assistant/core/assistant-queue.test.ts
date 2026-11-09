import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../../store";
import { HostAssistant, type AssistantPorts } from "../service";
import { assistantPresenceState } from "./assistant-presence";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(ports: AssistantPorts) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-assistant-queue-"));
  const store = new HostStore(join(directory, "host.db"));
  await store.ready;
  const service = new HostAssistant(store, {
    listProjects: async () => [{ id: "project", path: directory, name: "Project" }],
    onError: () => {},
    ...ports,
  });
  await service.ready;
  cleanups.push(async () => {
    await service.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const request = (input: unknown) => service.request(input, "owner");
  const profile = (await request({ op: "snapshot" })).snapshot!.profile;
  await request({
    op: "profile.update",
    expectedVersion: profile.version,
    patch: {
      name: "Queue",
      setupComplete: true,
      enabled: true,
      autonomy: "report",
      dailyTokenBudget: 100000,
      execution: {
        harness: "codex",
        model: "fixture-model",
        modelSettings: {},
        runtimeMode: "supervised",
        maxRunMinutes: 30,
      },
    },
  });
  return { service, request };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

it("answers owner reads while a reply model turn holds the request queue", async () => {
  const model = gate(),
    started = gate();
  const f = await fixture({
    reply: async () => {
      started.open();
      await model.opened;
      return { text: "Done.", tokens: 10 };
    },
  });
  const thread = (await f.request({ op: "threads.open" })).thread!;
  const send = f.request({
    op: "threads.send",
    threadId: thread.id,
    via: "text",
    text: "Hello",
    idempotencyKey: "queue-turn",
  });
  await started.opened;
  // Voice start reads these; before, they waited for the whole model turn and
  // the desktop reported RPC_TIMEOUT after 30 s.
  const reads = Promise.all([
    f.request({ op: "projects.list" }),
    f.request({ op: "snapshot", limit: 100 }),
    f.request({ op: "memory.search", query: "", limit: 100 }),
    f.request({ op: "threads.messages", threadId: thread.id }),
  ]);
  const raced = await Promise.race([
    reads.then(() => "reads"),
    new Promise((resolve) => setTimeout(() => resolve("queued"), 2000)),
  ]);
  expect(raced).toBe("reads");
  model.open();
  await send;
});

it("reads native presence before joining the request queue", async () => {
  const presence = gate(),
    reading = gate();
  const f = await fixture({
    readPresence: async () => {
      reading.open();
      await presence.opened;
      return { supported: true, locked: false, idleMs: 0 };
    },
  });
  const tick = f.service.tick();
  await reading.opened;
  // A slow PowerShell presence read must not hold mutations either.
  const thread = f.request({ op: "threads.open" });
  const raced = await Promise.race([
    thread.then(() => "answered"),
    new Promise((resolve) => setTimeout(() => resolve("queued"), 2000)),
  ]);
  expect(raced).toBe("answered");
  presence.open();
  await tick;
  expect((await f.request({ op: "snapshot" })).snapshot!.automaticPresence!.state).toBe("present");
});

it("classifies presence observations and never treats an unreadable desktop as present", () => {
  const policy = { idleMinutes: 5, awayMinutes: 30 };
  expect(assistantPresenceState({ supported: false, locked: true }, policy)).toEqual({
    state: "unknown",
  });
  expect(assistantPresenceState({ supported: true, locked: true, idleMs: 0 }, policy)).toEqual({
    state: "locked",
    idleMs: 0,
  });
  expect(assistantPresenceState({ supported: true, locked: false, idleMs: -1 }, policy)).toEqual({
    state: "unknown",
  });
  expect(
    assistantPresenceState({ supported: true, locked: false, idleMs: 300000 }, policy).state,
  ).toBe("idle");
  expect(
    assistantPresenceState({ supported: true, locked: false, idleMs: 1800000 }, policy).state,
  ).toBe("away");
  expect(assistantPresenceState({ supported: true, locked: false, idleMs: 1 }, policy).state).toBe(
    "present",
  );
});
