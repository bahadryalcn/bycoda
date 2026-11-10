import { expect, it } from "vitest";
import { deriveAlwaysOnItems, type AlwaysOnInput } from "./assistantAlwaysOn";

const ready: AlwaysOnInput = {
  profile: {
    enabled: true,
    setupComplete: true,
    autonomy: "jobs",
    execution: null,
    dailyTokenBudget: 20_000,
    keepAwakeWhileWorking: true,
    observationTaskDone: true,
    observationTaskNeedsInput: true,
    notificationAway: "urgent",
    quietStart: 22,
    quietEnd: 8,
  },
  keepAwake: { supported: true },
  poolRows: [{ roles: ["worker"] }],
  alwaysOn: { pushPhones: 1, assistantPushPhones: 1 },
};
const state = (input: AlwaysOnInput, id: string) =>
  deriveAlwaysOnItems(input).find((item) => item.id === id)?.state;
const withProfile = (patch: Partial<AlwaysOnInput["profile"]>): AlwaysOnInput => ({
  ...ready,
  profile: { ...ready.profile, ...patch },
});

it("marks a fully prepared setup ready except the two that need a human look", () => {
  const states = Object.fromEntries(deriveAlwaysOnItems(ready).map((i) => [i.id, i.state]));
  expect(states).toMatchObject({ enabled: "done", keepAwake: "done", phonePush: "done" });
  expect(states.quietHours).toBe("review");
  expect(states.logout).toBe("unknown");
  expect(Object.values(states).filter((value) => value === "todo")).toEqual([]);
});

it("flags each missing setting", () => {
  expect(state(withProfile({ enabled: false }), "enabled")).toBe("todo");
  expect(state(withProfile({ setupComplete: false }), "enabled")).toBe("todo");
  expect(state(withProfile({ autonomy: "report" }), "autonomy")).toBe("todo");
  expect(state(withProfile({ autonomy: "chief" }), "autonomy")).toBe("done");
  expect(state(withProfile({ dailyTokenBudget: 0 }), "budget")).toBe("todo");
  expect(state(withProfile({ dailyTokenBudget: 19_999 }), "budget")).toBe("todo");
  expect(state(withProfile({ keepAwakeWhileWorking: false }), "keepAwake")).toBe("todo");
  expect(state(withProfile({ observationTaskDone: false }), "observation")).toBe("todo");
  expect(state(withProfile({ notificationAway: "none" }), "awayNotices")).toBe("todo");
  expect(state(withProfile({ notificationAway: "all" }), "awayNotices")).toBe("done");
});

it("reads the worker model from the pool, falling back to the profile, else unknown", () => {
  expect(state({ ...ready, poolRows: [{ roles: ["chief"] }] }, "model")).toBe("todo");
  expect(state({ ...ready, poolRows: [] }, "model")).toBe("todo");
  expect(state({ ...ready, poolRows: null }, "model")).toBe("unknown");
  const execution = { harness: "codex", model: "m" } as never;
  expect(state({ ...withProfile({ execution }), poolRows: null }, "model")).toBe("done");
});

it("reports unsupported keep-awake and unknown or missing phone push", () => {
  const unsupported = { ...ready, keepAwake: { supported: false } };
  expect(state(unsupported, "keepAwake")).toBe("unsupported");
  expect(
    deriveAlwaysOnItems(unsupported).find((i) => i.id === "keepAwake")?.target,
  ).toBeUndefined();
  expect(state({ ...ready, keepAwake: undefined }, "keepAwake")).toBe("done");
  expect(state({ ...ready, alwaysOn: null }, "phonePush")).toBe("unknown");
  expect(
    state({ ...ready, alwaysOn: { pushPhones: 0, assistantPushPhones: 0 } }, "phonePush"),
  ).toBe("todo");
  expect(
    state({ ...ready, alwaysOn: { pushPhones: 2, assistantPushPhones: 0 } }, "phonePush"),
  ).toBe("todo");
});

it("shows the current quiet range, or none when it is empty", () => {
  const detail = (patch: Partial<AlwaysOnInput["profile"]>) =>
    deriveAlwaysOnItems(withProfile(patch)).find((i) => i.id === "quietHours")!.detail;
  expect(detail({})).toContain("22:00");
  expect(detail({})).toContain("08:00");
  expect(detail({ quietStart: 0, quietEnd: 0 })).toBe("No quiet hours.");
});

it("shows fixing advice only on items that are not ready", () => {
  const detail = (input: AlwaysOnInput, id: string) =>
    deriveAlwaysOnItems(input).find((item) => item.id === id)?.detail;
  for (const id of ["autonomy", "budget", "keepAwake", "observation", "awayNotices"])
    expect(detail(ready, id), id).toBe("");
  expect(detail(withProfile({ autonomy: "report" }), "autonomy")).toContain("Report only");
  expect(detail(withProfile({ observationTaskDone: false }), "observation")).toContain("still off");
});
