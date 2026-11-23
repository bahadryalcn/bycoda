import { expect, it, vi } from "vitest";
import {
  automationName,
  backgroundRequired,
  backgroundTriggerReady,
  resolveRunMode,
  withAddedTrigger,
  withBackgroundChoice,
  withHostTrigger,
  withoutTriggers,
  withTemplate,
} from "./automationDraftRules";
import { createAutomationTrigger, newAutomationDraft, type AutomationDraft } from "./automations";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

const draft = (patch: Partial<AutomationDraft> = {}): AutomationDraft => ({
  ...newAutomationDraft("/work/project", "codex", "model"),
  ...patch,
});
const time = (event = "daily") => createAutomationTrigger("time", event);

it("requires a Host for another machine's project, no project, a Host trigger or a template", () => {
  expect(backgroundRequired(draft())).toBe(false);
  expect(backgroundRequired(draft({ cwd: "remote://other/work/project" }))).toBe(true);
  expect(backgroundRequired(draft({ cwd: "" }))).toBe(true);
  expect(
    backgroundRequired(draft({ hostTrigger: { kind: "continuous", minimumGapMinutes: 30 } })),
  ).toBe(true);
  expect(
    backgroundRequired(draft({ hostTemplate: { kind: "project-scan", sourceStewardId: "new" } })),
  ).toBe(true);
});

it("moves a new draft to the background with its remote project and back with a local one", () => {
  const local = draft({ triggers: [time()] });
  const remote = resolveRunMode(local, { ...local, cwd: "remote://other/work/project" });
  expect(remote.runInBackground).toBe(true);
  const back = resolveRunMode(remote, { ...remote, cwd: "/work/project" });
  expect(back.runInBackground).toBe(false);
});

it("keeps the owner's own background choice across a project change", () => {
  const chosen = withBackgroundChoice(draft({ triggers: [time()] }), true);
  expect(chosen.runInBackground).toBe(true);
  const moved = resolveRunMode(chosen, { ...chosen, cwd: "/work/other" });
  expect(moved.runInBackground).toBe(true);
});

it("never changes the run mode a stored automation was saved with", () => {
  const stored = draft({ id: "stored", runInBackground: true, triggers: [time()] });
  expect(resolveRunMode(stored, { ...stored, cwd: "/work/other" }).runInBackground).toBe(true);
  const local = draft({ id: "local", triggers: [time()] });
  expect(
    resolveRunMode(local, { ...local, cwd: "remote://other/work/project" }).runInBackground,
  ).toBe(false);
});

it("cannot build a background draft that holds anything but one time trigger or one Host event", () => {
  const github = createAutomationTrigger("github", "issue_opened");
  const mixed = draft({ triggers: [time("daily"), github, time("weekly")] });
  const background = withBackgroundChoice(mixed, true);
  expect(background.triggers).toHaveLength(1);
  expect(background.triggers[0].kind).toBe("time");
  expect(backgroundTriggerReady(background)).toBe(true);

  const onlyEvent = withBackgroundChoice(draft({ triggers: [github] }), true);
  expect(onlyEvent.triggers).toEqual([]);
  expect(backgroundTriggerReady(onlyEvent)).toBe(false);
});

it("swaps the single trigger of a background draft and adds to a local one", () => {
  const background = withBackgroundChoice(draft({ triggers: [time("daily")] }), true);
  const swapped = withAddedTrigger(background, time("weekly"));
  expect(swapped.triggers).toHaveLength(1);
  expect(swapped.triggers[0].scheduleKind).toBe("weekly");

  const local = draft({ triggers: [time("daily")] });
  expect(withAddedTrigger(local, time("weekly")).triggers).toHaveLength(2);
});

it("replaces the time triggers with one Host event and forces the background", () => {
  const next = withHostTrigger(draft({ triggers: [time()] }), {
    kind: "event",
    event: "task.finished",
  });
  expect(next.runInBackground).toBe(true);
  expect(next.hostTrigger).toEqual({ kind: "event", event: "task.finished" });
  expect(next.triggers).toEqual([]);
  expect(backgroundTriggerReady(next)).toBe(true);
});

it("leaves the draft to add its next trigger after the Host trigger is removed", () => {
  const hosted = withHostTrigger(draft(), { kind: "continuous", minimumGapMinutes: 30 });
  const cleared = withoutTriggers(hosted);
  expect(cleared.hostTrigger).toBeUndefined();
  expect(cleared.triggers).toEqual([]);
  // A new draft that only the Host trigger forced into the background returns to the app.
  expect(cleared.runInBackground).toBe(false);
});

it("keeps the owner's background choice after a Host trigger is added and removed", () => {
  const chosen = withBackgroundChoice(draft(), true);
  const hosted = withHostTrigger(chosen, { kind: "continuous", minimumGapMinutes: 30 });
  const cleared = withoutTriggers(hosted);
  expect(cleared.runInBackground).toBe(true);
  expect(backgroundTriggerReady(cleared)).toBe(false);
});

it("applies a template's instructions and trigger and keeps the owner's project and model", () => {
  const base = draft({ model: "chosen", triggers: [time("weekly")] });
  const next = withTemplate(base, {
    id: "find-critical-bugs",
    name: "Find critical bugs",
    prompt: "Look for bugs.",
    trigger: { kind: "time", event: "weekdays", scheduleKind: "weekdays", time: "09:00" },
  });
  expect(next).toMatchObject({
    name: "Find critical bugs",
    prompt: "Look for bugs.",
    cwd: "/work/project",
    model: "chosen",
    runInBackground: false,
    hostTemplate: undefined,
  });
  expect(next.triggers).toHaveLength(1);
  expect(next.triggers[0]).toMatchObject({ kind: "time", scheduleKind: "weekdays", time: "09:00" });
});

it("starts the Host-only Project scan template in the background and drops it for another", () => {
  const scan = withTemplate(draft(), {
    id: "project-scan",
    name: "Project scan",
    prompt: "Scan.",
    trigger: { kind: "time", event: "weekdays", scheduleKind: "weekdays", time: "09:00" },
  });
  expect(scan.runInBackground).toBe(true);
  expect(scan.hostTemplate).toEqual({ kind: "project-scan", sourceStewardId: "new" });
  const other = withTemplate(scan, {
    id: "find-critical-bugs",
    name: "Find critical bugs",
    prompt: "Look for bugs.",
    trigger: { kind: "time", event: "weekdays", scheduleKind: "weekdays", time: "09:00" },
  });
  expect(other.hostTemplate).toBeUndefined();
  expect(other.runInBackground).toBe(false);
});

it("derives the stored name from the first instruction line unless one is given", () => {
  expect(automationName({ name: "  Nightly  ", prompt: "Do things" })).toBe("Nightly");
  expect(
    automationName({ name: "", prompt: "\n\nReview the open pull requests\nThen report" }),
  ).toBe("Review the open pull requests");
  expect(automationName({ name: "", prompt: "   " })).toBe("");
  expect(automationName({ name: "", prompt: "x".repeat(300) })).toHaveLength(60);
});
