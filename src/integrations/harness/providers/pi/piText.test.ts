import { processConstructions } from "../processConstruction.testSupport";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));

beforeEach(() => {
  processConstructions.reset();
  resolvePiBinary.mockReset().mockResolvedValue({ path: "/fake/pi" });
});
const resolvePiBinary = vi.fn(async () => ({ path: "/fake/pi" }));
vi.mock("../../core/child", () =>
  processConstructions.mock({
    killChild: async () => undefined,
    resolveOmpBinary: async () => ({ path: "/fake/omp" }),
    resolvePiBinary,
    spawnChild: async () => undefined,
    unwatchChild: () => undefined,
    watchChild: () => undefined,
  }),
);

vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(
      private readonly handle: import("../../core/child").ChildProcessHandle,
      onFrame: (record: Record<string, unknown>) => void,
    ) {
      processConstructions.client(handle);
      mocks.frames.push(onFrame);
    }

    assertProcess(handle: import("../../core/child").ChildProcessHandle) {
      if (handle !== this.handle) throw new Error("Foreign text process");
    }
    withWriter(writer: import("../../core/child").ChildTurnWriter) {
      return processConstructions.view(this.handle, writer, {
        request: mocks.request,
        cancelRequest: vi.fn(),
      });
    }
    request = mocks.request;
    close = mocks.close;
    pushLine = vi.fn();
  },
}));

const { runPiTextPrompt, stopPiTextPrompt } = await import("./piText");

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(() => {
  mocks.close.mockReset();
  mocks.request.mockReset().mockResolvedValue({ data: {} });
  mocks.frames.length = 0;
});

afterEach(async () => {
  await stopPiTextPrompt();
});

it("cancels binary-held A and binds B's PiRpc constructor call to B's handle", async () => {
  let release!: (value: { path: string }) => void;
  resolvePiBinary.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = runPiTextPrompt({ cwd: "/repo", prompt: "Never dispatch A" }).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => expect(resolvePiBinary).toHaveBeenCalledOnce());
    const original = processConstructions.created[0];
    expect(original).toBeDefined();
    await stopPiTextPrompt();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(
      processConstructions.operations.filter((operation) => operation.kind === "spawn"),
    ).toEqual([]);
    const second = runPiTextPrompt({ cwd: "/repo", prompt: "Dispatch B" });
    void second.catch(() => undefined);
    release({ path: "/late/pi-A" });
    expect(await first).toEqual(
      expect.objectContaining({ message: expect.stringContaining("startup cancelled") }),
    );
    await waitFor(
      () => mocks.request.mock.calls.some(([request]) => request.type === "prompt"),
      "B prompt",
    );
    const replacement = processConstructions.created[1];
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(original);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "client")
        .map((operation) => operation.handle),
    ).toEqual([original, replacement]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "spawn")
        .map((operation) => operation.handle),
    ).toEqual([replacement]);
    expect(
      processConstructions.operations
        .filter((operation) => operation.kind === "kill")
        .every((operation) => operation.handle === original),
    ).toBe(true);
    const frame = mocks.frames.at(-1)!;
    frame({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "B answer" },
    });
    frame({ type: "agent_settled" });
    await expect(second).resolves.toBe("B answer");
  } finally {
    release?.({ path: "/late/pi-A" });
    await stopPiTextPrompt();
  }
});

it("forwards Pi text and reasoning deltas to an isolated prompt", async () => {
  const events: HarnessEvent[] = [];
  const result = runPiTextPrompt({
    cwd: "/repo",
    model: "anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () => mocks.request.mock.calls.some(([request]) => request.type === "prompt"),
    "prompt",
  );
  const frame = mocks.frames[0]!;
  frame({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "Checking" },
  });
  frame({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Partial answer" },
  });
  frame({ type: "agent_settled" });

  await expect(result).resolves.toBe("Partial answer");
  expect(events).toEqual([
    { type: "reasoning.delta", text: "Checking" },
    { type: "message.delta", text: "Partial answer" },
  ]);
});
