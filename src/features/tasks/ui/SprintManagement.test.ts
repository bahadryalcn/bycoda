import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  sprintDateNumber,
  sprintDateValue,
  SprintGoalDescription,
  SprintManagement,
} from "./SprintManagement";
import type { SprintBoardController } from "../model/sprintClient";
import type { SprintProjectRef } from "../model/hostSprints";

it("round-trips calendar dates without shifting at positive or negative UTC offsets", () => {
  const date = "2026-10-26";
  const encoded = sprintDateNumber(date)!;
  expect(new Date(encoded).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  expect(sprintDateValue(encoded)).toBe(date);
  expect(new Date(encoded).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })).toBe(date);
  expect(sprintDateValue(sprintDateNumber(sprintDateValue(encoded)))).toBe(date);
  expect(sprintDateNumber("")).toBeUndefined();
  expect(sprintDateValue(undefined)).toBe("");
});

it("keeps legacy UTC dates stable when opened and saved across time zones and DST", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of [
      "Etc/GMT+12",
      "Pacific/Kiritimati",
      "Europe/Istanbul",
      "America/Los_Angeles",
    ]) {
      process.env.TZ = zone;
      for (const day of ["1970-01-01", "2026-03-08", "2026-11-01", "2026-10-26"]) {
        const legacy = Date.parse(`${day}T00:00:00.000Z`);
        const editValue = sprintDateValue(legacy);
        const saved = sprintDateNumber(editValue);
        expect(saved, `${zone} ${day}`).toBe(legacy);
        expect(sprintDateValue(saved), `${zone} ${day}`).toBe(day);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

it("shows a valid epoch-zero sprint start in the selected sprint summary", () => {
  const project = {
    environmentId: "local",
    projectId: "project",
    cwd: "/project",
  } as SprintProjectRef;
  const board = {
    sprints: [
      { id: "s", name: "Epoch", state: "planned", revision: 1, projects: [project], startsAt: 0 },
    ],
    sources: [],
    planning: new Map(),
    machines: [],
    supported: false,
    loading: false,
    syncErrors: [],
    lifecycleIssue: () => undefined,
  } as unknown as SprintBoardController;
  const html = renderToStaticMarkup(
    createElement(SprintManagement, {
      board,
      projects: [project],
      selectedId: "s",
      onSelect: () => {},
    }),
  );
  expect(html).toContain("1970-01-01");
});

it("keeps a long sprint goal collapsed while preserving all of its content", () => {
  const goal = "A long sprint objective. ".repeat(135);
  const html = renderToStaticMarkup(createElement(SprintGoalDescription, { goal }));
  expect(html).toContain("<details");
  expect(html).not.toContain("<details open");
  expect(html).toContain("<summary>");
  expect(html).toContain(goal);
  expect(html).toContain('tabindex="0"');
  const shortGoal = renderToStaticMarkup(
    createElement(SprintGoalDescription, { goal: "Ship the first flow." }),
  );
  expect(shortGoal).not.toContain("<details");
  expect(shortGoal).toContain("Ship the first flow.");
});
