// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
vi.mock("../../settings/public/settingsControls", async () => {
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
    AdvancedSettings: ({ title, children }: any) =>
      createElement("div", null, createElement("button", { type: "button" }, title), children),
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
    workModeUnchosen,
    onChange,
  }: {
    section: string;
    workModeUnchosen?: boolean;
    onChange: (patch: Record<string, unknown>) => void;
  }) =>
    section === "workmode"
      ? createElement(
          "div",
          { "data-unchosen": String(workModeUnchosen === true) },
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
  VoiceSetupSteps: ({ onValidChange }: { onValidChange: (valid: boolean) => void }) =>
    createElement("button", { onClick: () => onValidChange(true) }, "Verify fixture step"),
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
async function render(voice = false) {
  await act(() => root.render(createElement(AssistantSetup, { onClose: state.close, voice })));
}
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  )!;
}
async function click(label: string) {
  await act(() => button(label).click());
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
  expect(state.close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Ready for 24/7");
  await act(async () => button("Done").click());
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
it("keeps all ten voice steps and gates each verification without any setup write before Start", async () => {
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: 0 }));
  await render(true);
  const titles = [
    "Identity",
    "Language",
    "Voice provider",
    "Voice",
    "Microphone test",
    "Conversation behavior",
    "Work mode",
    "Presence and hours",
    "First rules",
    "Review",
  ];
  for (let step = 0; step < titles.length; step++) {
    const dialog = document.querySelector('[role="dialog"]')!;
    const heading = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(heading?.textContent).toBe(titles[step]);
    expect(dialog.querySelectorAll("h2")).toHaveLength(1);
    expect(dialog.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      String(step + 1),
    );
    expect(JSON.parse(localStorage.getItem(key)!).rules).toBe("Keep replies concise");
    if (step >= 2 && step <= 4) {
      expect(button("Next").disabled).toBe(true);
      await click("Verify fixture step");
    }
    if (titles[step] === "Work mode") {
      expect(button("Next").disabled).toBe(true);
      await click("Fixture only watch");
    }
    if (step < 9) await click("Next");
  }
  expect(state.request).not.toHaveBeenCalled();
  expect(button("Start").disabled).toBe(false);
  await click("Back");
  expect(document.querySelector("textarea")?.value).toBe("Keep replies concise");
  await click("Next");
  await start();
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      op: "profile.update",
      patch: expect.objectContaining({ voiceSetupComplete: true }),
    }),
    "host-a",
  );
});
it("requires fresh voice verification when reopening a persisted Review draft", async () => {
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  await render(true);
  expect(button("Start").disabled).toBe(true);
  await click("Set up voice");
  expect(JSON.parse(localStorage.getItem(key)!).step).toBe(2);
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
it("runs quick setup as identity, work mode and review, without model or rules steps", async () => {
  await render();
  const heading = () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent;
  };
  const progress = () => {
    const bar = document.querySelector('[role="progressbar"]')!;
    return [bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")];
  };
  expect(heading()).toBe("Identity");
  expect(progress()).toEqual(["1", "3"]);
  await click("Next");
  expect(heading()).toBe("Work mode");
  expect(progress()).toEqual(["2", "3"]);
  expect(document.body.textContent).not.toContain("Worker model");
  // Nothing is chosen on a first setup, so Next waits for an explicit work mode.
  expect(document.querySelector("[data-unchosen]")?.getAttribute("data-unchosen")).toBe("true");
  expect(button("Next").disabled).toBe(true);
  await click("Fixture only watch");
  expect(button("Next").disabled).toBe(false);
  await click("Next");
  expect(heading()).toBe("Review");
  expect(progress()).toEqual(["3", "3"]);
  expect(document.body.textContent).toContain("Work modeOnly watch");
  expect(document.querySelector("textarea")).toBeNull();
  expect(button("Start").disabled).toBe(false);
});
it("shows Custom for an already set up profile whose job settings match no work mode", async () => {
  state.profile.setupComplete = true;
  const retained = draft("host-a");
  retained.patch.setupComplete = true;
  retained.patch.autonomy = "jobs" as never;
  localStorage.setItem(key, JSON.stringify({ ...retained, step: 6 }));
  await render();
  expect(document.querySelector("[data-unchosen]")?.getAttribute("data-unchosen")).toBe("false");
  expect(button("Next").disabled).toBe(false);
  await click("Next");
  expect(document.body.textContent).toContain("Work modeCustom");
});
it("keeps reviewed values and rules after a failed save and retries against the same Host", async () => {
  localStorage.setItem(key, JSON.stringify(draft("host-a")));
  state.request.mockRejectedValueOnce(new Error("Fixture save unavailable"));
  await render();
  await start();
  expect(document.body.textContent).toContain("Fixture save unavailable");
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(draft("host-a"));
  expect(state.close).not.toHaveBeenCalled();
  await start();
  expect(state.request.mock.calls.every((call) => call[1] === "host-a")).toBe(true);
  expect(state.close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Ready for 24/7");
  await act(async () => button("Done").click());
  expect(state.close).toHaveBeenCalledOnce();
});
it.each(["jobs", "chief"])(
  "materializes the displayed %s worker default only on explicit autonomy Next",
  async (autonomy) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        ...draft("host-a"),
        step: 6,
        patch: {
          ...state.profile,
          autonomy,
          chiefExecution: null,
          replyExecution: null,
          planningExecution: null,
        },
      }),
    );
    await render();
    expect(JSON.parse(localStorage.getItem(key)!).patch.execution).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
    await click("Next");
    const reviewed = {
      harness: "codex",
      model: models.worker.id,
      modelSettings: { effort: "medium" },
      runtimeMode: "supervised",
      maxRunMinutes: 60,
    };
    expect(JSON.parse(localStorage.getItem(key)!).patch.execution).toEqual(reviewed);
    expect(document.body.textContent).toContain("Worker model");
    expect(document.body.textContent).toContain(models.worker.name);
    await start();
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "profile.update",
        patch: expect.objectContaining({
          execution: reviewed,
          chiefExecution: null,
          replyExecution: null,
          planningExecution: null,
        }),
      }),
      "host-a",
    );
  },
);
it("materializes a missing worker in a retained unconfigured Review only at Start", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ ...draft("host-a"), patch: { ...state.profile, autonomy: "jobs" } }),
  );
  await render();
  expect(JSON.parse(localStorage.getItem(key)!).patch.execution).toBeNull();
  expect(document.body.textContent).toContain(models.worker.name);
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
  localStorage.setItem(key, JSON.stringify({ ...draft("host-a"), step: 7 }));
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
  expect(document.body.textContent).toContain("Fixture native failure");
});
