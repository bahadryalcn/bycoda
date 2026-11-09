import { expect, it, vi } from "vitest";
import { commonHostSessionExecutionClient, type SessionExecutionPort } from "./session-execution";

function fixture() {
  const port: SessionExecutionPort = {
    list: vi.fn(async () => []),
    page: vi.fn(async () => ({
      sync: { kind: "unchanged", revision: 1 },
      revision: 1,
      totalBlocks: 0,
    })),
    sync: vi.fn(async () => ({ kind: "unchanged", revision: 1 })),
    dispatch: vi.fn(async (command) => ({
      commandId: command.commandId,
      sessionId: "chat",
      revision: 1,
    })),
    status: vi.fn(async () => null),
  };
  return { port, client: commonHostSessionExecutionClient("owner", port) };
}

it("uses one explicit owner port for all reads and canonical command operations", async () => {
  const { port, client } = fixture();
  await client.listSessions({ projectId: "project" });
  await client.pageSession({ sessionId: "chat", before: 8, revision: 2, digests: true });
  await client.syncSession({
    sessionId: "chat",
    revision: 2,
    partial: true,
    loadedBlockIds: ["b"],
  });
  await client.dispatchCommand({
    type: "cancel",
    commandId: "stop",
    sessionId: "chat",
    runId: "run",
    authorityGeneration: 1,
  });
  await client.commandStatus("stop");
  expect(client.environmentId).toBe("owner");
  expect(port.page).toHaveBeenCalledWith({
    sessionId: "chat",
    before: 8,
    revision: 2,
    digests: true,
  });
  expect(port.status).toHaveBeenCalledWith("stop");
});

it("captures exact command payload before transport suspension", async () => {
  const { port, client } = fixture();
  const command = {
    type: "send" as const,
    commandId: "send",
    sessionId: "chat",
    text: "original",
    attachments: [],
  };
  const pending = client.dispatchCommand(command);
  command.text = "edited after submission";
  await pending;
  expect(port.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ text: "original", commandId: "send" }),
  );
});

it("uses a platform wire snapshot without a global clone API", async () => {
  const { port } = fixture();
  port.snapshotCommand = vi.fn((command) => JSON.parse(JSON.stringify(command)));
  const client = commonHostSessionExecutionClient("owner", port);
  const command = {
    type: "send" as const,
    commandId: "wire-original",
    sessionId: "chat",
    text: "original",
    attachments: [
      {
        id: "attachment",
        name: "original",
        mimeType: "text/plain",
        kind: "file" as const,
        size: 4,
      },
    ],
  };
  vi.stubGlobal("structuredClone", undefined);
  try {
    const pending = client.dispatchCommand(command);
    command.attachments[0].name = "edited";
    await pending;
    expect(port.snapshotCommand).toHaveBeenCalledOnce();
    expect(port.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "wire-original",
        attachments: [expect.objectContaining({ name: "original" })],
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("detaches a waiter without dispatching cancellation or retrying accepted work", async () => {
  const { port, client } = fixture();
  let finish!: (value: { commandId: string; sessionId: string; revision: number }) => void;
  let detach = () => {};
  const unsubscribe = vi.fn();
  vi.mocked(port.dispatch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = client.dispatchCommand(
    { type: "send", commandId: "send", sessionId: "chat", text: "work" },
    {
      signal: {
        aborted: false,
        subscribe: (listener) => {
          detach = listener;
          return unsubscribe;
        },
      },
    },
  );
  const rejected = expect(pending).rejects.toThrow("detached");
  await Promise.resolve();
  detach();
  finish({ commandId: "send", sessionId: "chat", revision: 1 });
  await rejected;
  expect(port.dispatch).toHaveBeenCalledOnce();
  expect(port.status).not.toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("never dispatches an already detached request and never falls back on owner failure", async () => {
  const { port, client } = fixture();
  await expect(
    client.commandStatus("old", { signal: { aborted: true, subscribe: vi.fn() } }),
  ).rejects.toThrow("detached");
  vi.mocked(port.dispatch).mockRejectedValue(new Error("owner offline"));
  await expect(
    client.dispatchCommand({
      type: "send",
      commandId: "original",
      sessionId: "chat",
      text: "work",
    }),
  ).rejects.toThrow("owner offline");
  expect(port.dispatch).toHaveBeenCalledOnce();
  expect(port.status).not.toHaveBeenCalled();
});

it("does not admit IO when the waiter aborts in the same tick before its scheduled start", async () => {
  const { port, client } = fixture();
  let abort = () => {};
  const signal = {
    aborted: false,
    subscribe: (listener: () => void) => {
      abort = listener;
      return () => {};
    },
  };
  const pending = client.dispatchCommand(
    { type: "send", commandId: "not-admitted", sessionId: "chat", text: "keep draft" },
    { signal },
  );
  const rejected = expect(pending).rejects.toThrow("detached");
  signal.aborted = true;
  abort();
  await rejected;
  await Promise.resolve();
  expect(port.dispatch).not.toHaveBeenCalled();
});
