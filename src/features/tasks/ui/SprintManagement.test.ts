import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDate } from "../../../shared/i18n";
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
  // New values are local calendar days: local midnight, whatever the process zone.
  expect(new Date(encoded)).toEqual(new Date(2026, 9, 26));
  expect(sprintDateValue(encoded)).toBe(date);
  expect(new Date(encoded).toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" })).toBe(date);
  expect(sprintDateValue(sprintDateNumber(sprintDateValue(encoded)))).toBe(date);
  expect(sprintDateNumber("")).toBeUndefined();
  expect(sprintDateValue(undefined)).toBe("");
});

it("keeps legacy UTC dates on their day when opened and saved across time zones and DST", () => {
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
        const saved = sprintDateNumber(editValue)!;
        // Saving writes the calendar day as local midnight; the day itself must not move.
        expect(new Date(saved).getHours(), `${zone} ${day}`).toBe(0);
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
  expect(html).toContain(formatDate(0, { dateStyle: "medium", timeZone: "UTC" }));
});

it("displays a legacy UTC-midnight start on its UTC day and a local start on its local day", () => {
  const previous = process.env.TZ;
  const project = {
    environmentId: "local",
    projectId: "project",
    cwd: "/project",
  } as SprintProjectRef;
  try {
    // In Los Angeles the legacy instant is still Oct 25 locally; it must read as Oct 26.
    process.env.TZ = "America/Los_Angeles";
    const board = {
      sprints: [
        {
          id: "s",
          name: "Dated",
          state: "planned",
          revision: 1,
          projects: [project],
          startsAt: Date.parse("2026-10-26T00:00:00.000Z"),
          endsAt: new Date(2026, 9, 26).getTime(),
        },
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
    expect(html.split("Oct 26, 2026").length - 1).toBe(2);
    expect(html).not.toContain("Oct 25, 2026");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
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
