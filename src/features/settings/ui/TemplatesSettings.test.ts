// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

it("retains saved data and the draft on storage failure, then reports successful retry", async () => {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Template name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Updated draft",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const write = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await act(async () => button("Save templates").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save templates",
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Could not save templates",
  );
  expect(loadPromptTemplates()[0].name).toBe("Review");
  expect(input.value).toBe("Updated draft");
  write.mockRestore();
  await act(async () => button("Save templates").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Saved");
  expect(loadPromptTemplates()[0].name).toBe("Updated draft");
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
