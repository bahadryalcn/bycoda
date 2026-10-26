import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sprintDateNumber, sprintDateValue, SprintGoalDescription } from "./SprintManagement";

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
