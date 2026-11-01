// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import type { VoiceAssistantInput } from "../model/voiceAssistant";
const mock = vi.hoisted(() => ({
  callbacks: null as any,
  close: vi.fn(),
  speak: vi.fn(() => true),
  converse: vi.fn(async () => ({ action: "submit", reply: "" })),
  connect: vi.fn(async () => {}),
  warm: vi.fn(async () => {}),
  realtime: null as any,
  realtimeArgs: [] as unknown[],
  realtimeConnect: vi.fn(async () => {}),
  realtimeSecret: vi.fn(async () => ({ value: "v", expires_at: 1, model: "m", url: "wss://x" })),
  localConstructed: vi.fn(),
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
    close = mock.close;
    speak = mock.speak;
    addImage = mock.image;
    mute() {}
    silence() {}
  },
}));
vi.mock("../model/voiceAssistant", () => ({ converseWithAssistant: mock.assistant }));
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
    speak = mock.speak;
    mute() {}
    silence() {}
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
beforeEach(() => localStorage.setItem("bycoda.voice.persona", JSON.stringify({ status: "skipped" })));
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.removeItem("bycoda.voice");
  localStorage.removeItem("bycoda.voice.persona");
  localStorage.removeItem("bycoda.voice.memory");
  vi.clearAllMocks();
});
const a = { id: "a", title: "Alpha", cwd: "/a", blocks: [], busy: true } as unknown as Session;
const b = { id: "b", title: "Beta", cwd: "/b", blocks: [] } as unknown as Session;
async function setup() {
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
  await render("a");
  await click("Voice companion");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Start voice"))!
      .click();
  });
  return { render, onSubmit, onStop };
}
async function click(label: string) {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(),
  );
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
    const accepted = mock.callbacks.accept(turn);
    if (accepted) mock.callbacks.transcript({ text, language: "tr", inferenceMs: 150 }, accepted);
  });
  return turn;
}
it("offers persona setup on first launch and not again after skipping", async () => {
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
  expect(document.body.textContent).toContain("Make the voice companion yours");
  await act(async () => skip()!.click());
  expect(skip()).toBeUndefined();
  expect(JSON.parse(localStorage.getItem("bycoda.voice.persona")!).status).toBe("skipped");
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
it("closes with Escape and restores launcher focus without stopping coding", async () => {
  const { onStop } = await setup();
  const panel = container.querySelector('section[aria-label="Voice companion"]')!;
  await act(async () =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector('section[aria-label="Voice companion"]')).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Voice companion"]'),
  );
  expect(mock.close).toHaveBeenCalled();
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
  expect(JSON.parse(localStorage.getItem("bycoda.voice.memory")!).notes).toEqual([
    expect.objectContaining({ text: "Prefers Turkish replies" }),
  ]);
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
      return new Promise((resolve) => { finish = resolve; });
    });
  } else {
    mock.converse.mockImplementationOnce((...args: any[]) => {
      signal = args[3];
      return new Promise((resolve) => { finish = resolve; });
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
  expect(global ? mock.assistant.mock.lastCall![0].history : (mock.converse.mock.lastCall as any)[2])
    .toEqual([{ role: "user", text: first }]);
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
  mock.converse.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await speech("Fix Alpha login and signup");
  await render("b");
  mock.converse.mockResolvedValueOnce({ action: "reply", reply: "Beta status." });
  await speech("What is happening here?");
  expect((mock.converse.mock.lastCall as any)[2]).toEqual([]);
  await act(async () => finish({ action: "submit", text: "Obsolete Alpha work", reply: "" }));
  expect(onSubmit).not.toHaveBeenCalled();
  await render("a");
  mock.converse.mockResolvedValueOnce({ action: "submit", text: "Fix Alpha login and signup; preserve settings.", reply: "" } as any);
  await speech("Keep saved settings too");
  expect((mock.converse.mock.lastCall as any)[2]).toEqual([
    { role: "user", text: "Fix Alpha login and signup" },
  ]);
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("a", "Fix Alpha login and signup; preserve settings.");
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
    expect(overlay.host?.state).toMatchObject({ status: "live", title: "Alpha", muted: false });
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
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Window creation failed");
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

async function setupGlobal(activeId: string | null = "a", mode: "local" | "openai" = "openai") {
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
          assistantSession: { ...a, id: "assistant-config", busy: false },
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
  expect(request.context).toMatchObject({ sessionId: "a", projectPath: "/a" });
  expect(await request.execute("composer_context", {})).toMatchObject({ sessionId: "a" });
  await request.execute("app_tool_call", {
    family: "conversation",
    action: "files.read",
    input: { path: "README.md" },
    requestId: "read-onset-a",
  });
  expect(mock.toolCall).toHaveBeenCalledExactlyOnceWith(
    { cwd: "/a", sessionId: "a" },
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
  expect(request.context).toMatchObject({ sessionId: undefined, projectPath: "/a" });
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
  expect(ensureToolSession).toHaveBeenCalledExactlyOnceWith("/a");
  expect(mock.toolCall).toHaveBeenCalledExactlyOnceWith(
    { cwd: "/a", sessionId: "voice-manager" },
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
