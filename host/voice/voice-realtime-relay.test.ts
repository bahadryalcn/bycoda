import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import type { AddressInfo } from "node:net";
import type { HostDomainContext } from "../domains/context";
import {
  decodeRelayPcm,
  encodeRelayPcm,
  RELAY_RECAP_MAX_CHARS,
  RELAY_RECAP_TURNS,
  RELAY_ROTATE_AFTER_MS,
  RELAY_ROTATION_ACTIVITY_MS,
  relayRecap,
  resamplePcm16,
  VoiceRealtimeRelays,
  type VoiceRelayDependencies,
} from "./voice-realtime-relay";
import { DEFAULT_VOICE_CALL_SETTINGS } from "./voice-call-settings";

const SECRET = "ephemeral-test-secret";
type Provider = {
  server: WebSocketServer;
  received: Record<string, unknown>[];
  protocols: string[];
  socket?: ServerSocket;
  /** Every provider session opened, in order, with the events it received. */
  connections: { socket: ServerSocket; received: Record<string, unknown>[]; closed: boolean }[];
  closed: boolean;
  send(event: Record<string, unknown>): void;
  waitFor(type: string, count?: number): Promise<Record<string, unknown>>;
};

const providers: Provider[] = [];
afterEach(async () => {
  for (const provider of providers.splice(0)) await new Promise((r) => provider.server.close(r));
});

/** A provider realtime socket on loopback that confirms the session and records every event. */
async function fakeProvider(): Promise<Provider> {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const listeners = new Set<() => void>();
  const provider: Provider = {
    server,
    received: [],
    protocols: [],
    connections: [],
    closed: false,
    send: (event) => provider.socket?.send(JSON.stringify(event)),
    waitFor: (type, count = 1) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${type}`)), 4000);
        const check = () => {
          const matches = provider.received.filter((event) => event.type === type);
          if (matches.length < count) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(matches[count - 1]!);
        };
        listeners.add(check);
        check();
      }),
  };
  server.on("connection", (socket, request) => {
    provider.socket = socket;
    const connection = { socket, received: [] as Record<string, unknown>[], closed: false };
    provider.connections.push(connection);
    provider.protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(/,\s*/);
    socket.on("close", () => {
      connection.closed = true;
      provider.closed = true;
      // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: a listener may unsubscribe while the set is iterated
      for (const listener of [...listeners]) listener();
    });
    socket.on("message", (data) => {
      const event = JSON.parse(String(data)) as Record<string, unknown>;
      provider.received.push(event);
      connection.received.push(event);
      if (event.type === "session.update") socket.send(JSON.stringify({ type: "session.updated" }));
      // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: a listener may unsubscribe while the set is iterated
      for (const listener of [...listeners]) listener();
    });
  });
  providers.push(provider);
  return provider;
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

function context(device = "device-a", authorized = { value: true }): HostDomainContext {
  return { principalId: device, authorized: async () => authorized.value };
}

async function setup(
  overrides: Partial<VoiceRelayDependencies> = {},
  settings = DEFAULT_VOICE_CALL_SETTINGS,
) {
  const provider = await fakeProvider();
  const port = (provider.server.address() as AddressInfo).port;
  const assistantRequest = vi.fn(async (raw: unknown): Promise<unknown> => {
    const request = raw as { op: string };
    if (request.op === "threads.sendIdentity") return { sendIdentity: { instanceId: "host-1" } };
    return { messages: [{ role: "assistant", text: "Two sessions are running.", projectIds: [] }] };
  });
  const dependencies: VoiceRelayDependencies = {
    secret: async () => ({
      value: SECRET,
      expires_at: Date.now() / 1000 + 60,
      model: "test-model",
      url: `ws://127.0.0.1:${port}/v1/realtime?model=test-model`,
    }),
    settings: async () => settings,
    threadBinding: async (id) => (id === "room-1" ? { id, projectId: "project-1" } : null),
    assistantRequest,
    projectDirectory: async () => ({ privacyReady: true, projects: [] }),
    ...overrides,
  };
  const relays = new VoiceRealtimeRelays(dependencies);
  return { provider, relays, assistantRequest, dependencies };
}

/** Voiced speech (a 200 Hz tone) then silence, as the phone's 100 ms frames. */
function speechFrames(speechMs: number, silenceMs: number) {
  const frames: string[] = [];
  const total = ((speechMs + silenceMs) / 1000) * 16000;
  const speech = (speechMs / 1000) * 16000;
  for (let start = 0; start < total; start += 1600) {
    const frame = new Int16Array(1600);
    for (let i = 0; i < frame.length; i++)
      frame[i] =
        start + i < speech
          ? Math.round(Math.sin((2 * Math.PI * 200 * (start + i)) / 16000) * 9000)
          : 0;
    frames.push(encodeRelayPcm(frame));
  }
  return frames;
}

describe("phone realtime voice relay", () => {
  it("opens the provider on this computer and keeps the credential out of every phone result", async () => {
    const { provider, relays } = await setup(
      {},
      { ...DEFAULT_VOICE_CALL_SETTINGS, openaiVoice: "cedar" },
    );
    const started = await relays.start(
      { threadId: "room-1", provider: "openai", language: "tr", projectId: "project-1" },
      context(),
    );
    expect(started).toEqual({ lease: expect.any(String), inRate: 16000, outRate: 24000 });
    expect(JSON.stringify(started)).not.toContain(SECRET);
    expect(provider.protocols).toContain(`openai-insecure-api-key.${SECRET}`);
    const update = (await provider.waitFor("session.update")).session as Record<string, unknown>;
    expect(update.tools).toEqual([
      expect.objectContaining({ name: "ask_assistant", type: "function" }),
    ]);
    expect(update.instructions).toContain("ask_assistant");
    expect(update.model).toBe("test-model");
    const audio = update.audio as { input: { turn_detection: unknown }; output: { voice: string } };
    expect(audio.input.turn_detection).toBeNull();
    expect(audio.output.voice).toBe("cedar");
    const next = await relays.next({ lease: started.lease, cursor: 0 }, context());
    expect(next.events).toEqual([expect.objectContaining({ type: "state", state: "listening" })]);
    expect(JSON.stringify(next)).not.toContain(SECRET);
    relays.close();
  });

  it("commits a finished spoken turn as upsampled audio, then asks for exactly one response", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start(
      { threadId: "room-1", provider: "xai", duplex: false },
      context(),
    );
    expect(provider.protocols).toContain(`xai-client-secret.${SECRET}`);
    const update = (await provider.waitFor("session.update")).session as Record<string, unknown>;
    expect(update.turn_detection).toEqual({ type: null });
    let seq = 0;
    for (const audio of speechFrames(800, 1600))
      relays.audio({ lease, seq: seq++, audio }, context());
    await provider.waitFor("response.create");
    const types = provider.received.map((event) => event.type);
    const commit = types.indexOf("input_audio_buffer.commit");
    expect(types.indexOf("input_audio_buffer.append")).toBeLessThan(commit);
    expect(commit).toBeLessThan(types.indexOf("response.create"));
    expect(types.filter((type) => type === "response.create")).toHaveLength(1);
    const appended = provider.received
      .filter((event) => event.type === "input_audio_buffer.append")
      .reduce((sum, event) => sum + Buffer.from(String(event.audio), "base64").length / 2, 0);
    // 24 kHz: at least the 0.8 s of speech, upsampled 1.5×.
    expect(appended).toBeGreaterThanOrEqual(0.8 * 24000);
    // Half-duplex: further audio while the reply is produced is ignored.
    const ignored = relays.audio({ lease, seq: seq++, audio: speechFrames(100, 0)[0]! }, context());
    expect(ignored).toEqual({ accepted: false });
    relays.close();
  });

  it("delivers reply audio and transcripts in order, and a tap truncates and drops the rest", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    let cursor = (await relays.next({ lease, cursor: 0 }, context())).cursor;
    const delta = encodeRelayPcm(new Int16Array(4800)); // 200 ms at 24 kHz
    provider.send({ type: "response.created", response: { id: "resp-1" } });
    provider.send({
      type: "response.output_audio.delta",
      response_id: "resp-1",
      item_id: "item-1",
      content_index: 0,
      delta,
    });
    provider.send({
      type: "response.output_audio_transcript.delta",
      response_id: "resp-1",
      delta: "Merhaba",
    });
    provider.send({
      type: "response.output_audio.delta",
      response_id: "resp-1",
      item_id: "item-1",
      content_index: 0,
      delta,
    });
    await new Promise((r) => setTimeout(r, 100));
    const first = await relays.next({ lease, cursor }, context());
    expect(first.chunks.map((chunk) => chunk.responseId)).toEqual(["resp-1", "resp-1"]);
    expect(first.events).toContainEqual(
      expect.objectContaining({ type: "state", state: "speaking" }),
    );
    cursor = first.cursor;
    provider.send({
      type: "response.output_audio.delta",
      response_id: "resp-1",
      item_id: "item-1",
      content_index: 0,
      delta,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(relays.interrupt({ lease, playedMs: 150 }, context())).toEqual({ interrupted: true });
    const cancel = await provider.waitFor("response.cancel");
    expect(cancel.response_id).toBe("resp-1");
    const truncate = await provider.waitFor("conversation.item.truncate");
    expect(truncate).toMatchObject({ item_id: "item-1", content_index: 0, audio_end_ms: 150 });
    // A late delta of the cancelled reply is not queued.
    provider.send({
      type: "response.output_audio.delta",
      response_id: "resp-1",
      item_id: "item-1",
      content_index: 0,
      delta,
    });
    await new Promise((r) => setTimeout(r, 50));
    const after = await relays.next({ lease, cursor }, context());
    expect(after.chunks).toEqual([]);
    expect(after.events.map((event) => event.type)).toContain("interrupted");
    expect(after.events).toContainEqual(
      expect.objectContaining({ type: "state", state: "listening" }),
    );
    relays.close();
  });

  it("answers ask_assistant through the call's own conversation and continues after the tool", async () => {
    const { provider, relays, assistantRequest } = await setup();
    const device = context();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, device);
    await provider.waitFor("session.update");
    provider.send({ type: "response.created", response: { id: "resp-1" } });
    provider.send({
      type: "response.function_call_arguments.done",
      response_id: "resp-1",
      call_id: "call-1",
      name: "ask_assistant",
      arguments: JSON.stringify({ request: "Hangi oturumlar çalışıyor?" }),
    });
    provider.send({ type: "response.done", response: { id: "resp-1" } });
    const output = await provider.waitFor("conversation.item.create");
    expect(output.item).toMatchObject({ type: "function_call_output", call_id: "call-1" });
    expect(String((output.item as { output: string }).output)).toContain(
      "Two sessions are running.",
    );
    await provider.waitFor("response.create");
    expect(assistantRequest).toHaveBeenNthCalledWith(
      1,
      { op: "threads.sendIdentity" },
      expect.anything(),
    );
    expect(assistantRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        op: "threads.send",
        via: "text",
        threadId: "room-1",
        text: "Hangi oturumlar çalışıyor?",
        expectedHostInstance: "host-1",
      }),
      expect.objectContaining({ principalId: "device-a" }),
    );
    expect(lease).toBeTruthy();
    relays.close();
  });

  it("refuses the tool when the conversation moved to another project, and hides unseen projects", async () => {
    let project = "project-1";
    const { provider, relays, assistantRequest } = await setup({
      threadBinding: async (id) => ({ id, projectId: project }),
      projectDirectory: async () => ({
        privacyReady: true,
        projects: [{ id: "project-1", registered: true }],
      }),
    });
    await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    project = "project-2";
    provider.send({
      type: "response.function_call_arguments.done",
      call_id: "call-1",
      name: "ask_assistant",
      arguments: JSON.stringify({ request: "status" }),
    });
    const refused = await provider.waitFor("conversation.item.create");
    expect(String((refused.item as { output: string }).output)).toContain("another project");
    expect(assistantRequest).not.toHaveBeenCalled();
    project = "project-1";
    assistantRequest.mockImplementation(async (raw: unknown) =>
      (raw as { op: string }).op === "threads.sendIdentity"
        ? { sendIdentity: { instanceId: "host-1" } }
        : {
            messages: [{ role: "assistant", text: "secret plan", projectIds: ["hidden-project"] }],
          },
    );
    provider.send({
      type: "response.function_call_arguments.done",
      call_id: "call-2",
      name: "ask_assistant",
      arguments: JSON.stringify({ request: "status" }),
    });
    const hidden = await provider.waitFor("conversation.item.create", 2);
    expect(String((hidden.item as { output: string }).output)).not.toContain("secret plan");
    expect(String((hidden.item as { output: string }).output)).toContain("project access");
    relays.close();
  });

  it("closes the provider socket when the device authority is revoked", async () => {
    const authority = { value: true };
    const { provider, relays, assistantRequest } = await setup();
    const { lease } = await relays.start(
      { threadId: "room-1", provider: "openai" },
      context("device-a", authority),
    );
    await provider.waitFor("session.update");
    authority.value = false;
    provider.send({
      type: "response.function_call_arguments.done",
      call_id: "call-1",
      name: "ask_assistant",
      arguments: JSON.stringify({ request: "status" }),
    });
    await until(() => provider.closed);
    expect(assistantRequest).not.toHaveBeenCalled();
    const next = await relays.next({ lease, cursor: 0 }, context("device-a", authority));
    expect(next.events).toContainEqual(
      expect.objectContaining({ type: "ended", reason: "revoked" }),
    );
    expect(relays.activeCount).toBe(0);
  });

  it("keeps one relay per device and binds every call to the device that started it", async () => {
    const { provider, relays } = await setup();
    const first = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    const second = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    expect(relays.activeCount).toBe(1);
    const ended = await relays.next({ lease: first.lease, cursor: 0 }, context());
    expect(ended.events).toContainEqual(
      expect.objectContaining({ type: "ended", reason: "replaced" }),
    );
    expect(() =>
      relays.audio({ lease: second.lease, seq: 0, audio: "AAAA" }, context("device-b")),
    ).toThrow("no longer active");
    await expect(
      relays.start({ threadId: "unknown-room", provider: "openai" }, context()),
    ).rejects.toThrow("unavailable");
    await expect(
      relays.start({ threadId: "room-1", provider: "openai", projectId: "project-9" }, context()),
    ).rejects.toThrow("another project");
    expect(
      provider.received.filter((event) => event.type === "session.update").length,
    ).toBeGreaterThan(0);
    relays.close();
  });

  it("refuses malformed, out-of-order and faster-than-real-time uplink", async () => {
    let now = 1_000_000;
    const { relays } = await setup({ now: () => now });
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    expect(() => decodeRelayPcm("AAA")).toThrow("Invalid voice audio.");
    expect(() => decodeRelayPcm("A".repeat(87_388))).toThrow("Invalid voice audio.");
    expect(() => relays.audio({ lease, seq: 0, audio: "not base64!" }, context())).toThrow(
      "Invalid",
    );
    const second = encodeRelayPcm(new Int16Array(16000));
    relays.audio({ lease, seq: 1, audio: second }, context());
    expect(() => relays.audio({ lease, seq: 1, audio: second }, context())).toThrow("out of order");
    let seq = 2;
    expect(() => {
      for (let i = 0; i < 10; i++) relays.audio({ lease, seq: seq++, audio: second }, context());
    }).toThrow("faster than real time");
    now += 20_000;
    expect(relays.audio({ lease, seq: seq++, audio: second }, context())).toEqual({
      accepted: true,
    });
    relays.close();
  });

  /** A reply in progress with `ms` of its audio already sent to the phone. */
  async function replying(provider: Provider, id = "resp-1", ms = 2000) {
    provider.send({ type: "response.created", response: { id } });
    provider.send({
      type: "response.output_audio.delta",
      response_id: id,
      item_id: `item-${id}`,
      content_index: 0,
      delta: encodeRelayPcm(new Int16Array((ms / 1000) * 24000)),
    });
    await new Promise((r) => setTimeout(r, 100));
  }
  const types = (provider: Provider) => provider.received.map((event) => event.type);

  it("cuts a reply when the owner talks over it, truncates at what the phone played, and answers the speech", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    await replying(provider);
    let seq = 0;
    for (const audio of speechFrames(800, 1600))
      expect(relays.audio({ lease, seq: seq++, audio, playedMs: 400 }, context())).toEqual({
        accepted: true,
      });
    const cancel = await provider.waitFor("response.cancel");
    expect(cancel.response_id).toBe("resp-1");
    const truncate = await provider.waitFor("conversation.item.truncate");
    expect(truncate).toMatchObject({ item_id: "item-resp-1", content_index: 0, audio_end_ms: 400 });
    // The speech is the next turn, but only once the cancelled response is done: one in flight.
    expect(types(provider)).not.toContain("input_audio_buffer.commit");
    provider.send({ type: "response.done", response: { id: "resp-1", status: "cancelled" } });
    await provider.waitFor("response.create");
    const order = types(provider);
    expect(order.indexOf("response.cancel")).toBeLessThan(
      order.indexOf("input_audio_buffer.commit"),
    );
    expect(order.indexOf("input_audio_buffer.commit")).toBeLessThan(
      order.indexOf("response.create"),
    );
    const next = await relays.next({ lease, cursor: 0 }, context());
    expect(next.chunks).toEqual([]);
    expect(next.events.map((event) => event.type)).toContain("interrupted");
    relays.close();
  });

  it("falls back to its own playback estimate when the phone reports nothing played", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    await replying(provider, "resp-1", 3000);
    let seq = 0;
    for (const audio of speechFrames(800, 0)) relays.audio({ lease, seq: seq++, audio }, context());
    const truncate = await provider.waitFor("conversation.item.truncate");
    // About the 0.1-0.3 s that passed since the audio went out, never the whole 3 s that was sent.
    expect(truncate.audio_end_ms).toBeGreaterThanOrEqual(0);
    expect(truncate.audio_end_ms).toBeLessThan(1500);
    relays.close();
  });

  it("ignores a short echo blip during a reply: no cut, and it never becomes a turn", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    await replying(provider);
    let seq = 0;
    // Long enough for the VAD's strict onset, too short to stay loud through the confirmation.
    for (const audio of speechFrames(300, 1600))
      relays.audio({ lease, seq: seq++, audio, playedMs: 200 }, context());
    // Quiet residue (well below the barge-in energy) also never cuts the reply.
    const quiet = new Int16Array(1600).map((_, i) =>
      Math.round(Math.sin((2 * Math.PI * 200 * i) / 16000) * 300),
    );
    for (let i = 0; i < 6; i++)
      relays.audio({ lease, seq: seq++, audio: encodeRelayPcm(quiet) }, context());
    await new Promise((r) => setTimeout(r, 150));
    expect(types(provider)).not.toContain("response.cancel");
    expect(types(provider)).not.toContain("conversation.item.truncate");
    provider.send({ type: "response.done", response: { id: "resp-1" } });
    await new Promise((r) => setTimeout(r, 150));
    expect(types(provider)).not.toContain("input_audio_buffer.commit");
    expect(types(provider)).not.toContain("response.create");
    relays.close();
  });

  it("stays half-duplex for a phone without echo cancellation", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start(
      { threadId: "room-1", provider: "openai", duplex: false },
      context(),
    );
    await provider.waitFor("session.update");
    await replying(provider);
    let seq = 0;
    for (const audio of speechFrames(800, 400))
      expect(relays.audio({ lease, seq: seq++, audio, playedMs: 400 }, context())).toEqual({
        accepted: false,
      });
    await new Promise((r) => setTimeout(r, 100));
    expect(types(provider)).not.toContain("response.cancel");
    // A tap still interrupts.
    relays.interrupt({ lease, playedMs: 250 }, context());
    expect((await provider.waitFor("conversation.item.truncate")).audio_end_ms).toBe(250);
    relays.close();
  });

  it("queues typed messages behind the response in flight and sends them one response at a time, in order", async () => {
    const { provider, relays } = await setup();
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    provider.send({ type: "response.created", response: { id: "resp-1" } });
    provider.send({
      type: "response.output_audio_transcript.delta",
      response_id: "resp-1",
      delta: "First reply.",
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(relays.text({ lease, text: "  Typed one  " }, context())).toEqual({ queued: true });
    expect(relays.text({ lease, text: "Typed two" }, context())).toEqual({ queued: true });
    expect(() => relays.text({ lease, text: "   " }, context())).toThrow("empty or too long");
    expect(() => relays.text({ lease, text: "x".repeat(4001) }, context())).toThrow(
      "empty or too long",
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(types(provider)).not.toContain("conversation.item.create");
    provider.send({ type: "response.done", response: { id: "resp-1" } });
    const first = await provider.waitFor("conversation.item.create");
    expect(first.item).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Typed one" }],
    });
    await provider.waitFor("response.create");
    await new Promise((r) => setTimeout(r, 50));
    // Still one in flight: the second waits for the first one's reply.
    expect(
      provider.received.filter((event) => event.type === "conversation.item.create"),
    ).toHaveLength(1);
    provider.send({ type: "response.created", response: { id: "resp-2" } });
    provider.send({ type: "response.done", response: { id: "resp-2" } });
    const second = await provider.waitFor("conversation.item.create", 2);
    expect((second.item as { content: { text: string }[] }).content[0]!.text).toBe("Typed two");
    await provider.waitFor("response.create", 2);
    const events = (await relays.next({ lease, cursor: 0 }, context())).events;
    const shown = events
      .filter((event) => event.type !== "state")
      .map((event) => [event.type, "text" in event ? event.text : ""]);
    // The transcript shows each typed message after the reply it waited for.
    expect(shown).toEqual([
      ["assistant_transcript", "First reply."],
      ["user_transcript", "Typed one"],
      ["user_transcript", "Typed two"],
    ]);
    // With nothing in flight a typed message goes out at once.
    provider.send({ type: "response.created", response: { id: "resp-3" } });
    provider.send({ type: "response.done", response: { id: "resp-3" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(relays.text({ lease, text: "Now" }, context())).toEqual({ queued: false });
    expect(() => relays.text({ lease: "other", text: "Now" }, context())).toThrow(
      "no longer active",
    );
    relays.close();
  });

  it("renews the provider session near its cap with a recap, at a turn boundary, under the same lease", async () => {
    let now = 1_000_000;
    const { provider, relays, dependencies } = await setup({ now: () => now });
    const secret = vi.fn(dependencies.secret);
    dependencies.secret = secret;
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    expect(relays.text({ lease, text: "Remember the blue door." }, context())).toEqual({
      queued: false,
    });
    provider.send({ type: "response.created", response: { id: "resp-1" } });
    provider.send({
      type: "response.output_audio_transcript.delta",
      response_id: "resp-1",
      delta: "Noted, the blue door.",
    });
    provider.send({ type: "response.done", response: { id: "resp-1" } });
    await new Promise((r) => setTimeout(r, 100));
    // A reply is in progress when the session reaches its age limit.
    provider.send({ type: "response.created", response: { id: "resp-2" } });
    await new Promise((r) => setTimeout(r, 50));
    now += RELAY_ROTATE_AFTER_MS - 10 * 60_000;
    expect(relays.text({ lease, text: "Keep going." }, context())).toEqual({ queued: true });
    now += 10 * 60_000 + 1_000;
    const cursor = (await relays.next({ lease, cursor: 0 }, context())).cursor;
    await until(
      () => provider.connections.length === 2 && provider.connections[1]!.received.length > 0,
    );
    const update = provider.connections[1]!.received[0]!;
    expect(update.type).toBe("session.update");
    const instructions = String((update.session as { instructions: string }).instructions);
    expect(instructions).toContain("Owner: Remember the blue door.");
    expect(instructions).toContain("You: Noted, the blue door.");
    expect(secret).toHaveBeenCalledTimes(2);
    // Never mid-reply: the typed turn waits on the old session until its reply is done.
    await new Promise((r) => setTimeout(r, 1_200));
    expect(provider.connections[1]!.received.map((event) => event.type)).toEqual([
      "session.update",
    ]);
    provider.connections[0]!.socket.send(
      JSON.stringify({ type: "response.done", response: { id: "resp-2" } }),
    );
    await until(() =>
      provider.connections[1]!.received.some((event) => event.type === "response.create"),
    );
    const typed = provider.connections[1]!.received.find(
      (event) => event.type === "conversation.item.create",
    );
    expect((typed!.item as { content: { text: string }[] }).content[0]!.text).toBe("Keep going.");
    expect(
      provider.connections[0]!.received.filter(
        (event) => event.type === "conversation.item.create",
      ),
    ).toHaveLength(1);
    // The phone saw no interruption: same lease, no end.
    const after = await relays.next({ lease, cursor }, context());
    expect(after.events.map((event) => event.type)).not.toContain("ended");
    expect(relays.activeCount).toBe(1);
    relays.close();
  });

  it("ends an idle call as expired at the cap instead of renewing it", async () => {
    let now = 1_000_000;
    const { provider, relays } = await setup({ now: () => now });
    const { lease } = await relays.start({ threadId: "room-1", provider: "openai" }, context());
    await provider.waitFor("session.update");
    // Something keeps the conversation going, but the owner has not spoken or typed for long.
    provider.send({ type: "response.created", response: { id: "resp-1" } });
    await new Promise((r) => setTimeout(r, 50));
    now += Math.max(RELAY_ROTATE_AFTER_MS, RELAY_ROTATION_ACTIVITY_MS) + 1_000;
    await relays.next({ lease, cursor: 0 }, context());
    await until(() => provider.closed);
    const next = await relays.next({ lease, cursor: 0 }, context());
    expect(next.events).toContainEqual(
      expect.objectContaining({ type: "ended", reason: "expired" }),
    );
    expect(provider.connections).toHaveLength(1);
  });

  it("bounds the renewal recap by turns and size", () => {
    expect(relayRecap([])).toBe("");
    const turns = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      text: `turn ${i} ${"word ".repeat(200)}`,
    }));
    const recap = relayRecap(turns);
    expect(recap.length).toBeLessThanOrEqual(RELAY_RECAP_MAX_CHARS + 400);
    expect(recap).toContain("turn 39");
    expect(recap).not.toContain("turn 0 ");
    const lines = recap.split("\n").filter((line) => /^(Owner|You): /.test(line));
    expect(lines.length).toBeLessThanOrEqual(RELAY_RECAP_TURNS);
    expect(relayRecap(turns.slice(-3).map((turn) => ({ ...turn, text: "short" })))).toContain(
      "Owner: short",
    );
  });

  it("resamples 16 kHz PCM to 24 kHz with interpolation", () => {
    const input = Int16Array.from([0, 300, 600, 900]);
    const output = resamplePcm16(input, 16000, 24000);
    expect(output.length).toBe(6);
    expect(Array.from(output)).toEqual([0, 200, 400, 600, 800, 900]);
  });
});
