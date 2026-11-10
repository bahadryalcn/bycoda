import { describe, expect, it, vi } from "vitest";
import type { SessionCommand } from "../../../src/shared/model/host-contracts/session-commands";
import {
  createCommandService,
  type CommandServicePorts,
  type CommandQueueSnapshot,
} from "./service";
import { DesktopLive } from "../../desktop/desktopLive";
import { refuseHost } from "../context";

const send: SessionCommand = { type: "send", commandId: "c", sessionId: "s", text: "hello" };
const contextual: SessionCommand = {
  type: "contextual",
  commandId: "c",
  sessionId: "s",
  sourceBlockId: "a",
  expectedRevision: 8,
  mode: "handoff",
  harness: "codex",
  model: "model",
  modelSettings: {},
  previewDigest: "digest",
};
function setup() {
  const events: string[] = [];
  const receipt = { commandId: "c", sessionId: "s", revision: 9 };
  let allowed = true;
  const queue: CommandQueueSnapshot = { messages: [] };
  const ports: CommandServicePorts<{ revision: number }> = {
    repository: {
      receiptStatus: vi.fn(async () => undefined),
      desktopCommandStatus: vi.fn(async () => undefined),
      acceptDesktopCommand: vi.fn(async (input, revalidate) => {
        await revalidate();
        return input.receipt;
      }),
      transaction: vi.fn(async (operation) => {
        events.push("transaction:start");
        const value = await operation();
        events.push("transaction:end");
        return value;
      }),
      readView: vi.fn(async () => ({ revision: 8 })),
      modelTarget: vi.fn(async () => ({ harness: "codex", model: "model", modelSettings: {} })),
      adopt: vi.fn(async () => {
        events.push("adopt");
      }),
      touchWorkspace: vi.fn(async () => {
        events.push("touch");
      }),
    },
    execution: {
      commandSignature: (command) => JSON.stringify(command),
      persistenceReady: vi.fn(() => true),
      validateCommand: vi.fn(() => {
        events.push("validate");
      }),
      attachmentRefs: vi.fn((raw) => {
        if (raw === undefined) return [];
        if (!Array.isArray(raw)) throw new Error("Invalid attachments");
        return raw.map((value: unknown) => {
          if (
            typeof value !== "object" ||
            value === null ||
            !("id" in value) ||
            !("size" in value) ||
            typeof value.id !== "string" ||
            typeof value.size !== "number"
          )
            throw new Error("Invalid attachment");
          return { id: value.id, size: value.size };
        });
      }),
      previewContextual: vi.fn(async () => ({ digest: "digest" })),
      command: vi.fn(async () => {
        events.push("command");
        return receipt;
      }),
      clearConversation: vi.fn(async () => {
        events.push("clear");
        return receipt;
      }),
      rewind: vi.fn(async () => {
        events.push("rewind");
        return receipt;
      }),
      assertHostMayRun: vi.fn(async () => {
        events.push("lease");
      }),
      isClearCommand: vi.fn((text) => /^\s*\/clear\s*$/i.test(text)),
    },
    queue: {
      reapStale: vi.fn(async () => queue),
      get: vi.fn(async () => queue),
      renew: vi.fn(async () => {}),
      assertSend: vi.fn(async () => queue),
      consumed: vi.fn(async () => {
        events.push("consumed");
      }),
      sameModelTarget: vi.fn(() => true),
      kick: vi.fn(),
      leaseHeld: vi.fn((holder, detail) =>
        Object.assign(new Error(detail), { code: "LEASE_HELD", holder }),
      ),
    },
    nativeProjection: {
      watch: vi.fn(async () => undefined),
      alive: vi.fn(() => true),
      prepareDesktop: vi.fn(async (command) => ({
        commandId: command.commandId,
        clientId: "client",
        sessionId: command.sessionId,
        ownerId: "page",
        delivery: JSON.stringify(command),
        revalidate: async () => {},
        current: () => true,
      })),
      trackDesktop: vi.fn(),
      withRetiredWriters: vi.fn(async (_id, operation) => {
        events.push("retire");
        return operation();
      }),
    },
    crews: {
      ownerDirective: vi.fn(async () => {
        events.push("directive");
      }),
      managedSessionRefusal: vi.fn(async (): Promise<string | undefined> => undefined),
    },
  };
  const auth = { principalId: "principal", authorized: async () => allowed };
  return {
    ports,
    service: createCommandService(ports),
    receipt,
    auth,
    events,
    queue,
    revoke: () => {
      allowed = false;
    },
  };
}
function queuedSetup() {
  const fixture = setup();
  fixture.queue.messages.push({ id: "q", text: "hello", attachments: [] });
  return {
    ...fixture,
    command: {
      ...send,
      queued: {
        id: "q",
        clientId: "desktop",
        revision: 4,
        leaseAware: true,
        epoch: 7,
        selected: true,
      },
    },
  };
}

type Row = CommandQueueSnapshot["messages"][number];

describe("command domain admission", () => {
  it("refuses conversation commands on a crew-managed session except from the crew service", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.crews.managedSessionRefusal).mockResolvedValue("managed by a crew");
    for (const command of [
      send,
      { type: "cancel" as const, sessionId: "s", commandId: "c2", runId: "r" },
    ])
      await expect(service.dispatch(command, auth)).rejects.toThrow("managed by a crew");
    expect(ports.execution.command).not.toHaveBeenCalled();
    await service.dispatch(send, { ...auth, principalId: "crew:run" });
    expect(ports.execution.command).toHaveBeenCalledTimes(1);
  });
  it("rejects desktop control without a principal before preparing an offer", async () => {
    const { service, ports } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
    await expect(
      service.dispatch(
        { type: "cancel", sessionId: "s", commandId: "c", runId: "desktop" },
        { authorized: async () => true },
      ),
    ).rejects.toThrow(/principal/);
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
    expect(ports.repository.acceptDesktopCommand).not.toHaveBeenCalled();
  });
  it("returns an existing scoped desktop receipt without recreating a delivery", async () => {
    const { service, ports, auth, receipt } = setup();
    vi.mocked(ports.repository.desktopCommandStatus).mockResolvedValue(receipt);
    expect(
      await service.dispatch(
        { type: "cancel", sessionId: "s", commandId: "c", runId: "desktop" },
        auth,
      ),
    ).toEqual(receipt);
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("lets verified live control reach the engine when persistence blocks outer transactions", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.execution.persistenceReady).mockReturnValue(false);
    vi.mocked(ports.repository.transaction).mockRejectedValue(new Error("writes blocked"));
    vi.mocked(ports.repository.adopt).mockRejectedValue(new Error("adoption blocked"));
    const unconfirmed = Object.assign(new Error("control sent without receipt"), {
      code: "HOST_CONTROL_RECEIPT_UNCONFIRMED",
      controlApplied: true,
    });
    vi.mocked(ports.execution.command).mockRejectedValue(unconfirmed);
    await expect(
      service.dispatch({ type: "cancel", sessionId: "s", commandId: "c", runId: "run" }, auth),
    ).rejects.toBe(unconfirmed);
    expect(ports.execution.command).toHaveBeenCalledOnce();
    expect(ports.repository.adopt).not.toHaveBeenCalled();
    expect(ports.repository.transaction).not.toHaveBeenCalled();
    expect(ports.crews.ownerDirective).not.toHaveBeenCalled();
  });
  it("returns durable status or null with pre/post authorization", async () => {
    const { service, ports, receipt, auth, revoke } = setup();
    expect(await service.status({ commandId: "c" }, auth)).toBeNull();
    vi.mocked(ports.repository.receiptStatus).mockResolvedValue(receipt);
    expect(await service.status({ commandId: "c" }, auth)).toEqual(receipt);
    vi.mocked(ports.repository.receiptStatus).mockImplementation(async () => {
      revoke();
      return receipt;
    });
    await expect(service.status({ commandId: "c" }, auth)).rejects.toThrow("revoked");
  });
  it.each([
    { ...send, commandId: "" },
    { ...send, unknownMutation: true },
    { ...send, queued: { id: "q", clientId: "d", revision: -1 } },
    { ...send, type: "invented" },
  ])("rejects malformed command metadata before adoption or execution", async (command) => {
    const { service, ports, auth } = setup();
    await expect(service.dispatch(command, auth)).rejects.toThrow();
    expect(ports.repository.adopt).not.toHaveBeenCalled();
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("validates note semantics before a slash command or adoption can run", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.execution.validateCommand).mockImplementation(() => {
      throw new Error("Send note context as a new regular message");
    });
    await expect(
      service.dispatch(
        {
          ...send,
          text: "/clear",
          noteCard: { id: "n", slug: "n", title: "note", body: "snapshot" },
        },
        auth,
      ),
    ).rejects.toThrow("note context");
    expect(ports.repository.adopt).not.toHaveBeenCalled();
    expect(ports.execution.clearConversation).not.toHaveBeenCalled();
  });
  it("preserves legacy HTTP's ignored top-level metadata while validating every known command field", async () => {
    const { service, ports, auth, revoke } = setup();
    await service.dispatch({ ...send, projectId: "p", title: "unrelated rename" }, auth, {
      legacy: true,
    });
    expect(ports.execution.command).toHaveBeenCalledWith(send, auth);
    await expect(
      service.dispatch({ ...send, text: 42, title: "unrelated" }, auth, { legacy: true }),
    ).rejects.toThrow();
    expect(ports.execution.command).toHaveBeenCalledOnce();
    revoke();
    expect(await auth.authorized()).toBe(false);
  });
  it("retains semantic rejection of an ignored legacy field such as note context on rewind", async () => {
    const { service, ports, auth } = setup();
    const raw = {
      type: "rewind",
      commandId: "r",
      sessionId: "s",
      blockId: "a",
      noteCard: { id: "n" },
    };
    vi.mocked(ports.execution.validateCommand).mockImplementation((value) => {
      if (typeof value === "object" && value !== null && "noteCard" in value)
        throw new Error("Invalid note context");
    });
    await expect(service.dispatch(raw, auth, { legacy: true })).rejects.toThrow("note context");
    expect(ports.execution.validateCommand).toHaveBeenCalledWith(raw);
    expect(ports.repository.adopt).not.toHaveBeenCalled();
  });
  it("reconciles an accepted contextual receipt before checking a changed source", async () => {
    const { service, ports, receipt, auth } = setup();
    vi.mocked(ports.repository.receiptStatus).mockResolvedValue(receipt);
    expect(await service.dispatch(contextual, auth)).toEqual(receipt);
    expect(ports.execution.previewContextual).not.toHaveBeenCalled();
    expect(ports.repository.adopt).not.toHaveBeenCalled();
  });
  it("blocks stale contextual review before adopting or executing", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.execution.previewContextual).mockResolvedValue({ digest: "changed" });
    await expect(service.dispatch(contextual, auth)).rejects.toThrow("reviewed context changed");
    expect(ports.repository.adopt).not.toHaveBeenCalled();
  });
  it("reaps stale claims then surfaces the current owning desktop as a not-sent LEASE_HELD", async () => {
    const { service, ports, queue, auth } = setup();
    queue.claim = { clientId: "owner" };
    await expect(service.dispatch(send, auth)).rejects.toMatchObject({
      name: "HostDomainRefusalError",
      code: "LEASE_HELD",
      category: "conflict",
      retryable: true,
      delivery: "not-sent",
      message: "The owning desktop is preparing a queued send. Wait for its acknowledgement.",
      cause: { holder: "owner" },
    });
    expect(ports.queue.reapStale).toHaveBeenCalledWith("s");
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("refuses a run lease held elsewhere before execution with the message clients match", async () => {
    const { service, ports, auth } = setup();
    // The run-lease port raises the typed refusal itself; the service passes it through.
    vi.mocked(ports.execution.assertHostMayRun).mockRejectedValue(
      refuseHost(
        new Error("LEASE_HELD: This session is running in bycoda on that computer."),
        "LEASE_HELD",
        "conflict",
        true,
      ),
    );
    const error = await service.dispatch(send, auth).catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "LEASE_HELD",
      category: "conflict",
      retryable: true,
      delivery: "not-sent",
      message: "LEASE_HELD: This session is running in bycoda on that computer.",
    });
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it.each([
    {
      name: "content",
      change: (row: Row) => {
        row.text = "edited elsewhere";
      },
      message: "Queued message content changed.",
    },
    {
      name: "authority",
      change: (row: Row) => {
        row.authorityGeneration = 99;
      },
      message: "Queued message authority changed. Review it before sending.",
    },
  ])(
    "refuses a changed queued $name as a validation refusal that was not sent",
    async ({ change, message }) => {
      const { service, ports, command, auth } = queuedSetup();
      change((await ports.queue.get("s")).messages[0]);
      const error = await service.dispatch(command, auth).catch((cause: unknown) => cause);
      expect(error).toMatchObject({
        code: "QUEUE_ROW_CHANGED",
        category: "validation",
        retryable: false,
        delivery: "not-sent",
        message,
      });
      expect(ports.execution.command).not.toHaveBeenCalled();
    },
  );
  it("keeps a failure after the command started as a plain, unknown-outcome error", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.execution.command).mockRejectedValue(new Error("provider failed mid-write"));
    const error = await service.dispatch({ ...send, text: "go" }, auth).catch((cause) => cause);
    expect(error).toEqual(new Error("provider failed mid-write"));
    expect(error).not.toHaveProperty("delivery");
  });
  it("preserves selected-row and lease-aware epoch authority and consumes atomically", async () => {
    const { service, ports, command, auth, events } = queuedSetup();
    await service.dispatch(command, auth);
    expect(ports.queue.assertSend).toHaveBeenCalledWith("s", "q", "desktop", 4, true, {
      epoch: 7,
      legacy: false,
    });
    expect(ports.queue.renew).not.toHaveBeenCalled();
    expect(events).toEqual([
      "validate",
      "lease",
      "lease",
      "adopt",
      "retire",
      "transaction:start",
      "command",
      "consumed",
      "directive",
      "transaction:end",
      "touch",
    ]);
  });
  it("renews legacy queue ownership and makes steer an explicit selected row", async () => {
    const { service, ports, auth } = queuedSetup();
    await service.dispatch(
      {
        ...send,
        type: "steer",
        runId: "run",
        queued: { id: "q", clientId: "desktop", revision: 4 },
      },
      auth,
    );
    expect(ports.queue.renew).toHaveBeenCalledWith("s", "desktop");
    expect(ports.queue.assertSend).toHaveBeenCalledWith("s", "q", "desktop", 4, true, {
      epoch: undefined,
      legacy: true,
    });
  });
  it.each(["content", "attachments", "intent", "model"])(
    "blocks queued %s changes before adoption",
    async (change) => {
      const { service, ports, queue, command, auth } = queuedSetup();
      const row = queue.messages[0];
      if (change === "content") row.text = "changed";
      if (change === "attachments") row.attachments.push({ id: "file", size: 5 });
      if (change === "intent") row.intent = "plan";
      if (change === "model") {
        row.modelTarget = { harness: "codex", model: "other", modelSettings: {} };
        vi.mocked(ports.queue.sameModelTarget).mockReturnValue(false);
      }
      await expect(service.dispatch(command, auth)).rejects.toThrow("changed");
      expect(ports.repository.adopt).not.toHaveBeenCalled();
      expect(ports.execution.command).not.toHaveBeenCalled();
    },
  );
  it("deduplicated receipt retries bypass stale queue admission", async () => {
    const { service, ports, receipt, command, auth } = queuedSetup();
    vi.mocked(ports.repository.receiptStatus).mockResolvedValue(receipt);
    await service.dispatch(command, auth);
    expect(ports.queue.assertSend).not.toHaveBeenCalled();
    expect(ports.execution.assertHostMayRun).not.toHaveBeenCalled();
  });
  it("preserves legacy compact attachment and steer intent equality guards", async () => {
    const { service, queue, auth } = queuedSetup();
    const queued = { id: "q", clientId: "desktop", revision: 4 };
    queue.messages[0].text = "/compact";
    await expect(
      service.dispatch(
        {
          type: "compact",
          commandId: "compact",
          sessionId: "s",
          queued,
          attachments: [{ id: "file", size: 4 }],
        },
        auth,
        { legacy: true },
      ),
    ).rejects.toThrow("attachments or intent changed");
    queue.messages[0].text = "hello";
    queue.messages[0].intent = "plan";
    await expect(
      service.dispatch({ ...send, type: "steer", runId: "run", intent: "plan", queued }, auth, {
        legacy: true,
      }),
    ).resolves.toMatchObject({ revision: 9 });
  });
  it.each(["steer", "rewind"] as const)(
    "blocks %s while the native desktop owns a running turn",
    async (type) => {
      const { service, ports, auth } = setup();
      vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
      const command =
        type === "steer"
          ? { ...send, type, runId: "run" }
          : { type, sessionId: "s", commandId: "c", blockId: "a" };
      await expect(service.dispatch(command, auth)).rejects.toThrow("desktop-owned");
      expect(ports.repository.adopt).not.toHaveBeenCalled();
    },
  );
  it("delivers desktop turn controls to the native owner without Host adoption", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
    const cancel = { type: "cancel", sessionId: "s", commandId: "c", runId: "run" };
    expect(await service.dispatch(cancel, auth)).toEqual({
      commandId: "c",
      sessionId: "s",
      revision: 8,
    });
    expect(ports.nativeProjection.prepareDesktop).toHaveBeenCalledWith(cancel, auth);
    expect(ports.repository.adopt).not.toHaveBeenCalled();
    vi.mocked(ports.nativeProjection.alive).mockReturnValue(false);
    await expect(service.dispatch(cancel, auth)).rejects.toThrow("isn't responding");
    expect(ports.nativeProjection.prepareDesktop).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "preserves the exact original approval occurrence through %s legacy admission",
    async (legacy) => {
      const { service, ports, auth } = setup();
      vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
      const command = {
        type: "approve",
        sessionId: "s",
        commandId: "approve-original",
        runId: "desktop",
        requestId: 7,
        approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
        decision: "allow",
      };
      expect(
        await service.dispatch(
          legacy ? { ...command, ignoredLegacyField: "ignored" } : command,
          auth,
          { legacy },
        ),
      ).toEqual({ commandId: command.commandId, sessionId: "s", revision: 8 });
      expect(ports.nativeProjection.prepareDesktop).toHaveBeenCalledExactlyOnceWith(command, auth);
      expect(ports.execution.command).not.toHaveBeenCalled();
      expect(ports.repository.adopt).not.toHaveBeenCalled();
    },
  );
  it("refuses approval admission without an original occurrence and preserves revoked authority", async () => {
    const { service, ports, auth, revoke } = setup();
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
    const command = {
      type: "approve",
      sessionId: "s",
      commandId: "approve-original",
      runId: "desktop",
      requestId: 7,
      decision: "allow",
    };
    await expect(service.dispatch(command, auth)).rejects.toThrow("identity is missing or invalid");
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
    vi.mocked(ports.nativeProjection.watch).mockImplementation(async () => {
      revoke();
      return { revision: 8, running: true };
    });
    await expect(
      service.dispatch(
        { ...command, approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001" },
        auth,
      ),
    ).rejects.toThrow();
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("refuses a Host-visible same-ID replacement before transient desktop acceptance", async () => {
    const { service, ports, auth } = setup();
    const live = new DesktopLive();
    const original = "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
      replacement = "7e1c4dc0-6f53-4a8c-b8d8-000000000002";
    const publish = (occurrenceId: string) =>
      live.beat({
        clientId: "owner",
        sessions: [
          {
            id: "s",
            busy: true,
            pending: [
              {
                id: "approval",
                role: "approval",
                text: "Original",
                approval: { requestId: 7, occurrenceId },
              },
            ],
          },
        ],
      });
    publish(original);
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
    vi.mocked(ports.nativeProjection.prepareDesktop).mockImplementation(async (command) => {
      live.enqueue(command);
      return {
        commandId: command.commandId,
        clientId: "client",
        sessionId: command.sessionId,
        ownerId: "page",
        delivery: JSON.stringify(command),
        revalidate: async () => {},
        current: () => true,
      };
    });
    const command = {
      type: "approve",
      sessionId: "s",
      commandId: "approve-A",
      runId: "desktop",
      requestId: 7,
      approvalOccurrenceId: original,
      decision: "allow",
    };
    await service.dispatch(command, auth);
    publish(replacement);
    await expect(service.dispatch({ ...command, commandId: "late-A" }, auth)).rejects.toThrow(
      "changed or is already resolved",
    );
    expect(publish(replacement).commands).toEqual([
      expect.objectContaining({ id: "approve-A", approvalOccurrenceId: original }),
    ]);
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("reconciles an existing Host approval receipt through its exact engine signature after desktop adoption", async () => {
    const { service, ports, auth, receipt } = setup();
    const command = {
      type: "approve",
      sessionId: "s",
      commandId: "approve-existing",
      runId: "desktop",
      requestId: 7,
      approvalOccurrenceId: "7e1c4dc0-6f53-4a8c-b8d8-000000000001",
      decision: "allow",
    };
    vi.mocked(ports.repository.receiptStatus).mockResolvedValue(receipt);
    vi.mocked(ports.nativeProjection.watch).mockResolvedValue({ revision: 8, running: true });
    expect(await service.dispatch(command, auth)).toEqual(receipt);
    expect(ports.execution.command).toHaveBeenCalledExactlyOnceWith(command, auth);
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
    expect(ports.repository.adopt).not.toHaveBeenCalled();
    vi.mocked(ports.execution.command).mockRejectedValue(
      new Error("Command ID was reused with different content"),
    );
    await expect(service.dispatch({ ...command, decision: "deny" }, auth)).rejects.toThrow(
      "different content",
    );
    expect(ports.nativeProjection.prepareDesktop).not.toHaveBeenCalled();
  });
  it("requires an empty queue before clearing or rewinding", async () => {
    const { service, ports, auth } = queuedSetup();
    await expect(service.dispatch({ ...send, text: "/clear" }, auth)).rejects.toThrow(
      "clear queued messages",
    );
    await expect(
      service.dispatch({ type: "rewind", sessionId: "s", commandId: "c", blockId: "a" }, auth),
    ).rejects.toThrow("queued messages before rewinding");
    expect(ports.execution.clearConversation).not.toHaveBeenCalled();
    expect(ports.execution.rewind).not.toHaveBeenCalled();
  });
  it("routes clear and rewind through their dedicated durable execution ports", async () => {
    const { service, ports, auth } = setup();
    await service.dispatch({ ...send, text: "/clear" }, auth);
    await service.dispatch({ type: "rewind", sessionId: "s", commandId: "r", blockId: "a" }, auth);
    expect(ports.execution.clearConversation).toHaveBeenCalledOnce();
    expect(ports.execution.rewind).toHaveBeenCalledOnce();
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("cannot execute until native writer retirement has acknowledged", async () => {
    const { service, ports, auth } = setup();
    vi.mocked(ports.nativeProjection.withRetiredWriters).mockRejectedValue(
      new Error("retirement not acknowledged"),
    );
    await expect(service.dispatch(send, auth)).rejects.toThrow("retirement not acknowledged");
    expect(ports.execution.command).not.toHaveBeenCalled();
    expect(ports.crews.ownerDirective).not.toHaveBeenCalled();
  });
  it("rechecks authority inside the admission transaction after retirement wait", async () => {
    const { service, ports, auth, revoke } = setup();
    vi.mocked(ports.nativeProjection.withRetiredWriters).mockImplementation(
      async (_id, operation) => {
        revoke();
        return operation();
      },
    );
    await expect(service.dispatch(send, auth)).rejects.toThrow("revoked");
    expect(ports.execution.command).not.toHaveBeenCalled();
  });
  it("finishes receipt/queue/directive admission when cancellation arrives after acceptance", async () => {
    const { service, ports, command, receipt, auth, events } = queuedSetup();
    const abort = new AbortController();
    vi.mocked(ports.execution.command).mockImplementation(async () => {
      events.push("command");
      abort.abort();
      return receipt;
    });
    await expect(service.dispatch(command, { ...auth, signal: abort.signal })).rejects.toThrow(
      "cancelled",
    );
    expect(events).toContain("consumed");
    expect(events).toContain("directive");
    expect(events).toContain("transaction:end");
  });
  it("kicks the waiting queue after a usage-limit change", async () => {
    const { service, ports, auth } = setup();
    await service.dispatch(
      { type: "usageLimit", sessionId: "s", commandId: "c", action: "dismiss" },
      auth,
    );
    expect(ports.queue.kick).toHaveBeenCalledWith("s");
    expect(ports.nativeProjection.withRetiredWriters).not.toHaveBeenCalled();
  });
  it("propagates execution failures without consuming a queued message or directive", async () => {
    const { service, ports, command, auth } = queuedSetup();
    vi.mocked(ports.execution.command).mockRejectedValue(new Error("provider refused"));
    await expect(service.dispatch(command, auth)).rejects.toThrow("provider refused");
    expect(ports.queue.consumed).not.toHaveBeenCalled();
    expect(ports.crews.ownerDirective).not.toHaveBeenCalled();
  });
});
