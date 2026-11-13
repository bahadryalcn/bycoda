import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runHarnessTextPrompt } from "../../src/integrations/harness/core/registry";
import { HostStore } from "../store";
import { AssistantRepository } from "../assistant/repository";
import { roomAutomationPorts } from "./room-execution";
import type { RoomAutomationSources, RoomAutomationTools } from "./room-tools";

const cleanups: (() => Promise<void>)[] = [];
const target = {
  model: { harness: "codex" as const, model: "model", modelSettings: {} },
  runtimeMode: "supervised" as const,
  permissionRevision: "revision",
  execution: { kind: "room" as const, threadId: "room" },
};
const sourceResult = {
  value: { rows: [{ id: "visible-session" }] },
  source: {
    environmentId: "environment",
    threadId: "room",
    projectId: "selected",
    projectCwd: "C:/selected",
    family: "conversation" as const,
    action: "sessions.list",
  },
  contributorProjects: [{ projectId: "selected", cwd: "C:/selected" }],
};
function toolPorts(): RoomAutomationTools {
  return {
    capture: vi.fn(async () => ({ deviceHash: "a".repeat(64), calls: [] })),
    call: vi.fn(async (call, sources) => {
      sources.calls.push({ call, result: sourceResult });
      return sourceResult;
    }),
    disclose: async (_thread, _sources, authorized, signal, effect) => {
      if (signal?.aborted || !(await authorized())) throw new Error("Authority withdrawn");
      return effect(() => !signal?.aborted);
    },
  };
}
async function fixture(tools: RoomAutomationTools) {
  const directory = await mkdtemp(join(tmpdir(), "room-tools-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  await new AssistantRepository(store).initialize();
  const ports = roomAutomationPorts(store, directory, async () => ({ id: "room" }), tools);
  return {
    store,
    ports,
    input: {
      threadId: "room",
      occurrence: "occurrence",
      prompt: "Report",
      target,
      authorized: async () => true,
    },
  };
}
vi.mock("../../src/integrations/harness/core/register", () => ({
  registerBuiltinHarnesses: vi.fn(),
}));
vi.mock("../../src/integrations/harness/core/registry", () => ({ runHarnessTextPrompt: vi.fn() }));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});

it.each(["sessions", "tasks", "automations"])(
  "routes explicit %s reads through scoped Room tools and retains delivery provenance",
  async (source) => {
    const tools = toolPorts();
    const f = await fixture(tools);
    let calls = 0;
    vi.mocked(runHarnessTextPrompt).mockImplementation(async (request) => {
      await request.onRetired!({ original: request.retirementIdentity!, cleanupSuccess: true });
      return JSON.stringify(
        calls++ === 0
          ? { kind: "read", source, projectId: "selected" }
          : { kind: "answer", text: "Private report" },
      );
    });
    const result = await f.ports.execute(f.input);
    expect(result.outcome?.status).toBe("succeeded");
    expect(tools.call).toHaveBeenCalledWith(
      expect.objectContaining({ action: `${source}.list`, projectId: "selected" }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    await f.ports.deliver("room", "occurrence", result.text, async () => true, result.sources);
    const row = await f.store.db.prepare("SELECT value FROM assistant_messages").get();
    expect(JSON.parse(String(row!.value))).toMatchObject({ projectIds: ["selected"] });
    const provenance = await f.store.db
      .prepare("SELECT value FROM assistant_runtime WHERE id LIKE 'messageScopeSources:%'")
      .get();
    expect(JSON.parse(String(provenance!.value)).value.managementTurnId).toBe(
      "room-automation-turn:occurrence",
    );
    const notification = await f.store.db
      .prepare("SELECT value FROM assistant_runtime WHERE id LIKE 'notification:%'")
      .get();
    expect(JSON.parse(String(notification!.value)).value.body).not.toContain("Private report");
  },
);

it("retains original tool ownership after Stop until the dispatcher physically settles", async () => {
  const tools = toolPorts();
  const f = await fixture(tools);
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  tools.call = vi.fn(async (_call, _sources, _authorized, originalSignal) => {
    signal = originalSignal;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return sourceResult;
  });
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (request) => {
    await request.onRetired!({ original: request.retirementIdentity!, cleanupSuccess: true });
    return JSON.stringify({
      kind: "tool",
      family: "conversation",
      action: "desktop.act",
      input: {},
    });
  });
  const pending = f.ports.execute(f.input);
  let settled = false;
  void pending
    .then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    )
    .catch(() => undefined);
  await vi.waitFor(() => expect(signal).toBeDefined());
  await f.ports.stop("occurrence");
  expect(signal!.aborted).toBe(true);
  expect(settled).toBe(false);
  await expect(f.ports.execute(f.input)).rejects.toThrow("original provider owner");
  finish();
  expect((await pending).outcome?.status).toBe("cancelled");
  expect(tools.call).toHaveBeenCalledTimes(1);
  expect(runHarnessTextPrompt).toHaveBeenCalledTimes(1);
});

it("withholds a later model and message when source disclosure fails", async () => {
  const tools = toolPorts();
  const f = await fixture(tools);
  tools.disclose = async (_thread, sources, _authorized, _signal, effect) => {
    if (sources?.calls.length) throw new Error("Source locked");
    return effect(() => true);
  };
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (request) => {
    await request.onRetired!({ original: request.retirementIdentity!, cleanupSuccess: true });
    return JSON.stringify({ kind: "read", source: "sessions", projectId: "selected" });
  });
  expect((await f.ports.execute(f.input)).outcome).toMatchObject({
    status: "failed",
    message: "Source locked",
  });
  expect(runHarnessTextPrompt).toHaveBeenCalledTimes(1);
  const sources: RoomAutomationSources = {
    deviceHash: "a".repeat(64),
    calls: [
      {
        call: {
          threadId: "room",
          projectId: "selected",
          family: "conversation",
          action: "sessions.list",
          input: {},
          requestId: "request",
        },
        result: sourceResult,
      },
    ],
  };
  await expect(
    f.ports.deliver("room", "occurrence", "Private", async () => true, sources),
  ).rejects.toThrow("Source locked");
  await expect(
    f.store.db.prepare("SELECT count(*) AS count FROM assistant_messages").get(),
  ).resolves.toMatchObject({ count: 0 });
});

it.each([true, false])(
  "Stop waits for exact physical retirement and never replays the provider (cleanupSuccess=%s)",
  async (cleanupSuccess) => {
    const directory = await mkdtemp(join(tmpdir(), "room-stop-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const store = new HostStore(join(directory, "host.db"));
    cleanups.push(() => store.close());
    await store.ready;
    let original: Parameters<typeof runHarnessTextPrompt>[0] | undefined;
    vi.mocked(runHarnessTextPrompt).mockImplementation((request) => {
      original = request;
      return new Promise((_resolve, reject) =>
        request.signal!.addEventListener(
          "abort",
          () => reject(new Error("Observer cancelled before cleanup")),
          { once: true },
        ),
      );
    });
    const ports = roomAutomationPorts(store, directory, async () => ({ id: "room" }));
    const input = {
      threadId: "room",
      occurrence: "occurrence",
      prompt: "Report",
      target: {
        model: { harness: "codex" as const, model: "model", modelSettings: {} },
        runtimeMode: "supervised" as const,
        permissionRevision: "revision",
        execution: { kind: "room" as const, threadId: "room" },
      },
      authorized: async () => true,
    };
    const pending = ports.execute(input);
    let settled = false;
    void pending
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      )
      .catch(() => undefined);
    await vi.waitFor(() => expect(original).toBeDefined());
    await ports.stop("another-occurrence");
    expect(original!.signal!.aborted).toBe(false);
    await ports.stop("occurrence");
    expect(original!.signal!.aborted).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    await original!.onRetired!({ original: Symbol("foreign"), cleanupSuccess: true });
    expect(settled).toBe(false);
    await original!.onRetired!({ original: original!.retirementIdentity!, cleanupSuccess });
    if (cleanupSuccess) {
      const result = await pending;
      expect(result.outcome?.status).toBe("cancelled");
      expect(result.tokens).toBeUndefined();
      expect(result.costUsd).toBeUndefined();
      expect((await ports.execute(input)).outcome?.status).toBe("cancelled");
    } else {
      await expect(pending).rejects.toThrow("cleanup is unproven");
      await expect(ports.execute(input)).rejects.toThrow("original provider owner");
    }
    expect(runHarnessTextPrompt).toHaveBeenCalledTimes(1);
  },
);

it("returns failed after proven cleanup, preserving unknown usage unless dispatch never entered", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-failure-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  const ports = roomAutomationPorts(store, directory, async () => ({ id: "room" }));
  const target = {
    model: { harness: "codex" as const, model: "model", modelSettings: {} },
    runtimeMode: "supervised" as const,
    permissionRevision: "revision",
    execution: { kind: "room" as const, threadId: "room" },
  };
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (request) => {
    await request.onRetired!({ original: request.retirementIdentity!, cleanupSuccess: true });
    return "not valid JSON";
  });
  const failed = await ports.execute({
    threadId: "room",
    occurrence: "entered",
    prompt: "Report",
    target,
    authorized: async () => true,
  });
  expect(failed.outcome?.status).toBe("failed");
  expect(failed.tokens).toBeUndefined();
  expect(failed.costUsd).toBeUndefined();
  vi.mocked(runHarnessTextPrompt).mockImplementation(async (request) => {
    await request.onRetired!({
      original: request.retirementIdentity!,
      dispatch: "not-entered",
      cleanupSuccess: true,
    });
    throw new Error("Provider preflight refused");
  });
  const refused = await ports.execute({
    threadId: "room",
    occurrence: "not-entered",
    prompt: "Report",
    target,
    authorized: async () => true,
  });
  expect(refused).toMatchObject({ outcome: { status: "failed" }, tokens: 0, costUsd: 0 });
});

it("commits one Room message and push notification for exact occurrence and rejects changed authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-delivery-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  let threadId = "room";
  const ports = roomAutomationPorts(store, directory, async () => ({ id: threadId }));
  await ports.deliver("room", "occurrence", "Retained answer", async () => true);
  await ports.deliver("room", "occurrence", "Retained answer", async () => true);
  expect(
    await store.db.prepare("SELECT count(*) AS count FROM assistant_messages").get(),
  ).toMatchObject({ count: 1 });
  expect(
    await store.db
      .prepare("SELECT count(*) AS count FROM assistant_runtime WHERE id LIKE 'notification:%'")
      .get(),
  ).toMatchObject({ count: 1 });
  await expect(
    ports.deliver("room", "occurrence", "Changed answer", async () => true),
  ).rejects.toThrow("identity changed");
  threadId = "other-room";
  await expect(
    ports.deliver("room", "other-occurrence", "Answer", async () => true),
  ).rejects.toThrow("identity changed");
  await expect(
    ports.deliver("other-room", "other-occurrence", "Answer", async () => false),
  ).rejects.toThrow("withdrawn");
  expect(
    await store.db.prepare("SELECT count(*) AS count FROM assistant_messages").get(),
  ).toMatchObject({ count: 1 });
});
