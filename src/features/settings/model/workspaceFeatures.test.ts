// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceFeatureGate } from "../ui/WorkspaceFeatureGate";
import { WORKSPACE_FEATURE_IDS, workspaceFeatureSettings } from "./workspaceFeatures";

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
  localStorage.clear();
});

it("preserves existing navigation by default and changes only the selected feature", () => {
  for (const id of WORKSPACE_FEATURE_IDS) expect(workspaceFeatureSettings[id].load()).toBe(true);
  workspaceFeatureSettings.tasks.save(false);
  expect(workspaceFeatureSettings.tasks.load()).toBe(false);
  expect(workspaceFeatureSettings.automations.load()).toBe(true);
  expect(workspaceFeatureSettings.inbox.load()).toBe(true);
  workspaceFeatureSettings.notes.save(false);
  expect(localStorage.getItem("bycoda.notesEnabled")).toBe("0");
});

it("updates navigation immediately and keeps an active hidden tool reachable", async () => {
  const render = async (active = false) =>
    act(async () =>
      root.render(createElement(WorkspaceFeatureGate, { id: "tasks", active }, "Tasks")),
    );
  await render();
  expect(container.textContent).toBe("Tasks");
  await act(async () => workspaceFeatureSettings.tasks.save(false));
  expect(container.textContent).toBe("");
  await render(true);
  expect(container.textContent).toBe("Tasks");
  await render(false);
  expect(container.textContent).toBe("");
  await act(async () => workspaceFeatureSettings.tasks.save(true));
  expect(container.textContent).toBe("Tasks");
});

it("observes navigation changes from another window", async () => {
  await act(async () => root.render(createElement(WorkspaceFeatureGate, { id: "inbox" }, "Inbox")));
  await act(async () => {
    const key = "bycoda.workspace.inbox.visible.v1";
    localStorage.setItem(key, "0");
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: "0" }));
  });
  expect(container.textContent).toBe("");
});
