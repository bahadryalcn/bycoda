// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadVoiceSettings, saveVoiceSettings } from "../../voice/model/voiceSettings";
const state = vi.hoisted(() => ({
  environmentId: "host-a" as string | null,
  request: vi.fn(),
  close: vi.fn(),
  keepAwake: undefined as
    | { supported: boolean; requested: boolean; active: boolean; error?: string }
    | undefined,
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
const models = vi.hoisted(() => ({
  available: true,
  offered: true,
  worker: {
    harness: "codex" as const,
    id: "codex:fixture-discovered-model",
    name: "Discovered fixture model",
    nativeId: "fixture-discovered-model",
    settings: [
      {
        id: "effort",
        label: "Effort",
        value: "medium",
        options: [{ value: "medium", label: "Medium" }],
      },
    ],
  },
}));
vi.mock("../../../shared/ui/settings", async () => {
  const { createElement } = await import("react");
  return {
    Row: ({ label, description, info, children }: any) =>
      createElement(
        "div",
        { role: "group", "aria-label": label },
        createElement("span", null, label),
        description ? createElement("p", null, description) : null,
        info,
        children,
      ),
    Group: ({ title, info, action, children }: any) =>
      createElement("section", null, createElement("h2", null, title), info, action, children),
  };
});
vi.mock("../../sessions/ui/modelSource", () => ({
  useModelSource: () => ({
    resolve: () => models.worker,
    modelsFor: () => (models.offered ? [models.worker] : []),
    available: () => models.available,
  }),
}));
vi.mock("../model/assistantClient", () => ({
  useAssistantSnapshot: () => ({
    snapshot: {
      profile: state.profile,
      keepAwake: state.keepAwake,
      capabilities: { observationTasks: false },
    },
    environmentId: state.environmentId,
    loading: false,
    error: "",
    refresh: vi.fn(),
  }),
  assistantRequest: state.request,
}));
vi.mock("./AssistantProfileFields", () => ({
  AssistantProfileFields: ({
    section,
    onChange,
  }: {
    section: string;
    onChange: (patch: Record<string, unknown>) => void;
  }) =>
    section === "workmode"
      ? createElement(
          "div",
          null,
          createElement(
            "button",
            {
              type: "button",
              onClick: () =>
                onChange({
                  autonomy: "report",
                  planApproval: "always",
                  confirmJobs: true,
                  allowRoutineQuestions: false,
                }),
            },
            "Fixture only watch",
          ),
          createElement(
            "button",
            {
              type: "button",
              onClick: () =>
                onChange({
                  autonomy: "chief",
                  planApproval: "large",
                  confirmJobs: true,
                  allowRoutineQuestions: true,
                }),
            },
            "Fixture work and ask",
          ),
        )
      : null,
}));
vi.mock("../../voice/ui/VoiceSetupSteps", () => ({
  VoiceSetupSteps: ({
    step,
    onValidChange,
  }: {
    step: string;
    onValidChange: (valid: boolean) => void;
  }) => createElement("button", { onClick: () => onValidChange(true) }, `Verify ${step}`),
}));
vi.mock("../../voice/model/voicePersona", () => ({ loadVoicePersona: () => ({ rules: "" }) }));
vi.mock("../../../shared/i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
  useLocale: () => "en",
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("en", options).format(value),
  translateAt: (_locale: string, key: string) => key,
}));
import { AssistantSetup } from "./AssistantSetup";
let root: Root, container: HTMLDivElement;
const key = "bycoda.assistant.setup-draft";
const draft = (environmentId?: string) => ({
  step: "review",
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
// #784: the draft is written by a debounced writer; pagehide flushes it so tests read storage now.
function flushDraft() {
  window.dispatchEvent(new Event("pagehide"));
}
async function render(voice = false) {
  await act(() => root.render(createElement(AssistantSetup, { onClose: state.close, voice })));
  flushDraft();
}
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  )!;
}
// A blocked control with a reason stays focusable, so it is aria-disabled rather than disabled.
const blocked = (node: HTMLButtonElement) =>
  node.disabled || node.getAttribute("aria-disabled") === "true";
async function click(label: string) {
  await act(() => button(label).click());
  flushDraft();
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
  state.profile.dailyTokenBudget = 200000;
  state.profile.setupComplete = false;
  state.keepAwake = undefined;
  models.available = true;
  models.offered = true;
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
  // No second dialog: a successful Start closes setup and clears the draft.
  expect(state.close).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain("Ready for 24/7");
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
it("shows one voice check per step and finishes without preview or microphone verification", async () => {
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: "identity" }));
  await render(true);
  const titles = ["Identity", "Voice provider", "Speaker", "Microphone", "Review"];
  for (let step = 0; step < titles.length; step++) {
    const dialog = document.querySelector('[role="dialog"]')!;
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(heading?.textContent).toBe("Voice setup");
    expect(dialog.querySelector('[aria-current="step"]')?.textContent).toContain(titles[step]);
    expect(dialog.querySelectorAll("h2")).toHaveLength(1);
    expect(dialog.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(key)!).rules).toBe("Keep replies concise");
    if (titles[step] === "Voice provider") {
      expect(blocked(button("Next"))).toBe(true);
      expect(document.body.textContent).not.toContain("Verify microphone");
      await click("Verify provider");
    }
    if (titles[step] === "Speaker" || titles[step] === "Microphone") {
      expect(blocked(button("Next"))).toBe(false);
      expect(document.body.textContent).toContain("Optional");
    }
    if (step < titles.length - 1) await click("Next");
  }
  expect(state.request).not.toHaveBeenCalled();
  expect(blocked(button("Start"))).toBe(false);
  await start();
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({ voiceSetupComplete: true }),
    }),
    "host-a",
  );
});
it("adds voice to a configured assistant without rewriting the saved profile or its rules", async () => {
  state.profile.setupComplete = true;
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: "voice" }));
  await render(true);
  expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Voice provider");
  await click("Verify provider");
  await click("Next");
  await click("Next");
  await click("Next");
  await start();
  expect(state.request).toHaveBeenCalledExactlyOnceWith(
    { op: "profile.update", expectedVersion: 3, patch: { voiceSetupComplete: true } },
    "host-a",
  );
});
it("requires fresh voice verification when reopening a persisted Review draft", async () => {
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  await render(true);
  expect(blocked(button("Start"))).toBe(true);
  expect(document.body.textContent).not.toContain("Set up voice");
  expect(state.request).not.toHaveBeenCalled();
});
it("retains the provider check after changing the speaker but invalidates it after changing providers", async () => {
  saveVoiceSettings({ ...loadVoiceSettings(), mode: "local", natural: true, engine: "supertonic" });
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: "voice" }));
  await render(true);
  await click("Verify provider");
  await click("Next");
  await click("Next");
  await click("Next");
  expect(blocked(button("Start"))).toBe(false);
  const settings = loadVoiceSettings();
  await act(async () =>
    saveVoiceSettings({ ...settings, speakers: { ...settings.speakers, supertonic: "F2" } }),
  );
  expect(blocked(button("Start"))).toBe(false);
  await act(async () => saveVoiceSettings({ ...loadVoiceSettings(), mode: "grok" }));
  expect(blocked(button("Start"))).toBe(true);
  expect(state.request).not.toHaveBeenCalled();
});
it("offers a usable fresh budget without writing or changing its authority choices", async () => {
  state.profile.dailyTokenBudget = 0;
  await render();
  const saved = JSON.parse(localStorage.getItem(key)!);
  expect(saved.patch.dailyTokenBudget).toBe(1_000_000);
  expect(saved.patch.autonomy).toBe("report");
  expect(saved.patch.execution).toBeNull();
  expect(state.request).not.toHaveBeenCalled();
});
it.each([0, 5, 19_999, 20_000, 275000])(
  "replaces only a draft budget below the minimum, here %s",
  async (budget) => {
    const retained = draft("host-a");
    retained.patch.dailyTokenBudget = budget;
    localStorage.setItem(key, JSON.stringify(retained));
    await render();
    expect(JSON.parse(localStorage.getItem(key)!).patch.dailyTokenBudget).toBe(
      budget < 20_000 ? 1_000_000 : budget,
    );
    expect(JSON.parse(localStorage.getItem(key)!).rules).toBe(retained.rules);
    expect(state.request).not.toHaveBeenCalled();
  },
);
it("gives a completed profile with a zero budget a usable one, so quick setup can finish", async () => {
  const retained = draft("host-a");
  retained.patch.dailyTokenBudget = 0;
  retained.patch.setupComplete = true;
  localStorage.setItem(key, JSON.stringify(retained));
  await render();
  expect(JSON.parse(localStorage.getItem(key)!).patch.dailyTokenBudget).toBe(1_000_000);
});
it("runs core setup as one screen with the name, a preselected work mode and Start", async () => {
  await render();
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Next");
  expect(document.body.textContent).not.toContain("Back");
  expect(document.body.textContent).not.toContain("Set up with AI");
  expect(document.querySelector("textarea")).toBeNull();
  // "Only watch" is applied up front, so nothing blocks Start on a first setup.
  const saved = JSON.parse(localStorage.getItem(key)!).patch;
  expect(saved).toMatchObject({ autonomy: "report", planApproval: "always", confirmJobs: true });
  expect(blocked(button("Start"))).toBe(false);
  await click("Fixture work and ask");
  expect(JSON.parse(localStorage.getItem(key)!).patch.autonomy).toBe("chief");
});
it("keeps reviewed values and rules after a failed save and retries against the same Host", async () => {
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  state.request.mockRejectedValueOnce(new Error("Fixture save unavailable"));
  await render();
  await start();
  expect(document.body.textContent).toContain("Could not save assistant setup.");
  expect(document.body.textContent).not.toContain("Fixture save unavailable");
  await click("Details");
  expect(document.body.textContent).toContain("Fixture save unavailable");
  await click("Details");
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(draft("host-a"));
  expect(state.close).not.toHaveBeenCalled();
  await start();
  expect(state.request.mock.calls.every((call) => call[1] === "host-a")).toBe(true);
  expect(state.close).toHaveBeenCalledOnce();
});
it("materializes a missing worker in a retained unconfigured draft only at Start", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ ...draft("host-a"), patch: { ...state.profile, autonomy: "jobs" } }),
  );
  await render();
  expect(JSON.parse(localStorage.getItem(key)!).patch.execution).toBeNull();
  await start();
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({
        execution: expect.objectContaining({
          model: models.worker.id,
          runtimeMode: "supervised",
          maxRunMinutes: 60,
        }),
      }),
    }),
    "host-a",
  );
});
it.each(["missing", "unavailable"])(
  "keeps the draft and makes no write for a %s default catalog",
  async (issue) => {
    models.offered = issue !== "missing";
    models.available = issue !== "unavailable";
    const retained = { ...draft("host-a"), patch: { ...state.profile, autonomy: "chief" } };
    localStorage.setItem(key, JSON.stringify(retained));
    await render();
    expect(document.body.textContent).not.toContain(models.worker.name);
    await start();
    expect(state.request).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Choose a provider and model");
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(retained);
  },
);
it("does not replace a chosen execution or materialize a completed profile's null choice", async () => {
  const execution = {
    harness: "claude",
    model: "claude:fixture-explicit",
    modelSettings: { effort: "high" },
    runtimeMode: "auto-accept-edits",
    maxRunMinutes: 17,
  };
  localStorage.setItem(
    key,
    JSON.stringify({
      ...draft("host-a"),
      patch: { ...state.profile, autonomy: "chief", execution },
    }),
  );
  await render();
  await start();
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({ execution }),
    }),
    "host-a",
  );
  await act(() => root.unmount());
  root = createRoot(container);
  state.request.mockClear();
  state.profile.setupComplete = true;
  localStorage.setItem(
    key,
    JSON.stringify({
      ...draft("host-a"),
      patch: { ...state.profile, autonomy: "jobs", execution: null },
    }),
  );
  await render();
  await start();
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({ execution: null }),
    }),
    "host-a",
  );
});
it("hides confirmed sleep prevention off while retaining unknown, pending, active and errors", async () => {
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: "presence" }));
  await render(true);
  expect(document.body.textContent).toContain("Sleep prevention status unavailable");
  state.keepAwake = { supported: true, requested: false, active: false };
  await render(true);
  expect(document.body.textContent).not.toContain("Sleep prevention is off");
  expect(document.body.textContent).not.toContain("Sleep prevention status unavailable");
  state.keepAwake = { supported: true, requested: true, active: false };
  await render(true);
  expect(document.body.textContent).toContain("Waiting to prevent sleep");
  state.keepAwake = { supported: true, requested: true, active: true };
  await render(true);
  expect(document.body.textContent).toContain("Keeping this computer awake");
  state.keepAwake = {
    supported: true,
    requested: false,
    active: false,
    error: "Fixture native failure",
  };
  await render(true);
  expect(document.querySelector("[data-assistant-keep-awake]")?.getAttribute("role")).toBe("alert");
  // The raw native failure sits behind the Details popover, which opens above the dialog.
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label^="Details"]');
  await act(async () => trigger?.click());
  expect([...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent).toContain(
    "Fixture native failure",
  );
});

it.each([
  [0, "identity"],
  [1, "identity"],
  [2, "voice"],
  [3, "voice"],
  [4, "voice"],
  [5, "identity"],
  [6, "workmode"],
  [7, "presence"],
  [8, "presence"],
  [9, "review"],
])("migrates legacy step %s to %s without losing the draft", async (legacy, step) => {
  const saved = { ...draft("host-a"), step: legacy };
  localStorage.setItem(key, JSON.stringify(saved));
  await render(true);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ ...saved, step });
  expect(state.request).not.toHaveBeenCalled();
  if (step === "voice") expect(blocked(button("Next"))).toBe(true);
});
