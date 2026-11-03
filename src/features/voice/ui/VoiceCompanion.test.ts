// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import type { VoiceAssistantInput } from "../model/voiceAssistant";
import * as historyTransport from "../model/voiceHistoryTransport";
import * as groupLock from "../../group-lock/model/groupLock";
import { pendingOwnerQuestionPresentations } from "../../assistant/model/assistantOwnerQuestionPresentations";
const assistantHost = vi.hoisted(() => ({
  environmentId: "voice-host-original",
  messages: [] as any[],
  contexts: new Map<string, any>(),
  snapshot: {
    profile: {
      name: "Arif",
      showTitle: true,
      setupComplete: true,
      voiceSetupComplete: true,
      language: "auto",
      addressAs: "",
    },
    memory: [],
    jobs: [],
  } as any,
  request: vi.fn(async (input: any): Promise<any> => {
    if (input.op === "snapshot") return { snapshot: assistantHost.snapshot };
    if (input.op === "projects.list")
      return {
        projects: [
          { id: "pa", path: "/a", name: "Alpha" },
          { id: "pb", path: "/b", name: "Beta" },
        ],
      };
    if (input.op === "threads.open")
      return { thread: { id: input.projectId ?? "global", summary: "" } };
    if (input.op === "threads.messages")
      return {
        messages: assistantHost.messages
          .filter((message) => message.threadId === input.threadId)
          .slice(-(input.limit ?? 6)),
      };
    if (input.op === "threads.append") {
      const existing = assistantHost.messages.find(
        (message) => message.id === input.idempotencyKey,
      );
      if (existing) return { message: existing };
      const context = assistantHost.contexts.get(input.causalContextId),
        projectIds =
          input.role === "user"
            ? input.threadId === "global"
              ? []
              : [input.threadId]
            : context?.status === "known"
              ? context.projectIds
              : undefined;
      const message = {
        ...input,
        id: input.idempotencyKey,
        createdAt: Date.now(),
        ...(projectIds ? { projectIds } : {}),
      };
      assistantHost.messages.push(message);
      return { message };
    }
    if (input.op === "messages.linkJob") {
      const message = assistantHost.messages.find((message) => message.id === input.id);
      if (!message) throw new Error("Missing captured owner message");
      message.jobIds = [...new Set([...message.jobIds, input.jobId])];
      return { message };
    }
    if (input.op === "voice.context.open") {
      const previous = assistantHost.contexts.get(input.previousContextId),
        context = {
          id: `context:${input.requestId}`,
          version: 1,
          environmentId: assistantHost.environmentId,
          threadId: input.threadId,
          generationKey: input.generationKey,
          ownerMessageId: input.ownerMessageId,
          status: previous?.status === "unknown" ? "unknown" : "known",
          projectIds: previous?.status === "unknown" ? undefined : input.contextProjectIds,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      assistantHost.contexts.set(context.id, context);
      return { voiceContext: context };
    }
    if (input.op === "voice.context.invalidate") {
      const context = assistantHost.contexts.get(input.id);
      if (!context) throw new Error("Unknown fixture context");
      for (const value of assistantHost.contexts.values())
        if (value.generationKey === context.generationKey) {
          value.status = "unknown";
          value.projectIds = undefined;
          value.version++;
        }
      return { voiceContext: context };
    }
    if (input.op === "memory.search") return { entries: [] };
    if (input.op === "memory.save") return { memory: { id: "host-note", ...input } };
    if (input.op === "jobs.create")
      return { job: { id: "job-" + input.idempotencyKey, ...input, status: "queued" } };
    return { ok: true };
  }),
}));
vi.mock("../../assistant/model/assistantHostRead", () => ({
  captureAssistantHostRead: async () => ({ environmentId: assistantHost.environmentId }),
}));
vi.mock("../../assistant/model/assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: assistantHost.snapshot,
    error: "",
    loading: false,
    refresh: vi.fn(),
  }),
  assistantRequest: assistantHost.request,
  assistantIdentity: () => ({ title: "Arif" }),
}));
const presence = vi.hoisted(() => ({
  value: "active" as "active" | "idle" | "away" | "unknown",
  native: "unknown" as "active" | "idle" | "away" | "unknown",
}));
vi.mock("../model/voicePresence", async (original) => ({
  ...(await original<typeof import("../model/voicePresence")>()),
  useVoicePresence: () => presence.value,
  readNativeVoicePresence: async () => presence.native,
}));
const mock = vi.hoisted(() => ({
  callbacks: null as any,
  close: vi.fn(),
  speak: vi.fn((_text: string, _append?: boolean) => true),
  delivered: [] as Array<() => void>,
  autoDeliver: true,
  preview: vi.fn(async (..._args: unknown[]) => {}),
  silence: vi.fn(),
  resumeAfterOwnerAnswer: vi.fn(),
  converse: vi.fn(async () => ({ action: "submit", reply: "" })),
  connect: vi.fn(async () => {}),
  warm: vi.fn(async () => {}),
  realtime: null as any,
  realtimeArgs: [] as unknown[],
  realtimeConnect: vi.fn(async () => {}),
  realtimeSecret: vi.fn(async () => ({ value: "v", expires_at: 1, model: "m", url: "wss://x" })),
  localConstructed: vi.fn(),
  finishTurn: vi.fn(),
  configureConversation: vi.fn(),
  mute: vi.fn(),
  assistant: vi.fn(async (_request: VoiceAssistantInput) => ({
    action: "reply",
    reply: "Done reading.",
  })),
  image: vi.fn(() => ({ accepted: true })),
  toolCall: vi.fn(async () => ({ status: "queued" })),
  discover: vi.fn(async () => ({ tools: [], total: 0, nextOffset: null, categories: [] })),
  draft: vi.fn((sessionId: string) => ({
    sessionId,
    unsent: true,
    text: "Unsent idea",
    attachments: [],
  })),
  attachment: vi.fn(),
}));
vi.mock("../model/realtimeVoice", () => ({
  voiceTools: [{ type: "function", name: "app_context", parameters: { type: "object" } }],
  RealtimeVoice: class {
    constructor(...args: unknown[]) {
      mock.realtimeArgs = args;
      mock.realtime = args[1];
    }
    connect = mock.realtimeConnect;
    resumeAfterOwnerAnswer = mock.resumeAfterOwnerAnswer;
    close = mock.close;
    speak = mock.speak;
    addImage = mock.image;
    mute = mock.mute;
    silence = mock.silence;
    pause = mock.silence;
    configureConversation = mock.configureConversation;
    finishTurn = mock.finishTurn;
  },
}));
vi.mock("../model/voiceAssistant", () => ({ converseWithAssistant: mock.assistant }));
vi.mock("../model/voicePreview", () => ({ previewVoice: mock.preview }));
vi.mock("../model/voiceToolClient", () => ({
  callVoiceTool: mock.toolCall,
  discoverVoiceTools: mock.discover,
}));
vi.mock("../model/voiceDraftContext", () => ({
  readVoiceDraftContext: mock.draft,
  readVoiceDraftAttachment: mock.attachment,
}));
vi.mock("../model/realtimeVoiceClient", () => ({ realtimeSecret: mock.realtimeSecret }));
vi.mock("../model/localVoice", () => ({
  LocalVoice: class {
    constructor(callbacks: unknown) {
      mock.callbacks = callbacks;
      mock.localConstructed();
    }
    connect = mock.connect;
    close = mock.close;
    speak(text: string, append?: boolean, delivered?: () => void) {
      const accepted = mock.speak(text, append);
      if (accepted && delivered) {
        mock.delivered.push(delivered);
        if (mock.autoDeliver) delivered();
      }
      return accepted;
    }
    mute = mock.mute;
    silence = mock.silence;
    configureConversation = mock.configureConversation;
    finishTurn = mock.finishTurn;
  },
}));
vi.mock("../model/voiceConversation", () => ({
  converseWithSession: mock.converse,
  warmVoiceReply: mock.warm,
  immediateVoiceDecision: vi.fn(() => undefined),
}));
vi.mock("../../sessions/model/sessionsStore", () => ({
  sessionsRef: { current: [] },
  useSession: () => undefined,
}));
const overlay = vi.hoisted(() => ({
  native: false,
  open: vi.fn(async () => "voice-overlay-main"),
  close: vi.fn(async () => {}),
  host: null as null | {
    detached: boolean;
    state: { status: string; title: string; muted: boolean };
    onCommand: (command: string) => void;
    onClosed: () => void;
  },
}));
vi.mock("../model/voiceOverlay", async (original) => ({
  ...(await original<typeof import("../model/voiceOverlay")>()),
  hasNativeWindows: () => overlay.native,
  openVoiceOverlay: overlay.open,
  closeVoiceOverlay: overlay.close,
}));
vi.mock("./useVoiceOverlayHost", () => ({
  useVoiceOverlayHost: (options: typeof overlay.host) => {
    overlay.host = options;
  },
}));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "tr",
  translateAt: (_locale: string, key: string) => key,
}));
import { VoiceCompanion } from "./VoiceCompanion";
let root: Root, container: HTMLDivElement;
// Existing scenarios start after the owner skipped persona setup; first run is covered below.
beforeEach(() => {
  assistantHost.environmentId = "voice-host-original";
  assistantHost.messages = [];
  assistantHost.contexts.clear();
  presence.value = "active";
  mock.delivered = [];
  mock.autoDeliver = true;
  localStorage.removeItem("bycoda.voice.scope");
  vi.spyOn(historyTransport, "captureLocalVoiceHistory").mockImplementation(() => ({
    key: "fixture-local",
    remote: false,
    environmentId: async () => assistantHost.environmentId,
    request: assistantHost.request,
  }));
});
beforeEach(() =>
  localStorage.setItem("bycoda.voice.persona", JSON.stringify({ status: "skipped" })),
);
beforeEach(() => {
  presence.native = "unknown";
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.removeItem("bycoda.voice");
  localStorage.removeItem("bycoda.voice.persona");
  localStorage.removeItem("bycoda.voice.memory");
  localStorage.removeItem("bycoda.voice.owner-rule-pending.v1");
  localStorage.removeItem("bycoda.voice.last-briefing");
  localStorage.removeItem("bycoda.voice.last-briefing-attempt");
  for (const key of Object.keys(localStorage))
    if (key.startsWith("bycoda.assistant.question-presentation:")) localStorage.removeItem(key);
  vi.clearAllMocks();
  vi.useRealTimers();
});
const a = { id: "a", title: "Alpha", cwd: "/a", blocks: [], busy: true } as unknown as Session;
const b = { id: "b", title: "Beta", cwd: "/b", blocks: [] } as unknown as Session;
async function setup(initial = a, initialSessions = [a, b]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onSubmit = vi.fn(() => true),
    onStop = vi.fn();
  const render = async (activeId: string, sessions = [a, b]) =>
    act(async () =>
      root.render(createElement(VoiceCompanion, { activeId, sessions, onSubmit, onStop })),
    );
  await render(initial.id, initialSessions);
  await click("Voice companion");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Start voice"))!
      .click();
  });
  return { render, onSubmit, onStop };
}
it("keeps remote Project voice available without claiming local persisted history", async () => {
  const remote = { ...a, id: "remote-a", cwd: "remote://paired/repo" };
  await setup(remote, [remote]);
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Conversation was not saved. Retry.");
  await speech("Continue the remote work");
  expect(
    assistantHost.request.mock.calls
      .map(([input]) => input)
      .filter((input) => input.op === "threads.append"),
  ).toEqual([]);
});
it("binds a newly selected local project before saving its accepted voice turn", async () => {
  const { render } = await setup();
  await render("b");
  await speech("Check Beta");
  const writes = assistantHost.request.mock.calls
    .map(([input]) => input)
    .filter((input) => input.op === "threads.append" && input.role === "user");
  expect(writes).toContainEqual(expect.objectContaining({ threadId: "pb", text: "Check Beta" }));
  expect(writes[0]).not.toHaveProperty("sessionId"); // native shell is not Host proof
  expect(writes).not.toContainEqual(expect.objectContaining({ threadId: "pa", sessionId: "b" }));
});
it("saves accepted remote owner and assistant turns through the captured remote request, never the local Room", async () => {
  const remote = { ...a, id: "remote-a", cwd: "remote://paired/repo" };
  const request = vi.fn(async (input: any): Promise<any> =>
    input.op === "projects.list"
      ? { projects: [{ id: "remote-project", path: remote.cwd, name: "Remote" }] }
      : input.op === "threads.open"
        ? { thread: { id: "remote-thread", summary: "Prior remote history" } }
        : input.op === "threads.messages"
          ? { messages: [] }
          : { message: { id: input.idempotencyKey } },
  );
  const factory = vi
    .spyOn(historyTransport, "captureRemoteVoiceHistory")
    .mockImplementation(() => ({ key: "paired:remote-project", remote: true, request }));
  localStorage.setItem(
    "bycoda.remote-tabs.v2",
    JSON.stringify({ "remote-a": "actual-remote-session" }),
  );
  try {
    mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Remote status" });
    await setup(remote, [remote]);
    await speech("Read remote status");
    const writes = request.mock.calls
      .map(([input]) => input)
      .filter((input) => input.op === "threads.append");
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadId: "remote-thread",
          sessionId: "actual-remote-session",
          role: "user",
          text: "Read remote status",
        }),
        expect.objectContaining({
          threadId: "remote-thread",
          role: "assistant",
          text: "Remote status",
        }),
      ]),
    );
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "threads.append")).toBe(
      false,
    );
  } finally {
    factory.mockRestore();
    localStorage.removeItem("bycoda.remote-tabs.v2");
  }
});
async function click(label: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
}
async function chooseManualEnding() {
  await click("Automatic replies");
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (button) => button.textContent === "Wait until I finish",
  )!;
  expect(option).toBeDefined();
  await act(async () => option.click());
}
/** Floating is an item of the voice options menu. */
async function floatOut() {
  await click("Voice options");
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) =>
    element.textContent?.includes("Float outside the app"),
  );
  expect(item).toBeDefined();
  await act(async () => item!.click());
}
async function speech(text: string, binding?: any) {
  let turn = binding;
  if (!turn)
    await act(async () => {
      turn = mock.callbacks.start();
    });
  await act(async () => {
    if (mock.callbacks.interceptTranscript?.({ text, language: "tr", inferenceMs: 150 }, turn))
      return;
    const accepted = mock.callbacks.accept(turn);
    if (accepted) mock.callbacks.transcript({ text, language: "tr", inferenceMs: 150 }, accepted);
  });
  return turn;
}
it("silently accepts a completed answer's acknowledgement but admits a compound request", async () => {
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Ekipler hazır." } as any);
  const { onSubmit } = await setup();
  await speech("Ekipleri göster");
  const calls = mock.converse.mock.calls.length,
    spoken = mock.speak.mock.calls.length;
  await speech("tamam");
  expect(mock.converse).toHaveBeenCalledTimes(calls);
  expect(mock.speak).toHaveBeenCalledTimes(spoken);
  expect(onSubmit).not.toHaveBeenCalled();
  await speech("tamam ekipleri aç");
  expect(mock.converse).toHaveBeenCalledTimes(calls + 1);
});
it("keeps an answer to an outstanding question on the normal path", async () => {
  mock.converse.mockResolvedValueOnce({
    action: "reply",
    reply: "Ayrıntıları göstereyim mi?",
  } as any);
  await setup();
  await speech("Durum nedir?");
  const calls = mock.converse.mock.calls.length;
  await speech("tamam");
  expect(mock.converse).toHaveBeenCalledTimes(calls + 1);
});
it("waits silently and does not cancel work on an explicit thinking pause", async () => {
  const { onSubmit, onStop } = await setup();
  const calls = mock.converse.mock.calls.length;
  await speech("bir saniye, düşünüyorum");
  expect(mock.silence).toHaveBeenCalledOnce();
  expect(mock.converse).toHaveBeenCalledTimes(calls);
  expect(mock.speak).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("keeps capture through mouse idle while conversation is active, then expires it", async () => {
  vi.useFakeTimers();
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Buradayım." } as any);
  const { render } = await setup();
  await speech("Orada mısın?");
  presence.value = "idle";
  await render("a");
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(mock.close).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Asleep");
});
it("clears conversational engagement when the microphone is paused", async () => {
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Buradayım." } as any);
  const { render } = await setup();
  await speech("Orada mısın?");
  presence.value = "idle";
  await render("a");
  await click("Pause mic");
  expect(mock.close).toHaveBeenCalledOnce();
});
it("omits unheard local speech after a newer admitted request", async () => {
  mock.autoDeliver = false;
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Duyulmayan devam." } as any);
  await setup();
  await speech("İlk sorum");
  const delivered = mock.delivered[0];
  expect(assistantHost.messages.some((item) => item.text === "Duyulmayan devam.")).toBe(false);
  await speech("Hayır ikinci sorum");
  await act(async () => delivered());
  expect(assistantHost.messages.some((item) => item.text === "Duyulmayan devam.")).toBe(false);
});
it("persists only completed realtime playback and never a discarded reply", async () => {
  await setupGlobal();
  await act(async () => {
    mock.realtime.captureTurn()();
    mock.realtime.transcript("Bir özet ver");
    mock.realtime.reply("Üretilmiş devam", false, "r-cut");
    mock.realtime.replyDiscarded("r-cut");
    mock.realtime.replyPlayed("r-cut");
  });
  expect(assistantHost.messages.some((item) => item.text === "Üretilmiş devam")).toBe(false);
  await act(async () => {
    mock.realtime.reply("Duyulan yanıt.", false, "r-played");
    mock.realtime.replyPlayed("r-played");
  });
  expect(assistantHost.messages.filter((item) => item.text === "Duyulan yanıt.")).toHaveLength(1);
  await act(async () => {
    expect(mock.realtime.interceptTranscript("tamam")).toBe(true);
    mock.realtime.replyPlayed("r-played");
  });
  expect(assistantHost.messages.filter((item) => item.text === "Duyulan yanıt.")).toHaveLength(1);
});
it("lets the owner select manual ending live without submitting or reconnecting", async () => {
  const { onSubmit } = await setup();
  await chooseManualEnding();
  expect(JSON.parse(localStorage.getItem("bycoda.voice")!)).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 1,
  });
  expect(mock.configureConversation).toHaveBeenLastCalledWith(
    expect.objectContaining({ manualTurnEnd: true }),
  );
  expect(mock.finishTurn).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () => overlay.host!.onCommand("automaticTurnEnd"));
  expect(JSON.parse(localStorage.getItem("bycoda.voice")!)).toMatchObject({
    manualTurnEnd: false,
    manualTurnEndRevision: 2,
  });
  expect(mock.configureConversation).toHaveBeenLastCalledWith(
    expect.objectContaining({ manualTurnEnd: false }),
  );
  await act(async () => overlay.host!.onCommand("manualTurnEnd"));
  expect(JSON.parse(localStorage.getItem("bycoda.voice")!)).toMatchObject({
    manualTurnEnd: true,
    manualTurnEndRevision: 3,
  });
  await act(async () => overlay.host!.onCommand("finishTurn"));
  expect(mock.finishTurn).toHaveBeenCalledOnce();
});
it("keeps the automatic runtime reachable if saving the owner turn choice fails", async () => {
  await setup();
  const configured = mock.configureConversation.mock.calls.length;
  const storage = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    await chooseManualEnding();
    expect(container.textContent).toContain(
      "Turn ending preference could not be saved. Try again.",
    );
    expect(mock.configureConversation).toHaveBeenCalledTimes(configured);
    expect(mock.finishTurn).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
  }
  await chooseManualEnding();
  expect(container.textContent).not.toContain(
    "Turn ending preference could not be saved. Try again.",
  );
  expect(mock.configureConversation).toHaveBeenLastCalledWith(
    expect.objectContaining({ manualTurnEnd: true }),
  );
});
it("persists the exact owner correction as a rule and exposes real Finish turn without submitting work", async () => {
  const { onSubmit } = await setup();
  const quote = "Sözümü kesme.";
  await speech(quote);
  expect(assistantHost.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "memory.save",
      kind: "rule",
      source: "spoken",
      text: quote,
      quote,
    }),
  );
  expect(mock.speak).toHaveBeenCalledWith(
    "Your rule was saved. Choose Finish turn when you are done speaking.",
    false,
  );
  expect(onSubmit).not.toHaveBeenCalled();
  const finish = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Finish turn",
  )!;
  expect(finish).toBeDefined();
  await act(async () => finish.click());
  expect(mock.finishTurn).toHaveBeenCalledOnce();
});
it("routes an explicit emergency stop directly without handing it to a model or stopping a manual session", async () => {
  const { onSubmit, onStop } = await setup();
  await speech("Arif hepsini durdur");
  expect(assistantHost.request).toHaveBeenCalledWith({ op: "pauseAll" }, "voice-host-original");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
  expect(mock.speak).toHaveBeenCalledWith("Stop requested. Assistant work is paused.", false);
});
it("uses the configured Host identity without offering the retired persona setup", async () => {
  localStorage.removeItem("bycoda.voice.persona");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props = { activeId: "a", sessions: [a, b], onSubmit: vi.fn(() => true), onStop: vi.fn() };
  await act(async () => root.render(createElement(VoiceCompanion, props)));
  await click("Voice companion");
  const skip = () =>
    [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Skip customization"),
    );
  expect(document.body.textContent).toContain("Arif");
  expect(document.body.textContent).not.toContain("Make the voice companion yours");
  expect(skip()).toBeUndefined();
});
it("captures the target at local speech onset and follows only the next utterance", async () => {
  const { render, onSubmit } = await setup();
  let binding: any;
  await act(async () => {
    binding = mock.callbacks.start();
  });
  await render("b");
  await speech("Fix login", binding);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix login");
  await speech("Fix login", binding);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await speech("Fix filter");
  expect(onSubmit).toHaveBeenLastCalledWith("b", "Fix filter");
});
it("pins the session and closing voice leaves the coding job running", async () => {
  const { render, onSubmit, onStop } = await setup();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Voice session"]')!.click(),
  );
  const alpha = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) =>
      option.textContent?.startsWith("Alpha") &&
      !option.textContent.includes("Follow active session"),
  )!;
  await act(async () => alpha.click());
  await render("b");
  await speech("Fix login");
  expect(onSubmit).toHaveBeenCalledWith("a", "Fix login");
  await click("Close voice companion");
  expect(mock.close).toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("keeps voice connected when Escape bubbles from the panel", async () => {
  const { onStop } = await setup();
  const panel = container.querySelector('section[aria-label="Voice companion"]')!;
  await act(async () =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('section[aria-label="Voice companion"]')).toBe(panel);
  expect(mock.close).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("answers while the job is busy without submitting the question", async () => {
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Still working." });
  mock.warm.mockClear();
  const { onSubmit } = await setup();
  // Warmed on start; a reply consumes the warm process, so it is warmed again.
  expect(mock.warm).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  const warmed = mock.warm.mock.calls.length;
  await speech("What are you working on?");
  expect(mock.warm.mock.calls.length).toBeGreaterThan(warmed);
  expect(mock.speak).toHaveBeenCalledWith("Still working.", false);
  expect(onSubmit).not.toHaveBeenCalled();
});
it("saves a spoken memory note and confirms only after it is stored", async () => {
  mock.converse.mockResolvedValueOnce({
    action: "remember",
    text: "Prefers Turkish replies",
    reply: "I will remember.",
  });
  const { onSubmit } = await setup();
  await speech("Türkçe cevap vermeyi unutma");
  expect(assistantHost.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "memory.save",
      text: "Prefers Turkish replies",
      source: "spoken",
    }),
  );
  expect(mock.speak).toHaveBeenCalledWith("I will remember.", false);
  expect(onSubmit).not.toHaveBeenCalled();
  localStorage.setItem("bycoda.voice.memory", JSON.stringify({ enabled: false, notes: [] }));
  mock.converse.mockResolvedValueOnce({ action: "remember", text: "x", reply: "Saved." });
  await speech("Bunu hatırla");
  expect(mock.speak).toHaveBeenLastCalledWith("Memory is turned off in Settings.", false);
});
it("speaks a streamed reply from its first sentence and shows it progressively", async () => {
  let finish!: (value: unknown) => void;
  let sentence!: (text: string) => void;
  mock.converse.mockImplementationOnce(
    (_session: unknown, _text: unknown, _history: unknown, _signal: unknown, onSentence: any) =>
      new Promise((done) => {
        sentence = onSentence;
        finish = done;
      }),
  );
  const { onSubmit } = await setup();
  await speech("Unit test nedir?");
  await act(async () => sentence("Kısa cevap şu."));
  expect(mock.speak).toHaveBeenLastCalledWith("Kısa cevap şu.", false);
  expect(container.textContent).toContain("Kısa cevap şu.");
  await act(async () => sentence("İkinci cümle."));
  expect(mock.speak).toHaveBeenLastCalledWith("İkinci cümle.", true);
  expect(container.textContent).toContain("Kısa cevap şu. İkinci cümle.");
  const spoken = mock.speak.mock.calls.length;
  await act(async () => finish({ action: "reply", reply: "Kısa cevap şu. İkinci cümle." }));
  // Already spoken while streaming: the final reply is not repeated.
  expect(mock.speak.mock.calls.length).toBe(spoken);
  expect(onSubmit).not.toHaveBeenCalled();
});
it("does not claim acceptance when submission was rejected", async () => {
  const { onSubmit } = await setup();
  onSubmit.mockReturnValue(false);
  await speech("Fix login");
  expect(mock.speak).toHaveBeenCalledWith(
    "The request was not accepted. Check the session.",
    false,
  );
});

it("delivers the prepared local brief to the onset target while retaining original speech for follow-ups", async () => {
  const brief =
    "Giriş yönlendirmesini düzelt. Kayıtlı ayarları koru ve başarılı/başarısız girişleri doğrula.";
  mock.converse.mockResolvedValueOnce({ action: "submit", text: brief, reply: "" } as any);
  const { render, onSubmit } = await setup();
  const binding = mock.callbacks.start();
  await render("b");
  await speech("Bu sorunu düzelt, ayarları da koru", binding);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", brief);
  expect(container.textContent).toContain("Bu sorunu düzelt, ayarları da koru");
  await render("a");
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Hangi kontrol?" });
  await speech("Bir de onu kontrol et");
  expect(mock.converse.mock.lastCall![2]).toEqual(
    expect.arrayContaining([
      { role: "user", text: "Bu sorunu düzelt, ayarları da koru" },
      { role: "assistant", text: JSON.stringify({ handoff: brief, accepted: true }) },
    ]),
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it("does not deliver malformed local work or an obsolete prepared brief", async () => {
  const { onSubmit } = await setup();
  mock.converse.mockResolvedValueOnce({ action: "submit", text: " ", reply: "" } as any);
  await speech("Fix this");
  expect(onSubmit).not.toHaveBeenCalled();
  let finish!: (value: any) => void;
  mock.converse.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await speech("Fix the first problem");
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Which part?" });
  await speech("Wait, I meant the second one");
  await act(async () =>
    finish({ action: "submit", text: "Fix the first problem and verify it.", reply: "" }),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

it.each([
  ["side reply", "Giriş ve kayıt hatalarını düzelt", "Ayarları da koru"],
  ["side reply", "Fix login and signup", "Keep saved settings too"],
  ["application tools", "Giriş ve kayıt hatalarını düzelt", "Ayarları da koru"],
  ["application tools", "Fix login and signup", "Keep saved settings too"],
])("%s retains pending intent across a correction: %s", async (route, first, correction) => {
  const global = route === "application tools";
  const { onSubmit } = global ? await setupGlobal("a", "local") : await setup();
  let finish!: (value: any) => void;
  let obsolete!: VoiceAssistantInput;
  let signal!: AbortSignal;
  if (global) {
    mock.assistant.mockImplementationOnce((request) => {
      obsolete = request;
      signal = request.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
  } else {
    mock.converse.mockImplementationOnce((...args: any[]) => {
      signal = args[3];
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
  }
  await speech(first);
  const brief = `${first}; ${correction}.`;
  if (global) {
    mock.assistant.mockImplementationOnce(async (request) => {
      expect(request.history).toEqual([{ role: "user", text: first }]);
      expect(request.transcript).toBe(correction);
      await request.execute("submit_work", { text: brief });
      return { action: "reply", reply: "Accepted." };
    });
  } else {
    mock.converse.mockImplementationOnce(async (...args: any[]) => {
      expect(args[2]).toEqual([{ role: "user", text: first }]);
      expect(args[1]).toBe(correction);
      return { action: "submit", text: brief, reply: "" };
    });
  }
  await speech(correction);
  expect(
    global ? mock.assistant.mock.lastCall![0].history : (mock.converse.mock.lastCall as any)[2],
  ).toEqual([{ role: "user", text: first }]);
  expect(signal.aborted).toBe(true);
  if (global)
    await expect(obsolete.execute("submit_work", { text: first })).rejects.toThrow(
      "The spoken request is no longer active.",
    );
  await act(async () => finish({ action: "submit", text: first, reply: "Obsolete reply" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", brief);
  expect(mock.speak).not.toHaveBeenCalledWith("Obsolete reply", expect.anything());
  // The current utterance belongs in history exactly once, never in its own prompt.
  if (global) mock.assistant.mockResolvedValueOnce({ action: "reply", reply: "Status." });
  else mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Status." });
  await speech("Durum ne?");
  const history = global
    ? mock.assistant.mock.lastCall![0].history!
    : (mock.converse.mock.lastCall as any)[2];
  expect(history.filter((entry: any) => entry.role === "user")).toEqual([
    { role: "user", text: first },
    { role: "user", text: correction },
  ]);
});

it("keeps superseded pending side-reply context in its original session", async () => {
  const { render, onSubmit } = await setup();
  let finish!: (value: any) => void;
  mock.converse.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await speech("Fix Alpha login and signup");
  await render("b");
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Beta status." });
  await speech("What is happening here?");
  expect((mock.converse.mock.lastCall as any)[2]).toEqual([]);
  await act(async () => finish({ action: "submit", text: "Obsolete Alpha work", reply: "" }));
  expect(onSubmit).not.toHaveBeenCalled();
  await render("a");
  mock.converse.mockResolvedValueOnce({
    action: "submit",
    text: "Fix Alpha login and signup; preserve settings.",
    reply: "",
  } as any);
  await speech("Keep saved settings too");
  expect((mock.converse.mock.lastCall as any)[2]).toEqual([
    { role: "user", text: "Fix Alpha login and signup" },
  ]);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
    "a",
    "Fix Alpha login and signup; preserve settings.",
  );
});

it("retains a newer correction when an earlier local submission resolves late", async () => {
  const { onSubmit } = await setup();
  let delivered!: (accepted: boolean) => void;
  onSubmit.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        delivered = resolve;
      }) as any,
  );
  mock.converse.mockResolvedValueOnce({ action: "submit", text: "Fix login.", reply: "" } as any);
  await speech("Fix that");
  mock.converse.mockResolvedValueOnce({
    action: "reply",
    reply: "I will keep that correction in context.",
  });
  await speech("Keep saved settings too");
  await act(async () => delivered(true));
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Which test?" });
  await speech("And check that");
  expect(mock.converse.mock.lastCall![2]).toEqual(
    expect.arrayContaining([
      { role: "user", text: "Keep saved settings too" },
      { role: "assistant", text: "I will keep that correction in context." },
      { role: "assistant", text: JSON.stringify({ handoff: "Fix login.", accepted: true }) },
    ]),
  );
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it.each(["local", "openai"] as const)(
  "%s blocks rephrased duplicate handoffs and validates text without truncation",
  async (mode) => {
    const { onSubmit } = await setupGlobal("a", mode);
    let execute: (name: string, args: Record<string, unknown>) => Promise<any>;
    if (mode === "local") {
      await speech("Fix that and keep the settings");
      execute = mock.assistant.mock.lastCall![0].execute;
    } else {
      mock.realtime.captureTurn()();
      execute = mock.realtime.tool;
    }
    expect(await execute("submit_work", { text: "x".repeat(16001) })).toMatchObject({
      accepted: false,
    });
    expect(await execute("submit_work", { text: "Fix login", sessionId: "b" })).toMatchObject({
      accepted: false,
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await execute("submit_work", { text: "Fix login and verify saved settings." })).toEqual({
      accepted: true,
    });
    expect(await execute("submit_work", { text: "Fix login and verify saved settings." })).toEqual({
      accepted: true,
    });
    expect(
      await execute("submit_work", { text: "Rephrased: repair login and preserve settings." }),
    ).toMatchObject({ accepted: false });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix login and verify saved settings.");
  },
);

it("cancels deferred cloud handoff when a newer accepted turn replaces its target", async () => {
  const { render, onSubmit } = await setupGlobal();
  mock.realtime.captureTurn()();
  await render("b", [a, b], "/b");
  let obsolete!: Promise<any>;
  await act(async () => {
    obsolete = mock.realtime.tool("submit_work", { text: "Fix Alpha" });
    mock.realtime.captureTurn()();
  });
  expect(await obsolete).toEqual({ accepted: false });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(await mock.realtime.tool("submit_work", { text: "Fix Beta" })).toEqual({ accepted: true });
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("b", "Fix Beta");
});

it("keeps the true cloud receipt when a newer turn arrives after dispatch began", async () => {
  const { onSubmit } = await setupGlobal();
  let delivered!: (accepted: boolean) => void;
  onSubmit.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        delivered = resolve;
      }) as any,
  );
  mock.realtime.captureTurn()();
  const pending = mock.realtime.tool("submit_work", { text: "Fix Alpha" });
  await act(async () => {
    await Promise.resolve();
  });
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix Alpha");
  mock.realtime.captureTurn()();
  delivered(true);
  expect(await pending).toEqual({ accepted: true });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
it("discards a pending side reply only when newer speech is accepted", async () => {
  let resolve!: (value: any) => void;
  mock.converse.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { onSubmit } = await setup();
  await speech("old request");
  await act(async () => {
    mock.callbacks.accept(mock.callbacks.start());
  });
  await act(async () => resolve({ action: "submit", reply: "" }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it("does not cancel a pending reply for an unconfirmed sound onset", async () => {
  let sentence!: (text: string) => void;
  let finish!: (value: unknown) => void;
  mock.converse.mockImplementationOnce(
    (_session: unknown, _text: unknown, _history: unknown, _signal: unknown, onSentence: any) =>
      new Promise((done) => {
        sentence = onSentence;
        finish = done;
      }),
  );
  const { onSubmit, onStop } = await setup();
  await speech("What is happening?");
  await act(async () => {
    mock.callbacks.start();
  });
  await act(async () => sentence("Still working."));
  expect(mock.speak).toHaveBeenLastCalledWith("Still working.", false);
  await act(async () => finish({ action: "reply", reply: "Still working." }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("announces the end of tracked work without invoking another agent", async () => {
  const { render } = await setup();
  await speech("Fix login");
  mock.speak.mockClear();
  await render("b", [
    {
      ...a,
      busy: false,
      blocks: [{ id: "done", role: "assistant", text: "Changes ready for review." }],
    },
    b,
  ]);
  expect(mock.speak).toHaveBeenCalledWith(
    expect.stringContaining("Changes ready for review."),
    false,
  );
  expect(mock.converse).toHaveBeenCalledTimes(1);
});

it("keeps voice running through compact mode, live appearance updates and expansion", async () => {
  const { saveVoiceSettings, loadVoiceSettings } = await import("../model/voiceSettings");
  const { onStop } = await setup();
  await click("Compact voice companion");
  expect(loadVoiceSettings().compact).toBe(true);
  expect(container.querySelector("section")?.getAttribute("data-compact")).toBe("true");
  expect(mock.close).not.toHaveBeenCalled();
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), visual: "dots" }));
  expect(container.querySelector('[data-visual="dots"]')).not.toBeNull();
  await click("Expand voice companion");
  expect(loadVoiceSettings().compact).toBe(false);
  expect(mock.close).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});
it("retires the expanded turn menu on collapse and keeps the real mode selected after expansion", async () => {
  await setup();
  await click("Automatic replies");
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await click("Compact voice companion");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(container.querySelectorAll('[data-split-part="menu"]')).toHaveLength(1);
  await click("Automatic replies");
  let options = [...document.querySelectorAll('[role="menuitemradio"]')];
  expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  await click("Expand voice companion");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await click("Automatic replies");
  options = [...document.querySelectorAll('[role="menuitemradio"]')];
  expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  expect(mock.finishTurn).not.toHaveBeenCalled();
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(mock.close).not.toHaveBeenCalled();
});
it("compact mode shows the latest spoken line beside a borderless orb", async () => {
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Tests are passing." });
  await setup();
  await click("Compact voice companion");
  const handle = container.querySelector<HTMLElement>('button[aria-label^="Move voice window"]')!;
  expect(handle.dataset.buttonVariant).toBe("ghost");
  await speech("How are the tests?");
  expect(container.querySelector("h2")?.nextElementSibling?.textContent).toBe("Tests are passing.");
});
it("floats outside the app while the session and microphone stay in this window", async () => {
  overlay.native = true;
  try {
    const { onStop } = await setup();
    await floatOut();
    expect(overlay.open).toHaveBeenCalledWith(expect.objectContaining({ fromCursor: false }));
    expect(container.querySelector("section")).toBeNull();
    expect(overlay.host?.detached).toBe(true);
    expect(overlay.host?.state).toMatchObject({
      status: "live",
      title: "Arif · Alpha",
      muted: false,
    });
    // Commands from the floating window act on the live session here.
    await act(async () => overlay.host!.onCommand("toggleMute"));
    expect(overlay.host?.state.muted).toBe(true);
    expect(mock.close).not.toHaveBeenCalled();
    // A native close of the floating window returns the controls, still connected.
    await act(async () => overlay.host!.onClosed());
    expect(container.querySelector("section")).not.toBeNull();
    expect(mock.close).not.toHaveBeenCalled();
    await floatOut();
    await act(async () => overlay.host!.onCommand("close"));
    expect(container.querySelector("section")).toBeNull();
    expect(mock.close).toHaveBeenCalled();
    expect(overlay.close).toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  } finally {
    overlay.native = false;
  }
});
it("keeps the panel in the app when the floating window cannot open", async () => {
  overlay.native = true;
  overlay.open.mockRejectedValueOnce("Window creation failed");
  try {
    await setup();
    await floatOut();
    expect(container.querySelector("section")).not.toBeNull();
    const feedback = container.querySelector<HTMLDetailsElement>("details")!;
    expect(feedback.open).toBe(false);
    expect(feedback.hasAttribute("role")).toBe(false);
    expect(feedback.querySelector("summary")?.textContent).toBe("Error details");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Voice needs attention");
    await act(() => {
      feedback.querySelector("summary")!.click();
    });
    expect(feedback.open).toBe(true);
    expect(feedback.querySelector("p")?.textContent).toBe("Window creation failed");
    expect(mock.close).not.toHaveBeenCalled();
  } finally {
    overlay.native = false;
  }
});
it("uses playback events rather than reply text to announce assistant speech", async () => {
  await setup();
  await act(async () => mock.callbacks.playback(true));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("assistant");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Assistant speaking");
  await act(async () => mock.callbacks.playback(false));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("listening");
  await act(async () => mock.callbacks.error("Playback failed"));
  expect(container.querySelector("section")?.getAttribute("data-voice-state")).toBe("error");
});

it("shows the Host's reason when local voice start is rejected with a string", async () => {
  mock.connect.mockRejectedValueOnce("Voice setup is still running.");
  await setup();
  expect(container.textContent).toContain("Voice setup is still running.");
  expect(container.textContent).not.toContain("Local voice could not start.");
});

it("uses the cloud companion for Grok Voice and routes its tools through the same session checks", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true, mode: "grok" }));
  const { onSubmit, onStop } = await setup();
  expect(mock.localConstructed).not.toHaveBeenCalled();
  expect(mock.realtimeSecret).toHaveBeenCalledExactlyOnceWith("xai");
  expect(mock.realtimeArgs[0]).toBe("xai");
  expect(mock.realtimeConnect).toHaveBeenCalledWith(
    expect.objectContaining({ url: "wss://x", value: "v" }),
    [],
    expect.objectContaining({ summary: "", disclosureCurrent: expect.any(Function) }),
  );
  expect(await mock.realtime.tool("session_context", {})).toMatchObject({ title: "Alpha" });
  expect(await mock.realtime.tool("submit_work", { text: " Fix login " })).toEqual({
    accepted: true,
  });
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix login");
  expect(await mock.realtime.tool("submit_work", { text: "" })).toMatchObject({ accepted: false });
  expect(await mock.realtime.tool("stop_work", {})).toEqual({
    accepted: true,
    status: "stop_requested",
  });
  expect(onStop).toHaveBeenCalledWith("a");
  await act(async () => {
    mock.realtime.reply("Merhaba", false);
    mock.realtime.reply(" dünya", true);
  });
  expect(container.textContent).toContain("Merhaba dünya");
});

it("shows the Host's reason when the cloud companion cannot get a credential", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true, mode: "openai" }));
  mock.realtimeSecret.mockRejectedValueOnce("OpenAI Realtime is not signed in. Sign in to Codex.");
  await setup();
  expect(mock.realtimeArgs[0]).toBe("openai");
  expect(container.textContent).toContain("OpenAI Realtime is not signed in. Sign in to Codex.");
  expect(container.textContent).toContain("Start voice");
});

it("picks the voice session from the panel and keeps it while the active session changes", async () => {
  const { render, onSubmit } = await setup();
  // The session picker lists sessions with their project; choosing one pins it.
  const picker = container.querySelector<HTMLButtonElement>('button[aria-label^="Voice session"]');
  expect(picker?.textContent).toBe("Alpha");
  await act(async () => picker!.click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes("Beta"),
  );
  expect(option?.textContent).toContain("b");
  await act(async () => option!.click());
  await render("a");
  await speech("Fix the filter");
  expect(onSubmit).toHaveBeenLastCalledWith("b", "Fix the filter");
});

it("ends a live connection when the conversation changes and keeps the panel open", async () => {
  await setup();
  expect(mock.connect).toHaveBeenCalledOnce();
  await act(async () =>
    localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true, mode: "grok" })),
  );
  await act(async () => window.dispatchEvent(new Event("bycoda:voice-settings")));
  expect(mock.close).toHaveBeenCalled();
  expect(container.querySelector('section[aria-label="Voice companion"]')).not.toBeNull();
  const start = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Start voice"),
  );
  expect(start).toBeDefined();
});

async function setupGlobal(
  activeId: string | null = "a",
  mode: "local" | "openai" | "grok" = "openai",
  savedScope: "global" | "project" | null = "global",
) {
  if (savedScope) localStorage.setItem("bycoda.voice.scope", savedScope);
  else localStorage.removeItem("bycoda.voice.scope");
  localStorage.setItem("bycoda.voice", JSON.stringify({ enabled: true, mode }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onSubmit = vi.fn(() => true),
    onStop = vi.fn();
  const workspace = {
    tools: [
      {
        name: "workspace.sessions.create",
        description: "Create session",
        parameters: { type: "object" },
      },
    ],
    execute: vi.fn(async () => ({ status: "accepted" })),
  };
  const ensureToolSession = vi.fn(async () => "voice-manager");
  const sessions = activeId ? [a, b] : [];
  const render = async (
    selected: string | undefined,
    nextSessions = sessions,
    projectPath = "/a",
    assistantId = "assistant-config",
  ) =>
    act(async () =>
      root.render(
        createElement(VoiceCompanion, {
          activeId: selected,
          sessions: nextSessions,
          onSubmit,
          onStop,
          workspace,
          projects: [{ path: "/a" }, { path: "/b" }],
          projectPath,
          ensureToolSession,
          assistantSession: { ...a, id: assistantId, busy: false },
        }),
      ),
    );
  await render(activeId ?? undefined);
  await click("Voice companion");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Start voice"))!
      .click();
  });
  return { render, workspace, onSubmit, onStop, ensureToolSession };
}
it("offers Global for a fresh workspace and keeps both scope choices discoverable", async () => {
  await setupGlobal("a", "openai", null);
  const choices = [...container.querySelectorAll('[role="radio"]')];
  expect(
    choices.find((choice) => choice.textContent?.includes("Global"))?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(choices.find((choice) => choice.textContent?.includes("Project"))).toBeDefined();
  expect(localStorage.getItem("bycoda.voice.scope")).toBe("global");
  expect(mock.realtimeConnect).toHaveBeenCalledOnce();
  expect(mock.close).not.toHaveBeenCalled();
});
it("keeps saved Project local audio through project/config navigation and binds each utterance at onset", async () => {
  const { render, onSubmit } = await setupGlobal("a", "local", "project");
  expect(localStorage.getItem("bycoda.voice.scope")).toBe("project");
  const onset = { ...mock.callbacks.start() };
  await render("b", [a, b], "/b", "new-project-assistant-config");
  expect(mock.close).not.toHaveBeenCalled();
  expect(mock.connect).toHaveBeenCalledOnce();
  await speech("Finish my Alpha request", onset);
  const original = mock.assistant.mock.lastCall![0];
  await original.execute("submit_work", { text: "Alpha work" });
  expect(onSubmit).toHaveBeenLastCalledWith("a", "Alpha work");
  await speech("Now read Beta");
  await mock.assistant.mock.lastCall![0].execute("submit_work", { text: "Beta work" });
  expect(onSubmit).toHaveBeenLastCalledWith("b", "Beta work");
  const writes = assistantHost.request.mock.calls
    .map(([input]) => input)
    .filter((input) => input.op === "threads.append" && input.role === "user");
  expect(writes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ threadId: "pa", text: "Finish my Alpha request" }),
      expect.objectContaining({ threadId: "pb", text: "Now read Beta" }),
    ]),
  );
  expect(mock.close).not.toHaveBeenCalled();
});
it("keeps an explicitly pinned Project target while navigating without reconnecting", async () => {
  const { render, onSubmit } = await setupGlobal("a", "local", "project");
  await act(() =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Voice session"]')!.click(),
  );
  const alpha = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) =>
      option.textContent?.startsWith("Alpha") &&
      !option.textContent.includes("Follow active session"),
  )!;
  await act(() => alpha.click());
  await render("b", [a, b], "/b", "new-project-assistant-config");
  await speech("Keep working on pinned Alpha");
  await mock.assistant.mock.lastCall![0].execute("submit_work", { text: "Pinned Alpha work" });
  expect(onSubmit).toHaveBeenLastCalledWith("a", "Pinned Alpha work");
  expect(mock.connect).toHaveBeenCalledOnce();
  expect(mock.close).not.toHaveBeenCalled();
});
it("keeps cloud audio/transcript through project and scope changes without widening its captured turn", async () => {
  const { render } = await setupGlobal("a", "openai", "project");
  const accept = mock.realtime.captureTurn();
  await render("b", [a, b], "/b", "new-project-assistant-config");
  await act(() => accept());
  await act(() => mock.realtime.transcript("Original Alpha speech"));
  const global = [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((choice) =>
    choice.textContent?.includes("Global"),
  )!;
  await act(() => global.click());
  expect(mock.close).not.toHaveBeenCalled();
  expect(mock.realtimeConnect).toHaveBeenCalledOnce();
  expect(mock.realtimeSecret).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Original Alpha speech");
  expect(await mock.realtime.tool("app_context", {})).toMatchObject({
    scope: "project",
    projectPath: "/a",
    sessionId: "a",
  });
  await act(() => {
    mock.realtime.captureTurn()();
    mock.realtime.transcript("New Beta speech");
  });
  expect(await mock.realtime.tool("app_context", {})).toMatchObject({
    scope: "global",
    projectPath: "/b",
    sessionId: "b",
  });
  await mock.realtime.tool("app_tool_call", {
    family: "conversation",
    action: "files.read",
    input: { path: "README.md" },
    requestId: "new-beta-request",
  });
  expect(mock.toolCall).toHaveBeenLastCalledWith(
    expect.objectContaining({
      cwd: "/b",
      sessionId: "b",
      threadId: "global",
      causalContext: expect.objectContaining({ id: expect.any(String) }),
    }),
    expect.objectContaining({ requestId: "new-beta-request" }),
  );
});

it("starts global cloud voice without an active coding session and exposes workspace discovery", async () => {
  const { workspace, onSubmit } = await setupGlobal(null);
  expect(mock.realtimeConnect).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Global");
  expect(await mock.realtime.tool("app_context", {})).toMatchObject({
    scope: "global",
    projects: [{ path: "/a" }, { path: "/b" }],
  });
  expect(await mock.realtime.tool("app_tools_list", { family: "workspace" })).toMatchObject({
    tools: [{ action: "workspace.sessions.create" }],
  });
  await mock.realtime.tool("app_tool_call", {
    family: "workspace",
    action: "workspace.sessions.create",
    input: { projectPath: "/b" },
    requestId: "create-one",
  });
  expect(workspace.execute).toHaveBeenCalledExactlyOnceWith("workspace.sessions.create", {
    projectPath: "/b",
    requestId: "create-one",
  });
  expect(onSubmit).not.toHaveBeenCalled();
});

it("uses the global local assistant without creating or submitting a coding turn", async () => {
  const { onSubmit, ensureToolSession } = await setupGlobal(null, "local");
  expect(mock.connect).toHaveBeenCalledOnce();
  await speech("Take a note");
  expect(mock.assistant).toHaveBeenCalledWith(
    expect.objectContaining({
      session: expect.objectContaining({ id: "assistant-config" }),
      transcript: "Take a note",
      context: expect.objectContaining({ scope: "global" }),
    }),
  );
  expect(mock.speak).toHaveBeenCalledWith("Done reading.", false);
  expect(ensureToolSession).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("keeps the local onset session and project for application tools while ASR awaits acceptance", async () => {
  const { render, onSubmit } = await setupGlobal("a", "local");
  // Match LocalVoice's copy of the onset binding; symbols must survive it too.
  const binding = { ...mock.callbacks.start() };
  await render("b", [a, b], "/b");
  await speech("Read my draft", binding);
  const request = mock.assistant.mock.lastCall![0];
  expect(request.session.id).toBe("a");
  expect(request.context).toMatchObject({ threadId: "global", projectIds: ["pa", "pb"] });
  expect(request.context).not.toHaveProperty("composer");
  expect(await request.execute("composer_context", {})).toMatchObject({ sessionId: "a" });
  await request.execute("app_tool_call", {
    family: "conversation",
    action: "files.read",
    input: { path: "README.md" },
    requestId: "read-onset-a",
  });
  expect(mock.toolCall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      cwd: "/a",
      sessionId: "a",
      threadId: "global",
      causalContext: expect.objectContaining({ id: expect.any(String) }),
    }),
    expect.objectContaining({ action: "files.read", requestId: "read-onset-a" }),
  );
  await request.execute("submit_work", { text: "Fix Alpha" });
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix Alpha");
});

it("keeps a local onset's absent session and original project when a tab appears during ASR", async () => {
  const { render, onSubmit, ensureToolSession } = await setupGlobal(null, "local");
  const binding = { ...mock.callbacks.start() };
  await render("b", [a, b], "/b");
  await speech("Take a note", binding);
  const request = mock.assistant.mock.lastCall![0];
  expect(request.context).toMatchObject({ threadId: "global", projectIds: ["pa", "pb"] });
  expect(request.context).not.toHaveProperty("sessionId");
  await expect(request.execute("composer_context", {})).rejects.toThrow("Choose a session");
  expect(await request.execute("submit_work", { text: "Fix this" })).toMatchObject({
    error: "No session is selected.",
  });
  await request.execute("app_tool_call", {
    family: "conversation",
    action: "notes.list",
    input: {},
    requestId: "notes-onset-a",
  });
  expect(ensureToolSession).not.toHaveBeenCalled();
  expect(mock.toolCall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      cwd: "/a",
      threadId: "global",
      causalContext: expect.objectContaining({ id: expect.any(String) }),
    }),
    expect.objectContaining({ action: "notes.list" }),
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

it("binds cloud compatibility and application tools to onset across pending ASR and a tab change", async () => {
  const { render, onSubmit } = await setupGlobal();
  const accept = mock.realtime.captureTurn();
  await render("b", [a, b], "/b");
  accept();
  expect(await mock.realtime.tool("app_context", {})).toMatchObject({
    sessionId: "a",
    projectPath: "/a",
  });
  expect(await mock.realtime.tool("composer_context", {})).toMatchObject({
    sessionId: "a",
    text: "Unsent idea",
    unsent: true,
  });
  expect(await mock.realtime.tool("session_context", {})).toMatchObject({ title: "Alpha" });
  await mock.realtime.tool("submit_work", { text: "Fix Alpha" });
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix Alpha");
});

it("does not retarget a no-session cloud turn when a coding tab appears later", async () => {
  const { render, onSubmit } = await setupGlobal(null);
  const accept = mock.realtime.captureTurn();
  await render("b", [a, b], "/b");
  accept();
  expect(await mock.realtime.tool("app_context", {})).toMatchObject({
    sessionId: undefined,
    projectPath: "/a",
  });
  expect(await mock.realtime.tool("submit_work", { text: "Do this work" })).toMatchObject({
    error: "No session is selected.",
  });
  expect(onSubmit).not.toHaveBeenCalled();
});

it("delivers unsent image content to realtime without sending the draft", async () => {
  const { onSubmit, workspace } = await setupGlobal();
  mock.realtime.captureTurn()();
  mock.attachment.mockResolvedValueOnce({
    sessionId: "a",
    attachmentId: "picture",
    name: "p.png",
    kind: "image",
    dataUrl: "data:image/png;base64,AA==",
  });
  expect(
    await mock.realtime.tool("composer_attachment", { attachmentId: "picture" }),
  ).toMatchObject({ imageProvided: true });
  expect(mock.image).toHaveBeenCalledExactlyOnceWith("data:image/png;base64,AA==");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(workspace.execute).not.toHaveBeenCalled();
});

it("refuses tool callbacks retained after voice disconnect", async () => {
  const { workspace } = await setupGlobal();
  mock.realtime.captureTurn()();
  const retained = mock.realtime;
  await click("Disconnect voice");
  expect(
    await retained.tool("app_tool_call", {
      family: "workspace",
      action: "workspace.sessions.create",
      input: { projectPath: "/a" },
      requestId: "late",
    }),
  ).toMatchObject({ error: expect.stringContaining("no longer active") });
  expect(workspace.execute).not.toHaveBeenCalled();
});

it("sleeps when idle and returns ready without opening the microphone", async () => {
  const { render } = await setup();
  const connects = mock.connect.mock.calls.length;
  presence.value = "idle";
  await render("a");
  expect(container.textContent).toContain("Asleep");
  expect(mock.close).toHaveBeenCalledOnce();
  presence.value = "active";
  await render("a");
  expect(container.textContent).toContain("Ready. Microphone is off.");
  expect(mock.connect).toHaveBeenCalledTimes(connects);
});

for (const kind of ["daily", "routine", "stale"] as const)
  it(`does not read a ${kind} briefing just because the owner returns`, async () => {
    const profile = assistantHost.snapshot.profile;
    try {
      assistantHost.snapshot.profile = {
        ...profile,
        proactiveSpeech: "return",
        quietStart: 0,
        quietEnd: 0,
        language: "tr",
      };
      const time = Date.now() - (kind === "stale" ? 360_000 : 0);
      assistantHost.snapshot.briefing = {
        id: kind,
        text: "Rutin özet",
        createdAt: time,
        ...(kind === "daily"
          ? {}
          : {
              voiceReceipt: {
                reason: "return",
                returnAt: time,
                meaningful: kind !== "routine",
                important: false,
              },
            }),
      };
      const { render } = await setup();
      presence.value = "idle";
      await render("a");
      presence.value = "active";
      await render("a");
      expect(mock.preview).not.toHaveBeenCalled();
    } finally {
      assistantHost.snapshot.profile = profile;
      delete assistantHost.snapshot.briefing;
    }
  });
it("lets a confirmed return briefing finish and never automatically retries an interrupted delivery", async () => {
  vi.useFakeTimers();
  const profile = assistantHost.snapshot.profile;
  mock.preview.mockImplementationOnce(() => new Promise<void>(() => {}));
  try {
    assistantHost.snapshot.profile = {
      ...profile,
      proactiveSpeech: "return",
      quietStart: 0,
      quietEnd: 0,
      language: "tr",
    };
    const now = Date.now();
    assistantHost.snapshot.briefing = {
      id: "meaningful-return",
      text: "İncelemeni bekleyen bir iş var.",
      createdAt: now,
      voiceReceipt: { reason: "return", returnAt: now, meaningful: true, important: true },
    };
    const { render } = await setup();
    presence.value = "idle";
    await render("a");
    presence.value = "active";
    await render("a");
    expect(mock.preview).toHaveBeenCalledOnce();
    expect(mock.preview.mock.calls[0][7]).toMatchObject({ complete: true });
    const signal = mock.preview.mock.calls[0][3] as AbortSignal;
    await act(async () => vi.advanceTimersByTimeAsync(61_000));
    expect(signal.aborted).toBe(false);
    expect(mock.connect).toHaveBeenCalledOnce();
    presence.value = "away";
    await render("a");
    expect(signal.aborted).toBe(true);
    presence.value = "active";
    await render("a");
    expect(mock.preview).toHaveBeenCalledOnce();
  } finally {
    assistantHost.snapshot.profile = profile;
    delete assistantHost.snapshot.briefing;
  }
});

it("does not wake voice after an explicit disconnect", async () => {
  const { render } = await setup();
  await click("Disconnect voice");
  presence.value = "idle";
  await render("a");
  presence.value = "active";
  await render("a");
  expect(container.textContent).toContain("Ready to connect");
  expect(container.textContent).not.toContain("Ready. Microphone is off.");
});

it("reconnects a recoverable cloud drop with fresh credentials and text context only", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  const previous = mock.realtime;
  await act(async () => previous.transcript("Continue my work"));
  vi.useFakeTimers();
  await act(async () => previous.error("Connection closed", true, { recoverable: true }));
  expect(container.textContent).toContain("Reconnecting...");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mock.realtimeSecret).toHaveBeenCalledTimes(2);
  expect(mock.realtimeConnect).toHaveBeenLastCalledWith(
    expect.anything(),
    [{ role: "user", text: "Continue my work" }],
    expect.objectContaining({ summary: "", disclosureCurrent: expect.any(Function) }),
  );
  expect(container.textContent).toContain("Listening");
});
it("seeds a verified global summary once and captures its immutable Host proof for subsequent speech", async () => {
  const original = assistantHost.request.getMockImplementation()!;
  const thread = {
    id: "global",
    summary: "Retained owner goals and unresolved choices",
    summaryProof: {
      id: "saved-summary-proof",
      version: 1,
      projectIds: ["pa"],
      throughMessageId: "retained-source",
      messageCount: 20,
      createdAt: 1,
      inputTruncated: false,
      omittedMessages: 0,
    },
  };
  assistantHost.request.mockImplementation(async (input) =>
    input.op === "threads.open"
      ? { thread }
      : input.op === "threads.messages"
        ? {
            thread,
            messages: [
              { id: "recent-owner", role: "user", text: "Recent accepted detail", projectIds: [] },
            ],
          }
        : original(input),
  );
  try {
    await setupGlobal();
    expect(mock.realtimeConnect).toHaveBeenCalledWith(
      expect.anything(),
      [{ role: "user", text: "Recent accepted detail" }],
      expect.objectContaining({ summary: thread.summary, disclosureCurrent: expect.any(Function) }),
    );
    await act(async () => mock.realtime.transcript("Continue from that summary"));
    await vi.waitFor(() =>
      expect(assistantHost.request).toHaveBeenCalledWith(
        expect.objectContaining({
          op: "voice.context.open",
          summaryUsed: true,
          summaryProofId: "saved-summary-proof",
        }),
      ),
    );
  } finally {
    assistantHost.request.mockImplementation(original);
  }
});
it("seeds GLOBAL voice only with proven captured contributors and no unscoped summary", async () => {
  const original = assistantHost.request.getMockImplementation()!,
    locked = vi.spyOn(groupLock, "isProjectLocked").mockImplementation((path) => path === "/b");
  assistantHost.request.mockImplementation(async (input) =>
    input.op === "threads.open"
      ? { thread: { id: "global", summary: "PRIVATE GLOBAL SUMMARY" } }
      : input.op === "threads.messages"
        ? {
            messages: [
              { role: "user", text: "Verified personal", projectIds: [] },
              { role: "assistant", text: "Safe Alpha", projectIds: ["pa"] },
              { role: "assistant", text: "Private Beta", projectIds: ["pb"] },
              { role: "assistant", text: "Mixed secret", projectIds: ["pa", "pb"] },
              { role: "assistant", text: "Legacy unknown" },
            ],
          }
        : original(input),
  );
  try {
    await setupGlobal();
    expect(mock.realtimeConnect).toHaveBeenCalledWith(
      expect.anything(),
      [
        { role: "user", text: "Verified personal" },
        { role: "assistant", text: "Safe Alpha" },
      ],
      expect.objectContaining({ summary: "", disclosureCurrent: expect.any(Function) }),
    );
  } finally {
    assistantHost.request.mockImplementation(original);
    locked.mockRestore();
  }
});
it("keeps GLOBAL voice listening with an incomplete Host project directory without disclosing unverified history", async () => {
  const original = assistantHost.request.getMockImplementation()!;
  assistantHost.request.mockImplementation(async (input) =>
    input.op === "projects.list"
      ? { projects: [{ id: "pa", path: "/a", name: "Alpha" }] }
      : input.op === "threads.messages"
        ? {
            messages: [
              { role: "user", text: "Verified personal", projectIds: [] },
              { role: "assistant", text: "Unknown Beta", projectIds: ["pb"] },
            ],
          }
        : original(input),
  );
  try {
    const { render } = await setupGlobal();
    expect(container.textContent).toContain("Listening");
    expect(mock.realtimeConnect).toHaveBeenCalledWith(
      expect.anything(),
      [{ role: "user", text: "Verified personal" }],
      expect.objectContaining({ summary: "", disclosureCurrent: expect.any(Function) }),
    );
    const options = mock.realtimeConnect.mock.calls[0][2] as { disclosureCurrent: () => boolean };
    expect(options.disclosureCurrent()).toBe(true);
    const locked = vi
      .spyOn(groupLock, "isProjectLocked")
      .mockImplementation((path) => path === "/b");
    try {
      expect(options.disclosureCurrent()).toBe(false);
      await render("a");
      expect(container.textContent).toContain("Ready. Microphone is off.");
      expect(mock.close).toHaveBeenCalled();
    } finally {
      locked.mockRestore();
    }
  } finally {
    assistantHost.request.mockImplementation(original);
  }
});
it("discards read history and closes capture when privacy changes before credential-delayed seed disclosure", async () => {
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done));
  mock.realtimeSecret.mockImplementationOnce(async () => {
    await held;
    return { value: "v", expires_at: 1, model: "m", url: "wss://x" };
  });
  const { render, onStop } = await setupGlobal();
  expect(mock.realtimeConnect).not.toHaveBeenCalled();
  const locked = vi.spyOn(groupLock, "isProjectLocked").mockImplementation((path) => path === "/b");
  try {
    await render("a");
    await act(async () => release());
    expect(mock.realtimeConnect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Ready. Microphone is off.");
    expect(onStop).not.toHaveBeenCalled();
  } finally {
    locked.mockRestore();
  }
  await render("a");
  expect(mock.realtimeSecret).toHaveBeenCalledOnce();
  expect(mock.realtimeConnect).not.toHaveBeenCalled();
});
it("withholds GLOBAL history when a lock arrives while its messages are loading", async () => {
  const original = assistantHost.request.getMockImplementation()!;
  let release!: () => void;
  const held = new Promise<void>((done) => (release = done));
  assistantHost.request.mockImplementation(async (input) => {
    if (input.op === "threads.messages") {
      await held;
      return {
        messages: [{ role: "assistant", text: "Private delayed read", projectIds: ["pb"] }],
      };
    }
    return original(input);
  });
  let locked: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const { render } = await setupGlobal();
    locked = vi.spyOn(groupLock, "isProjectLocked").mockImplementation((path) => path === "/b");
    await render("a");
    await act(async () => release());
    expect(mock.realtimeConnect).not.toHaveBeenCalled();
    expect(mock.realtimeSecret).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Private delayed read");
    expect(container.textContent).toContain("Ready. Microphone is off.");
  } finally {
    assistantHost.request.mockImplementation(original);
    locked?.mockRestore();
  }
});

it("cancels a pending reconnect when the owner disconnects", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  vi.useFakeTimers();
  await act(async () => mock.realtime.error("Connection closed", true, { recoverable: true }));
  await click("Cancel");
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(mock.realtimeSecret).toHaveBeenCalledOnce();
});
it("recovers unconfirmed provider cleanup with fresh credentials while retaining mute/history and no tool replay", async () => {
  const { onSubmit } = await setupGlobal("a", "openai", "project");
  const retired = mock.realtime;
  await act(() => mock.realtime.transcript("Keep my accepted request"));
  await click("Pause mic");
  vi.useFakeTimers();
  await act(() =>
    mock.realtime.error("Voice input cleanup was not confirmed. Start voice again.", true, {
      recoverable: true,
      code: "input_cleanup_unconfirmed",
    }),
  );
  expect(container.textContent).toContain("Reconnecting...");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mock.realtimeSecret).toHaveBeenCalledTimes(2);
  expect(mock.realtimeConnect).toHaveBeenCalledTimes(2);
  expect(mock.realtimeConnect.mock.lastCall?.[1]).toContainEqual({
    role: "user",
    text: "Keep my accepted request",
  });
  expect(mock.mute).toHaveBeenLastCalledWith(true);
  expect(container.querySelector('[aria-label="Resume"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(mock.toolCall).not.toHaveBeenCalled();
  await act(() => retired.reply("Retired provider reply"));
  expect(container.textContent).not.toContain("Retired provider reply");
  await expect(
    retired.tool("submit_work", { text: "Retired provider work" }),
  ).resolves.toMatchObject({ error: "The voice connection is no longer active." });
  expect(onSubmit).not.toHaveBeenCalled();
});
it.each(["cancel", "sleep", "privacy", "unmount"])(
  "cancels cleanup recovery after %s without reopening capture",
  async (reason) => {
    const { render } = await setupGlobal("a", "openai", "project");
    vi.useFakeTimers();
    await act(() =>
      mock.realtime.error("Voice input cleanup was not confirmed. Start voice again.", true, {
        recoverable: true,
        code: "input_cleanup_unconfirmed",
      }),
    );
    let locked: ReturnType<typeof vi.spyOn> | undefined;
    try {
      if (reason === "cancel") await click("Cancel");
      if (reason === "sleep") {
        presence.value = "away";
        await render("a");
        presence.value = "active";
        await render("a");
        expect(container.textContent).toContain("Ready. Microphone is off.");
      }
      if (reason === "privacy") {
        locked = vi.spyOn(groupLock, "isProjectLocked").mockImplementation((path) => path === "/a");
        await render("b", [a, b], "/b");
      }
      if (reason === "unmount") {
        await act(() => root.unmount());
        root = null as unknown as Root;
      }
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(mock.realtimeSecret).toHaveBeenCalledOnce();
      expect(mock.realtimeConnect).toHaveBeenCalledOnce();
      expect(mock.toolCall).not.toHaveBeenCalled();
    } finally {
      locked?.mockRestore();
    }
  },
);
it("keeps an exact pending job review on cleanup recovery but explicit Disconnect cancels it without creating work", async () => {
  await setupGlobal();
  await act(() => {
    mock.realtime.captureTurn()();
    mock.realtime.transcript("Please review an Alpha job");
  });
  await act(async () => {
    void mock.realtime.tool("give_jobs", {
      jobs: [
        { title: "Keep original review", request: "Original owner request", projectPath: "/a" },
      ],
    });
  });
  expect(container.textContent).toContain("Review jobs before starting");
  const originalCreateCount = assistantHost.request.mock.calls.filter(
    ([input]) => input.op === "jobs.create",
  ).length;
  vi.useFakeTimers();
  await act(() =>
    mock.realtime.error("Voice input cleanup was not confirmed. Start voice again.", true, {
      recoverable: true,
      code: "input_cleanup_unconfirmed",
    }),
  );
  expect(
    [...container.querySelectorAll("input")].some(
      (input) => input.value === "Keep original review",
    ),
  ).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(container.textContent).toContain("Review jobs before starting");
  expect(
    assistantHost.request.mock.calls.filter(([input]) => input.op === "jobs.create"),
  ).toHaveLength(originalCreateCount);
  await click("Disconnect voice");
  expect(container.textContent).not.toContain("Review jobs before starting");
  expect(
    assistantHost.request.mock.calls.filter(([input]) => input.op === "jobs.create"),
  ).toHaveLength(originalCreateCount);
});

it("keeps cloud voice connected when local setup paths are saved", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  const { saveVoiceSettings, loadVoiceSettings } = await import("../model/voiceSettings");
  await act(async () =>
    saveVoiceSettings({ ...loadVoiceSettings(), python: "other", whisperPath: "changed" }),
  );
  expect(mock.close).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Listening");
});

it("does not reconnect while away and does not open the mic on return", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  const { render } = await setup();
  presence.value = "away";
  await render("a");
  expect(container.textContent).toContain("Asleep");
  presence.value = "active";
  await render("a");
  expect(container.textContent).toContain("Ready. Microphone is off.");
  expect(mock.realtimeSecret).toHaveBeenCalledOnce();
  await click("Disconnect voice");
  presence.value = "idle";
  await render("a");
  presence.value = "active";
  await render("a");
  expect(container.textContent).toContain("Ready to connect");
});

it("exhausts five consecutive retry attempts and replenishes only after a stable minute", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  vi.useFakeTimers();
  for (const delay of [1000, 2000]) {
    await act(async () => mock.realtime.error("Closed", true, { recoverable: true }));
    await act(async () => vi.advanceTimersByTimeAsync(delay));
  }
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  // Stable minute restores the first 1s delay; no lifetime-wide cap.
  await act(async () => mock.realtime.error("Closed", true, { recoverable: true }));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(mock.realtimeSecret).toHaveBeenCalledTimes(4);
  for (const delay of [2000, 5000, 10000, 30000]) {
    await act(async () => mock.realtime.error("Closed", true, { recoverable: true }));
    await act(async () => vi.advanceTimersByTimeAsync(delay));
  }
  await act(async () => mock.realtime.error("Closed", true, { recoverable: true }));
  expect(container.textContent).toContain("Couldn't connect voice. Try again.");
  const attempts = mock.realtimeSecret.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mock.realtimeSecret).toHaveBeenCalledTimes(attempts);
});

it("does not retry credential failures", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  vi.useFakeTimers();
  await act(async () => mock.realtime.error("Sign in required", true, { recoverable: false }));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mock.realtimeSecret).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Sign in required");
});

it("shows a clickable voice choice and consumes its spoken answer without starting work", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  const { onSubmit } = await setup();
  let answer: Promise<unknown>;
  await act(async () => {
    answer = mock.realtime.tool("present_choices", {
      question: "Which project?",
      options: [
        { id: "one", label: "monocode" },
        { id: "two", label: "clinic" },
      ],
    });
  });
  expect(container.textContent).toContain("Which project?");
  await act(async () => {
    expect(mock.realtime.interceptTranscript("the second one")).toBe(true);
  });
  await expect(answer!).resolves.toEqual({ kind: "answered", answers: { choice: ["two"] } });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("Which project?");
});
it("keeps a realtime choice pending through an explicit wait and accepts the later answer", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  const { onSubmit } = await setup();
  let answer!: Promise<unknown>;
  const settled = vi.fn();
  await act(async () => {
    answer = mock.realtime.tool("present_choices", {
      question: "Which project?",
      options: [
        { id: "one", label: "monocode" },
        { id: "two", label: "clinic" },
      ],
    });
    void answer.then(settled);
  });
  await act(async () => {
    expect(mock.realtime.interceptTranscript("bir saniye düşünüyorum")).toBe(true);
  });
  expect(settled).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Which project?");
  expect(mock.silence).toHaveBeenCalledOnce();
  await act(async () => {
    expect(mock.realtime.interceptTranscript("the second one")).toBe(true);
  });
  await expect(answer).resolves.toEqual({ kind: "answered", answers: { choice: ["two"] } });
  expect(mock.resumeAfterOwnerAnswer).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
});

it("temporarily expands a compact companion for a pending choice without changing the preference", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai", compact: true }));
  await setup();
  expect(container.querySelector("section")?.getAttribute("data-compact")).toBe("true");
  await act(async () => {
    void mock.realtime.tool("present_choices", {
      question: "Pick",
      options: [{ id: "one", label: "One" }],
    });
  });
  expect(container.querySelector("section")?.hasAttribute("data-compact")).toBe(false);
  expect(JSON.parse(localStorage.getItem("bycoda.voice")!).compact).toBe(true);
  await act(async () => mock.realtime.interceptTranscript("one"));
  expect(container.querySelector("section")?.getAttribute("data-compact")).toBe("true");
});

it("dismisses an outstanding voice choice on disconnect without authorizing an action", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  const { onSubmit } = await setup();
  let answer: Promise<unknown>;
  await act(async () => {
    answer = mock.realtime.tool("present_choices", {
      question: "Delete?",
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
      kind: "confirm",
    });
  });
  await click("Disconnect voice");
  await expect(answer!).resolves.toEqual({ kind: "skipped" });
  expect(onSubmit).not.toHaveBeenCalled();
});
it("reviews and edits a job before an explicit Start creates it", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  await act(async () => mock.realtime.captureTurn()());
  let receipt: Promise<unknown>;
  await act(async () => {
    receipt = mock.realtime.tool("give_jobs", {
      jobs: [{ title: "Initial title", request: "Owner request", projectPath: "/a" }],
    });
  });
  expect(assistantHost.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(
    false,
  );
  expect(container.textContent).toContain("Review jobs before starting");
  const field = container.querySelector<HTMLInputElement>('input[value="Initial title"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, "Edited owner title");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Start jobs")!
      .click();
  });
  await expect(receipt!).resolves.toMatchObject({
    status: "accepted",
    jobs: [{ title: "Edited owner title", status: "queued" }],
  });
  expect(assistantHost.request).toHaveBeenCalledWith(
    expect.objectContaining({ op: "jobs.create", title: "Edited owner title", projectId: "pa" }),
    "voice-host-original",
  );
});
it("does not retarget a retained owner job review when the selected local Host changes before Start", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  await act(async () => mock.realtime.captureTurn()());
  await act(async () => {
    void mock.realtime.tool("give_jobs", {
      jobs: [{ title: "Exact original request", request: "Owner request", projectPath: "/a" }],
    });
  });
  const base = assistantHost.request.getMockImplementation()!;
  assistantHost.environmentId = "replacement";
  assistantHost.request.mockImplementation(async (input: any, environment?: string) => {
    if (environment && environment !== assistantHost.environmentId)
      throw new Error("The captured Host is no longer available. Retry its original connection.");
    return base(input);
  });
  try {
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Start jobs")!
        .click();
    });
    expect(container.textContent).toContain("original connection");
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(
      false,
    );
    const bound = assistantHost.request.mock.calls.filter(
      ([input, environment]) => environment && input.op === "projects.list",
    );
    expect(bound.every(([, environment]) => environment === "voice-host-original")).toBe(true);
  } finally {
    assistantHost.request.mockImplementation(base);
  }
});
it("treats a quoted stop as note data and creates a canonical quick note only after explicit owner Save", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  const previousCapabilities = assistantHost.snapshot.capabilities,
    base = assistantHost.request.getMockImplementation()!;
  try {
    assistantHost.snapshot.capabilities = { quickNotes: true };
    const request = 'Save a note saying "stop everything"';
    await act(async () => {
      mock.realtime.captureTurn()();
      expect(mock.realtime.interceptTranscript(request)).toBe(false);
      mock.realtime.transcript(request);
    });
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "pauseAll")).toBe(false);
    assistantHost.request.mockImplementation(async (input) =>
      input.op === "jobs.create"
        ? {
            job: {
              ...input,
              id: "quick-job",
              projectId: null,
              projectIds: [],
              status: "done",
              quickResult: { noteId: "actual-note" },
            },
          }
        : base(input),
    );
    let receipt!: Promise<unknown>;
    await act(async () => {
      receipt = mock.realtime.tool("give_jobs", {
        jobs: [
          {
            kind: "quick",
            title: "Owner note",
            request,
            quickAction: {
              kind: "note",
              title: " Exact note ",
              body: "stop everything\r\nThis is quoted note content.",
            },
          },
        ],
      });
    });
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(
      false,
    );
    expect(container.textContent).toContain("Note content");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Save notes")!
        .click();
    });
    await expect(receipt).resolves.toMatchObject({
      status: "accepted",
      jobs: [{ id: "quick-job", status: "done" }],
    });
    const create = assistantHost.request.mock.calls.find(
      ([input]) => input.op === "jobs.create",
    )![0];
    expect(create).toMatchObject({
      kind: "quick",
      request,
      quickAction: {
        kind: "note",
        title: "Exact note",
        body: "stop everything\nThis is quoted note content.",
      },
    });
    expect(create).not.toHaveProperty("projectId");
    expect(create).not.toHaveProperty("projectIds");
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "pauseAll")).toBe(false);
  } finally {
    assistantHost.request.mockImplementation(base);
    assistantHost.snapshot.capabilities = previousCapabilities;
  }
});
it("masks retained proposal speech and mirrored drafts while a participant becomes private", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  const { render } = await setup();
  await act(async () => {
    mock.realtime.captureTurn()();
    mock.realtime.transcript("Secret project proposal");
  });
  let receipt!: Promise<unknown>;
  await act(async () => {
    receipt = mock.realtime.tool("give_jobs", {
      jobs: [{ title: "Private proposal", request: "Private request", projectPath: "/a" }],
    });
  });
  expect(
    container.querySelector<HTMLInputElement>('input[value="Private proposal"]'),
  ).not.toBeNull();
  const locked = vi.spyOn(groupLock, "isProjectLocked").mockImplementation((path) => path === "/a");
  try {
    await render("a");
    expect(container.querySelector<HTMLInputElement>('input[value="Private proposal"]')).toBeNull();
    expect(container.textContent).not.toContain("Private proposal");
    expect(container.textContent).not.toContain("Secret project proposal");
    expect((overlay.host as any)?.state.jobReview).toBeNull();
    expect((overlay.host as any)?.state.transcript).toBe("");
  } finally {
    locked.mockRestore();
  }
  await render("a");
  expect(
    container.querySelector<HTMLInputElement>('input[value="Private proposal"]'),
  ).not.toBeNull();
  await click("Disconnect voice");
  await expect(receipt).resolves.toMatchObject({ status: "cancelled" });
});
it("reviews every captured global project and sends the explicit lead and saved project array", async () => {
  await setupGlobal();
  await act(async () => mock.realtime.captureTurn()());
  let receipt!: Promise<unknown>;
  await act(async () => {
    receipt = mock.realtime.tool("give_jobs", {
      jobs: [
        {
          title: "Cross-project work",
          request: "Review both",
          projectPath: "/b",
          projectPaths: ["/a", "/b"],
        },
      ],
    });
  });
  expect(assistantHost.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(
    false,
  );
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Start jobs")!
      .click();
  });
  await expect(receipt).resolves.toMatchObject({ status: "accepted" });
  expect(assistantHost.request).toHaveBeenCalledWith(
    expect.objectContaining({ op: "jobs.create", projectId: "pb", projectIds: ["pb", "pa"] }),
    "voice-host-original",
  );
});
it("rejects multi-project proposals outside the accepted project-only directory", async () => {
  localStorage.setItem("bycoda.voice", JSON.stringify({ mode: "openai" }));
  await setup();
  await act(async () => mock.realtime.captureTurn()());
  await expect(
    mock.realtime.tool("give_jobs", {
      jobs: [{ title: "Too broad", request: "Both", projectPaths: ["/a", "/b"] }],
    }),
  ).rejects.toThrow("could not be verified");
  expect(assistantHost.request.mock.calls.some(([input]) => input.op === "jobs.create")).toBe(
    false,
  );
});
it("holds a presentation lost ACK without an alternate answer path and retries only its original captured intent", async () => {
  await setupGlobal();
  const base = assistantHost.request.getMockImplementation()!,
    presentations: any[] = [];
  let lost = true;
  assistantHost.request.mockImplementation(async (input: any, environment?: string) => {
    if (input.op !== "questions.present") return base(input, environment);
    presentations.push(structuredClone(input));
    if (lost) {
      lost = false;
      throw new Error("lost presentation acknowledgement");
    }
    return {
      ownerQuestion: {
        id: "canonical-recovered",
        version: 1,
        jobId: null,
        threadId: input.threadId,
        ownerMessageId: input.ownerMessageId,
        projectIds: input.contextProjectIds,
        origin: "voice-proposal",
        sourceToken: "d".repeat(64),
        sourceCurrent: true,
        status: "open",
        createdAt: 1,
        updatedAt: 1,
        prompt: {
          requestId: 4,
          occurrenceId: "recovered-occurrence",
          behavior: "nonBlocking",
          questions: input.questions.map((question: any) => ({
            ...question,
            id: "host-question",
            options: question.options.map((option: any, index: number) => ({
              ...option,
              id: `host-option-${index}`,
            })),
          })),
        },
      },
    };
  });
  try {
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("Show a planning card");
    });
    let result: unknown;
    void mock.realtime
      .tool("present_choices", {
        question: "Which plan?",
        options: [
          { id: "first", label: "Small plan" },
          { id: "second", label: "Full plan" },
        ],
      })
      .then((value: unknown) => {
        result = value;
      });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Saving this question is unconfirmed"),
    );
    expect(result).toBeUndefined();
    expect(
      pendingOwnerQuestionPresentations(localStorage, assistantHost.environmentId),
    ).toHaveLength(1);
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(
        (input) => input.disabled,
      ),
    ).toBe(true);
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry")!
        .click();
    });
    expect(presentations).toHaveLength(2);
    expect(presentations[1]).toEqual(presentations[0]);
    expect(pendingOwnerQuestionPresentations(localStorage, assistantHost.environmentId)).toEqual(
      [],
    );
    expect(result).toBeUndefined();
    await click("Disconnect voice");
    expect(result).toMatchObject({
      status: "awaiting_owner",
      ownerQuestionId: "canonical-recovered",
    });
  } finally {
    assistantHost.request.mockImplementation(base);
  }
});
it.each(["openai", "grok"] as const)(
  "keeps the first ordinary %s planning choice canonical without an automatic renderer disclosure",
  async (mode) => {
    const { workspace } = await setupGlobal(null, mode),
      base = assistantHost.request.getMockImplementation()!;
    assistantHost.request.mockImplementation(async (input: any) => {
      if (input.op !== "questions.present") return base(input);
      return {
        ownerQuestion: {
          id: "canonical-first-planning-card",
          version: 1,
          jobId: null,
          threadId: input.threadId,
          ownerMessageId: input.ownerMessageId,
          projectIds: input.contextProjectIds,
          origin: "voice-proposal",
          sourceToken: "e".repeat(64),
          sourceCurrent: true,
          status: "open",
          createdAt: 1,
          updatedAt: 1,
          prompt: {
            requestId: 5,
            occurrenceId: "first-planning-occurrence",
            behavior: "nonBlocking",
            questions: input.questions.map((question: any) => ({
              ...question,
              id: "host-planning-question",
              options: question.options.map((option: any, index: number) => ({
                ...option,
                id: `host-planning-option-${index}`,
              })),
            })),
          },
        },
      };
    });
    try {
      expect(mock.draft).not.toHaveBeenCalled();
      expect(mock.toolCall).not.toHaveBeenCalled();
      expect(workspace.execute).not.toHaveBeenCalled();
      await act(async () => {
        mock.realtime.captureTurn()();
        mock.realtime.transcript("Ask me which plan to use");
      });
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = mock.realtime.tool("present_choices", {
          question: "Which plan?",
          options: [
            { id: "small", label: "Small plan" },
            { id: "full", label: "Full plan" },
          ],
        });
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
      await vi.waitFor(() => expect(container.textContent).toContain("Which plan?"));
      const call = assistantHost.request.mock.calls.find(
        ([input]) => input.op === "questions.present",
      )![0];
      expect(call).toMatchObject({
        threadId: "global",
        ownerMessageId: expect.any(String),
        causalContextId: expect.any(String),
        contextProjectIds: ["pa", "pb"],
      });
      expect(assistantHost.contexts.get(call.causalContextId).status).toBe("known");
      expect(
        assistantHost.request.mock.calls.some(([input]) => input.op === "voice.context.invalidate"),
      ).toBe(false);
      expect(mock.draft).not.toHaveBeenCalled();
      expect(mock.toolCall).not.toHaveBeenCalled();
      await click("Disconnect voice");
      await expect(pending).resolves.toMatchObject({
        status: "awaiting_owner",
        ownerQuestionId: "canonical-first-planning-card",
      });
    } finally {
      assistantHost.request.mockImplementation(base);
    }
  },
);
it("applies only accepted owner availability and requires a fresh explicit native-present Talk to return from Away", async () => {
  const priorPresence = assistantHost.snapshot.presence,
    base = assistantHost.request.getMockImplementation()!;
  assistantHost.snapshot.presence = { state: "present", since: 1, updatedAt: 1 };
  assistantHost.request.mockImplementation(async (input: any) => {
    if (input.op === "presence.set") {
      assistantHost.snapshot.presence = { state: input.state, since: 1, updatedAt: 2 };
      return { ok: true };
    }
    return base(input);
  });
  try {
    const { render } = await setupGlobal();
    await expect(mock.realtime.tool("assistant_presence", {})).rejects.toThrow("Say explicitly");
    expect(assistantHost.request.mock.calls.some(([input]) => input.op === "presence.set")).toBe(
      false,
    );
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("Arif, ben gidiyorum");
      expect(mock.realtime.consumeOwnerTranscript("Arif, ben gidiyorum")).toBe(true);
    });
    expect(assistantHost.snapshot.presence.state).toBe("away");
    expect(container.textContent).toContain("Asleep");
    const before = mock.realtimeConnect.mock.calls.length;
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Talk")!
        .click();
    });
    expect(mock.realtimeConnect).toHaveBeenCalledTimes(before);
    expect(container.textContent).toContain("Current computer presence could not be verified");
    const presenceHint = container.querySelector('[role="alert"]')!;
    expect(presenceHint.closest("details")).toBeNull();
    expect(presenceHint.textContent).toContain("Mark yourself here before talking.");
    presence.native = "active";
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Talk")!
        .click();
    });
    expect(mock.realtimeConnect).toHaveBeenCalledTimes(before + 1);
    expect(assistantHost.snapshot.presence.state).toBe("away");
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("Arif geri döndüm");
      expect(mock.realtime.consumeOwnerTranscript("Arif geri döndüm")).toBe(true);
    });
    expect(assistantHost.snapshot.presence.state).toBe("present");
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("Do not disturb me");
      mock.realtime.consumeOwnerTranscript("Do not disturb me");
    });
    expect(assistantHost.snapshot.presence.state).toBe("dnd");
    expect(container.textContent).toContain("Asleep");
    presence.native = "active";
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Talk")!
        .click();
    });
    presence.value = "unknown";
    await render(undefined);
    expect(container.textContent).toContain("Asleep");
    expect(
      assistantHost.request.mock.calls.some(
        ([input]) => input.op === "pauseAll" || input.op === "jobs.control",
      ),
    ).toBe(false);
  } finally {
    assistantHost.snapshot.presence = priorPresence;
    assistantHost.request.mockImplementation(base);
  }
});
it("links accepted jobs to the original owner turn and retries only metadata after a lost link ACK", async () => {
  const { render } = await setupGlobal();
  const base = assistantHost.request.getMockImplementation()!;
  let lose = true;
  assistantHost.request.mockImplementation(async (input: any) => {
    const result = await base(input);
    if (input.op === "messages.linkJob" && lose) {
      lose = false;
      throw new Error("link acknowledgement lost");
    }
    return result;
  });
  try {
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("Create a recovery job");
    });
    const original = assistantHost.messages.find(
      (message) => message.text === "Create a recovery job",
    )!;
    await act(async () => {
      void mock.realtime.tool("give_jobs", {
        jobs: [{ title: "Recovery", request: "Original recovery request", projectPath: "/a" }],
      });
    });
    await render("b");
    await act(async () => {
      mock.realtime.captureTurn()();
      mock.realtime.transcript("A different discussion");
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Start jobs")!
        .click();
    });
    expect(container.textContent).toContain("link acknowledgement lost");
    const first = assistantHost.request.mock.calls.find(
      ([input]) => input.op === "messages.linkJob",
    )![0];
    expect(first).toMatchObject({
      id: original.id,
      jobId: expect.any(String),
      jobKey: expect.any(String),
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Check and retry")!
        .click();
    });
    const links = assistantHost.request.mock.calls
      .filter(([input]) => input.op === "messages.linkJob")
      .map(([input]) => input);
    expect(links).toHaveLength(2);
    expect(links[1]).toEqual(links[0]);
    expect(
      assistantHost.request.mock.calls.filter(([input]) => input.op === "jobs.create"),
    ).toHaveLength(1);
    expect(original.jobIds).toContain(first.jobId);
  } finally {
    assistantHost.request.mockImplementation(base);
  }
});
it("does not disclose a verified local summary or seed when its project locks during the causal receipt await", async () => {
  const base = assistantHost.request.getMockImplementation()!;
  let locked = false,
    release!: () => void;
  const deferred = new Promise<void>((done) => (release = done)),
    lock = vi
      .spyOn(groupLock, "isProjectLocked")
      .mockImplementation((path) => locked && path === "/b");
  assistantHost.request.mockImplementation(async (input: any) => {
    if (input.op === "threads.messages") {
      const page = await base(input);
      return {
        ...page,
        thread: {
          id: "global",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          summary: "PRIVATE VERIFIED SUMMARY",
          summaryProof: {
            id: "private-summary-proof",
            version: 1,
            projectIds: ["pb"],
            throughMessageId: "private-prior",
            messageCount: 20,
            createdAt: 1,
            inputTruncated: false,
            omittedMessages: 0,
          },
        },
        messages: [
          {
            id: "private-prior",
            threadId: "global",
            role: "assistant",
            via: "voice",
            text: "PRIVATE STORED SEED",
            jobIds: [],
            projectIds: ["pb"],
            createdAt: 1,
          },
          ...(page.messages ?? []),
        ],
      };
    }
    if (input.op === "voice.context.open") await deferred;
    return base(input);
  });
  try {
    await setupGlobal(null, "local");
    await speech("Discuss the next step");
    await vi.waitFor(() =>
      expect(
        assistantHost.request.mock.calls.some(([input]) => input.op === "voice.context.open"),
      ).toBe(true),
    );
    await act(async () => {
      locked = true;
      release();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Ready. Microphone is off."));
    expect(mock.assistant).not.toHaveBeenCalled();
    expect(mock.converse).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("PRIVATE VERIFIED SUMMARY");
    expect(container.textContent).not.toContain("PRIVATE STORED SEED");
  } finally {
    assistantHost.request.mockImplementation(base);
    lock.mockRestore();
  }
});

it.each(["resolve", "reject"] as const)(
  "keeps cloud capture closed after scope loss during a deferred provider ACK (%s)",
  async (outcome) => {
    let release!: () => void,
      locked = false;
    const deferred = new Promise<void>((done) => (release = done));
    mock.realtimeConnect.mockImplementationOnce(async () => {
      await deferred;
      if (outcome === "reject") throw new Error("Voice connection closed.");
    });
    const lock = vi
      .spyOn(groupLock, "isProjectLocked")
      .mockImplementation((path) => locked && path === "/b");
    try {
      const { onStop } = await setupGlobal();
      const options = mock.realtimeConnect.mock.calls[0][2] as { disclosureCurrent: () => boolean };
      expect(options.disclosureCurrent).toBeTypeOf("function");
      expect(options.disclosureCurrent()).toBe(true);
      locked = true;
      expect(options.disclosureCurrent()).toBe(false);
      await act(async () => release());
      expect(container.textContent).toContain("Ready. Microphone is off.");
      expect(mock.close).toHaveBeenCalled();
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(mock.realtimeSecret).toHaveBeenCalledOnce();
      expect(mock.realtimeConnect).toHaveBeenCalledOnce();
      expect(onStop).not.toHaveBeenCalled();
      expect(options.disclosureCurrent()).toBe(false);
    } finally {
      lock.mockRestore();
    }
  },
);
