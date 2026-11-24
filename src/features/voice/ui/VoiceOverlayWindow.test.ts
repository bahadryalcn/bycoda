// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
let room = { left: 0, right: 900 };
let pushState: ((state: unknown) => void) | undefined;

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return cmd === "voice_overlay_room" ? room : undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ startDragging: async () => {} }),
}));
vi.mock("../../../platform/tauri/listenWindow", () => ({
  listenWindowAsync: vi.fn(async (event: string, handler: (event: unknown) => void) => {
    if (event === "voice_overlay_state") pushState = (payload) => handler({ payload });
    return () => {};
  }),
}));

const { VoiceOverlayWindow } = await import("./VoiceOverlayWindow");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const choice = {
  id: "choice-1",
  kind: "single",
  prompt: {
    requestId: 1,
    occurrenceId: "o",
    behavior: "nonBlocking",
    questions: [
      {
        id: "q",
        prompt: "Which folder?",
        multiSelect: false,
        allowCustom: false,
        options: [
          { id: "a", label: "workspace" },
          { id: "b", label: "mobile" },
        ],
      },
    ],
  },
};

async function show(state: Record<string, unknown>) {
  await act(async () => {
    pushState?.({ status: "live", statusText: "Listening", ...state });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const fits = () => calls.filter((call) => call.cmd === "voice_overlay_fit").map((c) => c.args!);

it("shares the expanded voice core and conversation while preserving header keyboard movement", async () => {
  const { saveVoiceSettings, loadVoiceSettings } = await import("../model/voiceSettings");
  saveVoiceSettings({ ...loadVoiceSettings(), compact: false });
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({
    visualState: "listening",
    name: "Arif",
    chatTurns: [
      { id: 1, role: "owner", text: "Earlier question" },
      { id: 2, role: "assistant", text: "Earlier answer" },
      { id: 3, role: "owner", text: "Latest question" },
    ],
    transcript: "Do not duplicate this snapshot",
  });
  expect(host.querySelectorAll("[data-spoke]")).toHaveLength(40);
  // The native window is transparent, so the panel must paint an opaque floating fill:
  // the card fill is transparent on most canvases and let the desktop show through.
  expect(host.querySelector("main")?.getAttribute("data-surface-variant")).toBe("floating");
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(3);
  expect(host.textContent).not.toContain("Do not duplicate this snapshot");
  expect(host.querySelector("header button[aria-label^='Move voice']")).toBeNull();
  act(() =>
    host
      .querySelector("header")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(calls).toContainEqual({ cmd: "voice_overlay_nudge", args: { dx: 16, dy: 0 } });
  const moves = calls.filter((call) => call.cmd === "voice_overlay_nudge").length;
  act(() =>
    host
      .querySelector("header button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
  );
  expect(calls.filter((call) => call.cmd === "voice_overlay_nudge")).toHaveLength(moves);
  await show({
    visualState: "connected",
    statusText: "Connected · Microphone off",
    muted: true,
    chatTurns: [],
  });
  expect(host.querySelector('[data-state="connected"]')).not.toBeNull();
  expect(host.textContent).toContain("Connected · Microphone off");
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(0);
});

it("opens a question beside the detached companion on the side with room", async () => {
  room = { left: 0, right: 900 };
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({ choice });
  const side = host.querySelector("aside")!;
  expect(side.textContent).toContain("Which folder?");
  expect(host.querySelector("main")?.contains(side)).toBe(false);
  expect(host.firstElementChild?.getAttribute("data-side")).toBe("right");
  expect(fits().at(-1)).toMatchObject({ width: 728 });
  expect(fits().some((args) => args.shiftX)).toBe(false);
});

it("grows to the left near the right screen edge and moves back when answered", async () => {
  room = { left: 900, right: 0 };
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({ choice });
  expect(host.firstElementChild?.getAttribute("data-side")).toBe("left");
  expect(fits().find((args) => args.shiftX)).toMatchObject({ width: 728, shiftX: -348 });
  calls.length = 0;
  await show({ choice: null });
  expect(host.querySelector("aside")).toBeNull();
  expect(fits().find((args) => args.shiftX)).toMatchObject({ width: 380, shiftX: 348 });
});

it("keeps the question inside the window when the screen has no room beside it", async () => {
  room = { left: 100, right: 100 };
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({ choice });
  expect(host.querySelector("aside")).toBeNull();
  expect(host.querySelector("main")?.textContent).toContain("Which folder?");
});

const unreachable = "The app window did not receive that. Return to the app and try again.";

it("shows a failure when a command cannot reach the owner window", async () => {
  const { emitTo } = await import("@tauri-apps/api/event");
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({});
  expect(host.textContent).not.toContain(unreachable);
  vi.mocked(emitTo).mockRejectedValue(new Error("window gone"));
  const disconnect = [...host.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-label") === "Disconnect voice",
  )!;
  await act(async () => disconnect.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(unreachable);
  vi.mocked(emitTo).mockResolvedValue(undefined);
});

it("keeps a question answerable and says so when the answer cannot be delivered", async () => {
  const { emitTo } = await import("@tauri-apps/api/event");
  room = { left: 100, right: 100 };
  await act(async () => root.render(createElement(VoiceOverlayWindow, { owner: "main" })));
  await show({ choice });
  vi.mocked(emitTo).mockRejectedValue(new Error("window gone"));
  const option = host.querySelector<HTMLElement>('input[type="radio"]')!;
  await act(async () => option.click());
  const send = [...host.querySelectorAll("button")].find((b) => b.textContent === "Send answer")!;
  await act(async () => send.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.textContent).toContain(unreachable);
  expect(host.textContent).toContain("Answer was not sent. Your answer is kept; try again.");
  vi.mocked(emitTo).mockResolvedValue(undefined);
});
