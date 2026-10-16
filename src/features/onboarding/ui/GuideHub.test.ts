// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GuideHub from "./GuideHub";
import { GUIDE_ACTION_EVENT, guideActionBlocker, loadSeenGuideTopics } from "../model/guide";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(projectCwd: string, onClose = vi.fn()) {
  await act(async () =>
    root.render(createElement(GuideHub, { projectCwd, onClose, onStartTour: vi.fn() })),
  );
  return onClose;
}
function button(label: string) {
  const match = Array.from(document.body.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}

it("reveals a topic's surface through the shared action request and closes", async () => {
  const actions: string[] = [];
  const listener = (event: Event) => actions.push((event as CustomEvent<string>).detail);
  window.addEventListener(GUIDE_ACTION_EVENT, listener);
  try {
    const onClose = await render("/Users/me/code/app");
    await act(async () => button("Tasks & goals").click());
    await act(async () => button("Open Tasks").click());
    expect(actions).toEqual(["tasks"]);
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener(GUIDE_ACTION_EVENT, listener);
  }
});

it("explains project-only topics instead of offering a silent no-op", async () => {
  await render("~");
  await act(async () => button("Changes & Git").click());
  expect(button("Open Changes").disabled).toBe(true);
  expect(document.body.textContent).toContain("Open a project first.");
  await act(async () => button("Terminal").click());
  expect(button("Open the terminal").disabled).toBe(false);
});

it("records viewed topics across openings", async () => {
  await render("~");
  await act(async () => button("Notes").click());
  expect(loadSeenGuideTopics()).toEqual(["projects", "notes"]);
});

it("mirrors the openers' gates", () => {
  const local = { cwd: "/Users/me/code/app", notesEnabled: true };
  const remote = { cwd: "remote://mac/Users/me/app", notesEnabled: false };
  expect(guideActionBlocker("files", local)).toBeNull();
  expect(guideActionBlocker("files", remote)).toBeNull();
  expect(guideActionBlocker("terminal", remote)).toBe("local-project");
  expect(guideActionBlocker("inbox", remote)).toBeNull();
  expect(guideActionBlocker("inbox", { ...local, cwd: "~" })).toBe("project");
  expect(guideActionBlocker("notes", remote)).toBe("notes-disabled");
  expect(guideActionBlocker("open-project", { ...local, cwd: "" })).toBeNull();
});
