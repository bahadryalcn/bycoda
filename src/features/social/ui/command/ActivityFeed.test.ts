// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiAction } from "../../model/autonomy";
import { ActivityFeed } from "./ActivityFeed";

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

const action = (patch: Partial<AiAction>): AiAction => ({
  id: "a1",
  at: Date.now(),
  actor: "owner",
  action: "replies.send",
  summary: "replies.send · account a1",
  status: "done",
  undo: { action: "replies.delete", input: {} },
  ...patch,
});

function render(items: AiAction[], onUndo = vi.fn()) {
  act(() => root.render(createElement(ActivityFeed, { items, onUndo })));
  return onUndo;
}

function buttonWithText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
}

const rows = () => [...element.querySelectorAll<HTMLElement>(".social-activity-row")];

it("shows one sentence and no Undo button while nothing has happened", () => {
  render([]);
  expect(element.textContent).toContain(
    "Nothing has happened yet. Ask AI for something above to start.",
  );
  expect(rows()).toHaveLength(0);
  expect(buttonWithText(element, "Undo")).toBeUndefined();
});

it("titles known operations in plain words and unknown ones with the Host summary", () => {
  render([
    action({ id: "a1", action: "replies.send" }),
    action({ id: "a2", action: "captureRules.delete", summary: "Removed a capture rule" }),
  ]);
  expect(rows().map((row) => row.querySelector(".social-activity-title")?.textContent)).toEqual([
    "Sent a reply",
    "Removed a capture rule",
  ]);
});

it.each<[AiAction["status"], string]>([
  ["done", "Sent"],
  ["failed", "Failed"],
  ["queued", "Needs review"],
  ["blocked", "Cancelled"],
  ["undone", "Cancelled"],
])("shows an action with status %s as the plain word %s", (status, word) => {
  render([action({ status })]);
  expect(rows()[0]?.textContent).toContain(word);
});

it("keeps a failure reason behind Details and the raw id behind Technical details", () => {
  render([action({ id: "act-77", status: "failed", reason: "Rate limited by the platform." })]);
  expect(element.textContent).not.toContain("Rate limited by the platform.");
  expect(element.textContent).not.toContain("act-77");
  act(() => buttonWithText(element, "Details")?.click());
  expect(element.textContent).toContain("Rate limited by the platform.");
  expect(element.textContent).not.toContain("act-77");
  act(() => buttonWithText(element, "Technical details")?.click());
  expect(element.querySelector("code")?.textContent).toBe("act-77");
});

it("undoes the chosen row by its id", () => {
  const onUndo = render([action({ id: "first" }), action({ id: "second" })]);
  const second = rows()[1]!;
  expect(buttonWithText(second, "Undo")?.disabled).toBe(false);
  act(() => buttonWithText(second, "Undo")?.click());
  expect(onUndo).toHaveBeenCalledExactlyOnceWith("second");
});

it("shows no Undo button when the Host recorded no inverse, and says why under Details", () => {
  const onUndo = render([action({ undo: undefined })]);
  expect(buttonWithText(element, "Undo")).toBeUndefined();
  expect(element.textContent).not.toContain("This action cannot be undone.");
  act(() => buttonWithText(element, "Details")?.click());
  expect(element.textContent).toContain("This action cannot be undone.");
  expect(onUndo).not.toHaveBeenCalled();
});

it("does not offer a second undo for an action that was already undone", () => {
  const onUndo = render([action({ status: "undone" })]);
  expect(buttonWithText(element, "Undo")).toBeUndefined();
  act(() => buttonWithText(element, "Details")?.click());
  expect(element.textContent).toContain("Already undone.");
  expect(onUndo).not.toHaveBeenCalled();
});

it("groups the timeline by day under Today and Yesterday labels", () => {
  const now = Date.now();
  render([
    action({ id: "t1", at: now }),
    action({ id: "t2", at: now - 1000 }),
    action({ id: "y1", at: now - 24 * 60 * 60 * 1000 }),
  ]);
  const groups = [...element.querySelectorAll(".command-activity-group")];
  expect(groups.map((group) => group.querySelector("h4")?.textContent)).toEqual([
    "Today",
    "Yesterday",
  ]);
  expect(groups.map((group) => group.querySelectorAll(".social-activity-row").length)).toEqual([
    2, 1,
  ]);
});
