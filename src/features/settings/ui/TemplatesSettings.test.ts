// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TemplatesSettings } from "./TemplatesSettings";
import { loadPromptTemplates, savePromptTemplates } from "../../sessions/model/promptTemplates";

let container: HTMLDivElement;
let root: Root;
const original = { id: "review", name: "Review", body: "Review the changes." };
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
beforeEach(async () => {
  localStorage.clear();
  savePromptTemplates([original]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(TemplatesSettings)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("updates a clean editor when templates change elsewhere", async () => {
  await act(async () => savePromptTemplates([{ ...original, name: "Updated elsewhere" }]));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe(
    "Updated elsewhere",
  );
  expect(button("Save templates").disabled).toBe(true);
  expect(container.textContent).not.toContain("Unsaved changes");
});

it("preserves a dirty draft and blocks stale writes until the user reloads", async () => {
  act(() => button("Add template").click());
  await act(async () => savePromptTemplates([{ ...original, name: "Updated elsewhere" }]));
  expect(container.querySelectorAll('[aria-label="Template name"]')).toHaveLength(2);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Templates changed in another window",
  );
  expect(button("Save templates").disabled).toBe(true);
  expect(loadPromptTemplates()[0].name).toBe("Updated elsewhere");
  act(() => button("Discard changes and reload").click());
  expect(container.querySelectorAll('[aria-label="Template name"]')).toHaveLength(1);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe(
    "Updated elsewhere",
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
