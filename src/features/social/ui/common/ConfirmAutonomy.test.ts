// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AutonomyAction, AutonomyLevel } from "../../model/autonomy";
import { ConfirmAutonomy, autonomyActionText } from "./ConfirmAutonomy";

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

function render(level: AutonomyLevel, dailyLimit?: number): string {
  act(() =>
    root.render(
      createElement(ConfirmAutonomy, {
        accountName: "Brand X",
        action: "reply",
        level,
        dailyLimit,
      }),
    ),
  );
  return element.textContent ?? "";
}

it("says AI acts without asking only for the autonomous level", () => {
  expect(render("autonomous")).toContain(
    "AI will reply to people on Brand X without asking you first.",
  );
});

it("says AI waits for approval at the approve level", () => {
  expect(render("approve")).toContain(
    "AI will prepare reply to people on Brand X and wait for your approval.",
  );
});

it("says nothing is sent at the suggest level", () => {
  expect(render("suggest")).toContain("Nothing is sent without you.");
});

it("states what still applies and the daily limit when one is set", () => {
  const text = render("autonomous", 20);
  expect(text).toContain(
    "Platform limits, opt-outs, working hours and the global AI stop still apply.",
  );
  expect(text).toContain("Up to 20 per day.");
});

it("omits the daily limit line when no limit is set and has no button of its own", () => {
  render("autonomous");
  expect(element.textContent).not.toContain("per day");
  expect(element.querySelectorAll("li")).toHaveLength(1);
  // The dialog that hosts this body owns Confirm and Cancel; the body alone never confirms.
  expect(element.querySelector("button")).toBeNull();
});

it("shows a daily limit of 0 as a limit, not as no limit", () => {
  expect(render("autonomous", 0)).toContain("Up to 0 per day.");
});

it.each<[AutonomyAction, string]>([
  ["publish", "publish posts"],
  ["reply", "reply to people"],
  ["comment", "comment"],
  ["message", "send direct messages"],
  ["email", "send email"],
  ["outreach", "start outreach"],
  ["audience", "collect audience data"],
  ["contacts", "update contacts"],
])("names the %s action in plain words inside the sentence", (action, text) => {
  expect(autonomyActionText(action)).toBe(text);
  act(() =>
    root.render(
      createElement(ConfirmAutonomy, { accountName: "Brand X", action, level: "autonomous" }),
    ),
  );
  expect(element.textContent).toContain(`AI will ${text} on Brand X without asking you first.`);
});
