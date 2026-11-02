// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  environmentId: "host-a" as string | null,
  request: vi.fn(),
  close: vi.fn(),
  profile: {
    version: 3,
    name: "Owner assistant",
    dailyTokenBudget: 200000,
    setupComplete: false,
    execution: null,
    autonomy: "report",
    voiceSetupComplete: false,
  },
}));
vi.mock("../model/assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: { profile: state.profile },
    environmentId: state.environmentId,
    loading: false,
    error: "",
    refresh: vi.fn(),
  }),
  assistantRequest: state.request,
}));
vi.mock("./AssistantProfileFields", () => ({ AssistantProfileFields: () => null }));
vi.mock("./AssistantKeepAwakeStatus", () => ({ AssistantKeepAwakeStatus: () => null }));
vi.mock("../../voice/ui/VoiceSetupSteps", () => ({ VoiceSetupSteps: () => null }));
vi.mock("../../voice/model/voicePersona", () => ({ loadVoicePersona: () => ({}) }));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "en",
  translateAt: (_locale: string, key: string) => key,
}));
import { AssistantSetup } from "./AssistantSetup";
let root: Root, container: HTMLDivElement;
const key = "bycoda.assistant.setup-draft";
const draft = (environmentId?: string) => ({
  step: 9,
  environmentId,
  patch: {
    ...state.profile,
    idleMinutes: 15,
    awayMinutes: 90,
    activeStart: 22,
    activeEnd: 6,
    nudgeLimit: 0,
    chiefWakeLimit: 12,
    notificationAway: "none",
  },
  rules: "Keep replies concise",
});
async function render() {
  await act(() => root.render(createElement(AssistantSetup, { onClose: state.close })));
}
async function start() {
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Start")!
      .click();
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  state.environmentId = "host-a";
  state.request.mockReset();
  state.close.mockReset();
  state.request.mockImplementation(async (input) =>
    input.op === "profile.update"
      ? { profile: { ...state.profile, ...input.patch, setupComplete: true } }
      : { memory: { id: "rule" } },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("binds an unattempted legacy draft to the observed Host and forwards reviewed policy values", async () => {
  localStorage.setItem(key, JSON.stringify(draft()));
  await render();
  expect(JSON.parse(localStorage.getItem(key)!).environmentId).toBe("host-a");
  await start();
  expect(state.request).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ op: "memory.save", text: "Keep replies concise" }),
    "host-a",
  );
  expect(state.request).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      op: "profile.update",
      expectedVersion: 3,
      patch: expect.objectContaining({
        idleMinutes: 15,
        awayMinutes: 90,
        nudgeLimit: 0,
        chiefWakeLimit: 12,
        activeStart: 22,
        activeEnd: 6,
        notificationAway: "none",
      }),
    }),
    "host-a",
  );
  expect(state.close).toHaveBeenCalledOnce();
  expect(localStorage.getItem(key)).toBeNull();
});
it("refuses to finish an original Host draft against replacement cloned profile IDs", async () => {
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  state.environmentId = "host-b";
  await render();
  await start();
  expect(state.request).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(
    "The original setup Host is unavailable. Your draft is kept.",
  );
  expect(JSON.parse(localStorage.getItem(key)!).environmentId).toBe("host-a");
});
it("stops between rule and profile writes if the Host changes while a rule acknowledgement is pending", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  state.request.mockReturnValue(pending);
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  await render();
  await start();
  expect(state.request).toHaveBeenCalledTimes(1);
  state.environmentId = "host-b";
  await render();
  await act(() => resolve({ memory: { id: "rule" } }));
  expect(state.request).toHaveBeenCalledTimes(1);
  expect(state.request.mock.calls[0][1]).toBe("host-a");
  expect(state.close).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toContain("Keep replies concise");
});
it("makes no setup write without a verified Host identity", async () => {
  state.environmentId = null;
  localStorage.setItem(key, JSON.stringify(draft()));
  await render();
  await start();
  expect(state.request).not.toHaveBeenCalled();
});
