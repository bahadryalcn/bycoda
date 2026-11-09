import type { HostRunHandle } from "../../core/hostRun";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../../core/types";
import { MINIMUM_OPENCODE_V2_VERSION } from "./opencodeProtocol";

let onStdout: ((line: string) => void) | undefined;
let onSseEvent: ((event: Record<string, unknown>) => void) | undefined;
let finishPrompt: ((value: { status: number; body: string }) => void) | undefined;
let promptStarted = false;
const closedNormalRuns = new WeakSet<object>();
const scopedBindings: Array<{ run: HostRunHandle; providerSessionId?: string }> = [];
const scopedHttp: Array<{
  run: HostRunHandle;
  providerSessionId?: string;
  method: string;
  url: string;
}> = [];
const processIo = vi.hoisted(() => ({
  create: vi.fn((sessionId: string) => Object.freeze({ sessionId })),
  spawn: vi.fn(),
  kill: vi.fn(),
  version: "opencode 1.14.19",
}));

const harnessHttp = vi.fn(
  async (input: { url: string; method: string }): Promise<{ status: number; body: string }> => {
    const url = new URL(input.url);
    if (input.method === "POST" && ["/session", "/api/session"].includes(url.pathname)) {
      return { status: 200, body: JSON.stringify({ id: "text_session" }) };
    }
    if (input.method === "POST" && url.pathname === "/session/text_session/message") {
      promptStarted = true;
      return new Promise((resolve) => {
        finishPrompt = resolve;
      });
    }
    return { status: 204, body: "" };
  },
);

vi.mock("../../core/child", () => ({
  createChildProcessHandle: processIo.create,
  closeHarnessSse: async () => undefined,
  execChild: async () => processIo.version,
  freeHarnessPort: async () => 4096,
  harnessHttp,
  captureHostHarnessHttp: (run: HostRunHandle, demand: { providerSessionId?: string }) => {
    scopedBindings.push({ run, providerSessionId: demand.providerSessionId });
    return async (input: { url: string; method: string }) => {
      if (closedNormalRuns.has(run)) throw new Error("Normal fixture HTTP run admission closed");
      scopedHttp.push({
        run,
        providerSessionId: demand.providerSessionId,
        method: input.method,
        url: input.url,
      });
      return harnessHttp(input);
    };
  },
  killChild: async (...args: unknown[]) => {
    processIo.kill(...args);
  },
  openHarnessSse: async () => undefined,
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
  capturedChildRoute: (handle: { sessionId: string }) => handle.sessionId,
  spawnChild: async (...args: unknown[]) => {
    processIo.spawn(...args);
    onStdout?.("opencode server listening on http://127.0.0.1:4096");
  },
  unwatchChild: () => undefined,
  watchChild: (_id: object, stdout: (line: string) => void) => {
    onStdout = stdout;
  },
  watchSse: (_id: string, event: (data: string) => void) => {
    onSseEvent = (value) => event(JSON.stringify(value));
  },
}));
vi.mock("./opencodeService", () => ({
  resolveOpenCodeV2Service: async () => ({ url: "http://127.0.0.1:4096", password: "fixture" }),
}));

const { runOpenCodeTextPrompt, stopOpenCodeTextPrompt, warmupOpenCodeText } =
  await import("./opencodeText");

async function waitFor(predicate: () => boolean, label: string) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function message(id: string, role: "assistant" | "user") {
  onSseEvent?.({
    type: "message.updated",
    properties: {
      info: { id, role, sessionID: "text_session" },
    },
  });
}

function part(messageID: string, text: string, ended = false) {
  onSseEvent?.({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part_${messageID}`,
        messageID,
        sessionID: "text_session",
        type: "text",
        text,
        time: ended ? { start: 1, end: 2 } : { start: 1 },
      },
    },
  });
}

function delta(messageID: string, text: string) {
  onSseEvent?.({
    type: "message.part.delta",
    properties: {
      sessionID: "text_session",
      partID: `part_${messageID}`,
      delta: text,
    },
  });
}

beforeEach(() => {
  onStdout = undefined;
  onSseEvent = undefined;
  finishPrompt = undefined;
  promptStarted = false;
  scopedHttp.length = 0;
  scopedBindings.length = 0;
  harnessHttp.mockClear();
  processIo.create.mockClear();
  processIo.spawn.mockClear();
  processIo.kill.mockClear();
  processIo.version = "opencode 1.14.19";
});

afterEach(async () => {
  await stopOpenCodeTextPrompt();
});

it("forwards only incremental OpenCode assistant text", async () => {
  const events: HarnessEvent[] = [];
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openrouter/anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => promptStarted, "prompt");
  message("user_message", "user");
  part("user_message", "question");
  message("assistant_message", "assistant");
  part("assistant_message", "Hel");
  part("assistant_message", "Hello");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({
      info: {},
      parts: [{ type: "text", text: "Hello" }],
    }),
  });

  await expect(result).resolves.toBe("Hello");
  expect(harnessHttp).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "DELETE",
      url: "http://127.0.0.1:4096/session/text_session?directory=%2Frepo",
    }),
  );
  expect(events).toEqual([
    { type: "message.delta", text: "Hel" },
    { type: "message.delta", text: "lo" },
  ]);
  const original = processIo.create.mock.results[0].value;
  expect(processIo.spawn.mock.calls[0][0]).toBe(original);
  expect(processIo.kill).toHaveBeenCalledWith(original);
});

it("does not invent or terminate a child for an external OpenCode v2 service", async () => {
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  await warmupOpenCodeText("/repo");
  expect(harnessHttp).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      url: expect.stringContaining("/api/session"),
    }),
  );
  await stopOpenCodeTextPrompt();
  expect(processIo.create).not.toHaveBeenCalled();
  expect(processIo.spawn).not.toHaveBeenCalled();
  expect(processIo.kill).not.toHaveBeenCalled();
});

it("does not replay a delta after a stale snapshot", async () => {
  const events: HarnessEvent[] = [];
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openrouter/anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => promptStarted, "prompt");
  message("assistant_message", "assistant");
  part("assistant_message", "Hello");
  part("assistant_message", "Hel");
  delta("assistant_message", "!");
  message("assistant_message", "assistant");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({
      info: {},
      parts: [{ type: "text", text: "Hello!" }],
    }),
  });

  await expect(result).resolves.toBe("Hello!");
  expect(events).toEqual([
    { type: "message.delta", text: "Hello" },
    { type: "message.delta", text: "!" },
  ]);
});

it("does not replay a delta after an out-of-order completed snapshot", async () => {
  const events: HarnessEvent[] = [];
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openrouter/anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => promptStarted, "prompt");
  message("assistant_message", "assistant");
  part("assistant_message", "Hello", true);
  part("assistant_message", "");
  delta("assistant_message", "lo");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({
      info: {},
      parts: [{ type: "text", text: "Hello" }],
    }),
  });

  await expect(result).resolves.toBe("Hello");
  expect(events).toEqual([{ type: "message.delta", text: "Hello" }]);
});

it("buffers a delta that arrives before its part snapshot", async () => {
  const events: HarnessEvent[] = [];
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openrouter/anthropic/claude-haiku",
    prompt: "question",
    onEvent: (event) => events.push(event),
  });

  await waitFor(() => promptStarted, "prompt");
  delta("assistant_message", "Hel");
  message("assistant_message", "assistant");
  part("assistant_message", "");
  delta("assistant_message", "lo");
  part("assistant_message", "Hello", true);
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({
      info: {},
      parts: [{ type: "text", text: "Hello" }],
    }),
  });

  await expect(result).resolves.toBe("Hello");
  expect(events).toEqual([
    { type: "message.delta", text: "Hel" },
    { type: "message.delta", text: "lo" },
  ]);
});

it("deletes the generated-text session when the provider returns an error", async () => {
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openai/test",
    prompt: "Generate text",
  });
  await waitFor(() => promptStarted, "prompt");
  finishPrompt?.({
    status: 200,
    body: JSON.stringify({ info: { error: { message: "Generation failed" } } }),
  });
  await expect(result).rejects.toThrow("Generation failed");
  expect(harnessHttp).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "DELETE",
      url: "http://127.0.0.1:4096/session/text_session?directory=%2Frepo",
    }),
  );
});

it("deletes the generated-text session when generation is cancelled", async () => {
  const controller = new AbortController();
  const result = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openai/test",
    prompt: "Generate text",
    signal: controller.signal,
  });
  await waitFor(() => promptStarted, "prompt");
  controller.abort();
  await expect(result).rejects.toThrow("By-the-way request cancelled");
  expect(harnessHttp).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "DELETE",
      url: "http://127.0.0.1:4096/session/text_session?directory=%2Frepo",
    }),
  );
});

// Protocol HTTP fixture only: it proves original remote-request ownership,
// never a Native process retirement or an external provider acknowledgement.
it("holds original pending remote creation through Stop and deletes only its late-created session", async () => {
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  let finishCreation!: (value: { status: number; body: string }) => void;
  harnessHttp.mockImplementationOnce(async (input) => {
    expect(input.method).toBe("POST");
    expect(new URL(input.url).pathname).toBe("/api/session");
    return new Promise((resolve) => {
      finishCreation = resolve;
    });
  });
  const starting = warmupOpenCodeText("/original-pending");
  await waitFor(() => !!finishCreation, "original session creation");
  let stopped = false;
  const stopping = stopOpenCodeTextPrompt().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(stopped).toBe(false);
  expect(promptStarted).toBe(false);
  finishCreation({ status: 200, body: JSON.stringify({ id: "late_original_session" }) });
  await stopping;
  await starting;
  const cleanup = harnessHttp.mock.calls.map(([input]) => ({
    method: input.method,
    path: new URL(input.url).pathname,
  }));
  expect(cleanup).toContainEqual({
    method: "POST",
    path: "/api/session/late_original_session/interrupt",
  });
  expect(cleanup).toContainEqual({ method: "DELETE", path: "/api/session/late_original_session" });
  expect(cleanup.some((request) => request.path.endsWith("/message"))).toBe(false);
  await warmupOpenCodeText("/explicit-fresh");
  await stopOpenCodeTextPrompt();
  expect(
    harnessHttp.mock.calls.filter(
      ([input]) =>
        input.method === "DELETE" &&
        new URL(input.url).pathname === "/api/session/late_original_session",
    ),
  ).toHaveLength(1);
  expect(processIo.create).not.toHaveBeenCalled();
  expect(processIo.kill).not.toHaveBeenCalled();
});

it("keeps original HTTP naming scopes and created session identities through queued cleanup", async () => {
  // Actual text pool/OpenCodeClient, controlled HTTP source dispatcher only.
  // This is not the Host issuer's authority/provenance or SSE/OS acceptance.
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  const sourceA = Object.freeze({}) as HostRunHandle;
  const sourceB = Object.freeze({}) as HostRunHandle;
  const controlA = Object.freeze({}) as HostRunHandle;
  const controlB = Object.freeze({}) as HostRunHandle;
  const contextA = { operation: {}, hostRun: sourceA, hostControlRun: controlA };
  const contextB = { operation: {}, hostRun: sourceB, hostControlRun: controlB };
  const originalHttp = harnessHttp.getMockImplementation()!;
  const generate = new Map<string, (value: { status: number; body: string }) => void>();
  let created = 0;
  let releaseDelete!: () => void;
  let deleteEntered = false;
  harnessHttp.mockImplementation(async (input) => {
    const path = new URL(input.url).pathname;
    if (input.method === "POST" && path === "/api/session")
      return {
        status: 200,
        body: JSON.stringify({ id: ++created === 1 ? "original_A" : "original_B" }),
      };
    if (path.endsWith("/generate"))
      return new Promise((resolve) => {
        generate.set(path, resolve);
      });
    if (input.method === "DELETE" && path === "/api/session/original_A") {
      deleteEntered = true;
      await new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
    }
    return { status: 204, body: "" };
  });
  const a = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openai/test",
    prompt: "A name",
    operationContext: contextA,
  });
  void a.catch(() => undefined);
  contextA.hostRun = sourceB;
  contextA.hostControlRun = controlB;
  await waitFor(() => generate.has("/api/session/original_A/generate"), "A scoped generation");
  const b = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openai/test",
    prompt: "B name",
    operationContext: contextB,
  });
  void b.catch(() => undefined);
  contextB.hostRun = sourceA;
  contextB.hostControlRun = controlA;
  try {
    generate.get("/api/session/original_A/generate")!({
      status: 200,
      body: JSON.stringify({ text: "A result" }),
    });
    await waitFor(() => deleteEntered, "A original delete");
    expect(created).toBe(1);
    expect(scopedHttp.every((entry) => entry.run === sourceA || entry.run === controlA)).toBe(true);
    expect(
      scopedHttp
        .filter((entry) => new URL(entry.url).pathname.includes("/original_A"))
        .every((entry) => entry.providerSessionId === "original_A"),
    ).toBe(true);
    releaseDelete();
    await expect(a).resolves.toBe("A result");
    await waitFor(() => generate.has("/api/session/original_B/generate"), "B scoped generation");
    const bEffects = scopedHttp.filter((entry) => entry.run === sourceB);
    expect(bEffects.length).toBeGreaterThan(0);
    expect(
      bEffects
        .filter((entry) => new URL(entry.url).pathname.includes("/original_B"))
        .every((entry) => entry.providerSessionId === "original_B"),
    ).toBe(true);
    generate.get("/api/session/original_B/generate")!({
      status: 200,
      body: JSON.stringify({ text: "B result" }),
    });
    await expect(b).resolves.toBe("B result");
    expect(scopedHttp).toHaveLength(harnessHttp.mock.calls.length);
    expect(
      scopedHttp
        .filter((entry) => entry.method === "DELETE")
        .map((entry) => ({ run: entry.run, id: entry.providerSessionId })),
    ).toEqual([
      { run: controlA, id: "original_A" },
      { run: controlB, id: "original_B" },
    ]);
    expect(processIo.create).not.toHaveBeenCalled();
    expect(processIo.spawn).not.toHaveBeenCalled();
    expect(processIo.kill).not.toHaveBeenCalled();
  } finally {
    releaseDelete?.();
    generate.get("/api/session/original_A/generate")?.({
      status: 200,
      body: JSON.stringify({ text: "A result" }),
    });
    generate.get("/api/session/original_B/generate")?.({
      status: 200,
      body: JSON.stringify({ text: "B result" }),
    });
    await stopOpenCodeTextPrompt();
    await Promise.allSettled([a, b]);
    harnessHttp.mockImplementation(originalHttp);
  }
});

it("uses the exact original HTTP cleanup capability after normal admission closes", async () => {
  // Controlled HTTP dispatcher; strict real Host target/role proof is tested by
  // the issuer owner. No normal/raw fallback can make this fixture succeed.
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  const normal = Object.freeze({}) as HostRunHandle;
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation: {}, hostRun: normal, hostControlRun: control };
  const controller = new AbortController();
  const originalHttp = harnessHttp.getMockImplementation()!;
  let generation!: (value: { status: number; body: string }) => void;
  harnessHttp.mockImplementation(async (input) => {
    const path = new URL(input.url).pathname;
    if (input.method === "POST" && path === "/api/session")
      return { status: 200, body: JSON.stringify({ id: "cancelled_original" }) };
    if (path === "/api/session/cancelled_original/generate")
      return new Promise((resolve) => {
        generation = resolve;
      });
    return { status: 204, body: "" };
  });
  const work = runOpenCodeTextPrompt({
    cwd: "/repo",
    model: "openai/test",
    prompt: "Original text",
    signal: controller.signal,
    operationContext: context,
  });
  const failure = work.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await waitFor(() => !!generation, "original HTTP generation");
    closedNormalRuns.add(normal);
    context.hostControlRun = Object.freeze({}) as HostRunHandle;
    controller.abort();
    expect(await failure).toEqual(
      expect.objectContaining({ message: "By-the-way request cancelled" }),
    );
    const cleanup = scopedHttp.filter((entry) => entry.run === control);
    expect(
      cleanup.some(
        (entry) => new URL(entry.url).pathname === "/api/session/cancelled_original/interrupt",
      ),
    ).toBe(true);
    expect(
      cleanup.some(
        (entry) =>
          entry.method === "DELETE" &&
          new URL(entry.url).pathname === "/api/session/cancelled_original",
      ),
    ).toBe(true);
    expect(
      cleanup.every(
        (entry) =>
          entry.providerSessionId === "cancelled_original" &&
          (entry.method === "DELETE" || new URL(entry.url).pathname.endsWith("/interrupt")),
      ),
    ).toBe(true);
    expect(
      scopedHttp
        .filter((entry) => new URL(entry.url).pathname === "/api/session")
        .every((entry) => entry.run === normal && entry.providerSessionId === undefined),
    ).toBe(true);
    expect(processIo.create).not.toHaveBeenCalled();
  } finally {
    generation?.({ status: 200, body: JSON.stringify({ text: "late original response" }) });
    await failure;
    await stopOpenCodeTextPrompt();
    harnessHttp.mockImplementation(originalHttp);
  }
});
it("rejects missing Host text cleanup authority before version/service/HTTP effects", async () => {
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  await expect(
    runOpenCodeTextPrompt({
      cwd: "/repo",
      prompt: "No cleanup owner",
      operationContext: { operation: {}, hostRun: Object.freeze({}) as HostRunHandle },
    }),
  ).rejects.toThrow("cleanup run is required");
  expect(processIo.create).not.toHaveBeenCalled();
  expect(processIo.spawn).not.toHaveBeenCalled();
  expect(harnessHttp).not.toHaveBeenCalled();
  expect(scopedHttp).toEqual([]);
});

it("retires a late-created session with original control without opening a new normal binding", async () => {
  processIo.version = `opencode ${MINIMUM_OPENCODE_V2_VERSION}`;
  const normal = Object.freeze({}) as HostRunHandle;
  const control = Object.freeze({}) as HostRunHandle;
  const context = { operation: {}, hostRun: normal, hostControlRun: control };
  const originalHttp = harnessHttp.getMockImplementation()!;
  let creation!: (value: { status: number; body: string }) => void;
  harnessHttp.mockImplementation(async (input) => {
    if (input.method === "POST" && new URL(input.url).pathname === "/api/session")
      return new Promise((resolve) => {
        creation = resolve;
      });
    return { status: 204, body: "" };
  });
  const work = runOpenCodeTextPrompt({
    cwd: "/repo",
    prompt: "Never prompt late A",
    operationContext: context,
  });
  const failure = work.then(
    () => undefined,
    (error: unknown) => error,
  );
  let stopping: Promise<void> | undefined;
  try {
    await waitFor(() => !!creation, "original pending create");
    closedNormalRuns.add(normal);
    context.hostControlRun = Object.freeze({}) as HostRunHandle;
    stopping = stopOpenCodeTextPrompt();
    creation({ status: 200, body: JSON.stringify({ id: "late_original_A" }) });
    await stopping;
    expect(await failure).toEqual(
      expect.objectContaining({ message: "OpenCode text generator stopped" }),
    );
    expect(scopedBindings.filter((entry) => entry.run === normal)).toEqual([
      { run: normal, providerSessionId: undefined },
    ]);
    expect(scopedBindings.filter((entry) => entry.run === control)).toEqual([
      { run: control, providerSessionId: "late_original_A" },
    ]);
    expect(
      scopedHttp
        .filter((entry) => entry.run === control)
        .map((entry) => ({ method: entry.method, path: new URL(entry.url).pathname })),
    ).toEqual([
      { method: "POST", path: "/api/session/late_original_A/interrupt" },
      { method: "DELETE", path: "/api/session/late_original_A" },
    ]);
    expect(scopedHttp.some((entry) => /generate|message/.test(new URL(entry.url).pathname))).toBe(
      false,
    );
    expect(processIo.create).not.toHaveBeenCalled();
  } finally {
    creation?.({ status: 200, body: JSON.stringify({ id: "late_original_A" }) });
    await Promise.allSettled([failure, ...(stopping ? [stopping] : [])]);
    await stopOpenCodeTextPrompt();
    harnessHttp.mockImplementation(originalHttp);
  }
});
