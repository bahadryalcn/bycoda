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
