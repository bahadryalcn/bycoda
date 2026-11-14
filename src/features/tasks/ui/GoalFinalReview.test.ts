// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { BoardGoal } from "../model/goalClient";
import { GoalFinalReview } from "./GoalFinalReview";

function render(status: BoardGoal["status"], acceptance?: BoardGoal["finalAcceptance"]) {
  return renderToStaticMarkup(
    createElement(GoalFinalReview, {
      goal: { status, finalReview: true, finalAcceptance: acceptance } as BoardGoal,
      busy: false,
      onRecheckFinal: () => {},
    }),
  );
}

it("does not call a cancelled epic's unfinished acceptance queued or running", () => {
  expect(render("cancelled")).toBe("");
  expect(render("cancelled", { status: "pending", taskFingerprint: "fixture" })).toBe("");
  expect(render("cancelled", { status: "running", taskFingerprint: "fixture" })).toBe("");
  expect(render("running")).toContain("Queued");
});

it("keeps completed acceptance evidence without offering to restart a cancelled epic", () => {
  const failed = {
    status: "failed",
    taskFingerprint: "fixture",
    note: "Missing device proof",
  } as const;
  expect(render("cancelled", failed)).toContain("Missing device proof");
  expect(render("cancelled", failed)).not.toContain("Recheck final acceptance");
  expect(render("blocked", failed)).toContain("Recheck final acceptance");
});
