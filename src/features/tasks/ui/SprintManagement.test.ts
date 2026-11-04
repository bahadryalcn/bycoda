import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sprintDateNumber, sprintDateValue, SprintGoalDescription } from "./SprintManagement";

function withZone<T>(zone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

it("stores local midnight and round-trips calendar dates at positive and negative UTC offsets", () => {
  for (const zone of ["Europe/Istanbul", "America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
    withZone(zone, () => {
      const encoded = sprintDateNumber("2026-10-26")!;
      const local = new Date(encoded);
      expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([
        2026, 9, 26, 0,
      ]);
      expect(sprintDateValue(encoded)).toBe("2026-10-26");
      expect(sprintDateValue(sprintDateNumber(sprintDateValue(encoded)))).toBe("2026-10-26");
    });
  }
  expect(sprintDateNumber("")).toBeUndefined();
  expect(sprintDateValue(undefined)).toBe("");
});

it("still reads sprints saved as UTC midnight as the day that was picked", () => {
  const legacy = Date.UTC(2026, 9, 26);
  for (const zone of ["America/Los_Angeles", "Europe/Istanbul", "Pacific/Auckland"])
    withZone(zone, () => expect(sprintDateValue(legacy)).toBe("2026-10-26"));
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
