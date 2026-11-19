// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearRetainedTemplateDraft, TemplatesSettings } from "./TemplatesSettings";
import { loadPromptTemplates, savePromptTemplates } from "../../sessions/model/promptTemplates";

let container: HTMLDivElement;
let root: Root;
const original = { id: "review", name: "Review", body: "Review the changes." };
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
beforeEach(async () => {
  localStorage.clear();
  clearRetainedTemplateDraft();
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

const statusText = () =>
  [...container.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" ");

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
  expect(statusText()).not.toContain("Could not save templates");
  expect(loadPromptTemplates()[0].name).toBe("Review");
  expect(input.value).toBe("Updated draft");
  write.mockRestore();
  await act(async () => button("Save templates").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(statusText()).toContain("Saved");
  expect(button("Saved")).toBeDefined();
  expect(container.textContent).not.toContain("unsaved change");
  expect(loadPromptTemplates()[0].name).toBe("Updated draft");
});

it("updates a clean editor when templates change elsewhere", async () => {
  await act(async () => savePromptTemplates([{ ...original, name: "Updated elsewhere" }]));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe(
    "Updated elsewhere",
  );
  expect(button("Save templates").disabled).toBe(true);
  expect(container.textContent).not.toContain("unsaved change");
});

it("preserves a dirty draft and blocks stale writes until the user reloads", async () => {
  act(() => button("Add template").click());
  await act(async () => savePromptTemplates([{ ...original, name: "Updated elsewhere" }]));
  expect(container.querySelectorAll('[aria-label="Template name"]')).toHaveLength(1);
  expect(button("New template")).toBeDefined();
  expect(container.textContent).toContain("Templates changed in another window");
  expect(button("Save templates").disabled).toBe(true);
  expect(loadPromptTemplates()[0].name).toBe("Updated elsewhere");
  act(() => button("Discard changes and reload").click());
  expect(container.querySelectorAll('[aria-label="Template name"]')).toHaveLength(1);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe(
    "Updated elsewhere",
  );
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("retains unsaved authoring state when the manager is closed and reopened", async () => {
  const input = container.querySelector<HTMLInputElement>('[aria-label="Template name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Unsaved draft",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(TemplatesSettings)));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Template name"]')?.value).toBe(
    "Unsaved draft",
  );
  expect(loadPromptTemplates()[0].name).toBe("Review");
});

it("refuses to replace corrupt stored templates with an empty library", async () => {
  await act(async () => {
    localStorage.setItem("bycoda.promptTemplates", "{broken");
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.promptTemplates" }));
  });
  expect(container.textContent).toContain("Template storage is unavailable");
  expect(button("Save templates").disabled).toBe(true);
  expect(localStorage.getItem("bycoda.promptTemplates")).toBe("{broken");
});

it("names the failing field and its rule on each failed save, and keeps the draft", async () => {
  await act(async () => savePromptTemplates([{ ...original, trigger: "review" }]));
  act(() => button("Add template").click());
  const field = (label: string) =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  // The error is wired through aria-describedby, the same path assistive technology reads.
  const fieldError = (label: string) =>
    (field(label).getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  const type = async (label: string, value: string) => {
    await act(async () => {
      const node = field(label);
      const proto =
        node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const save = async () => act(async () => button("Save templates").click());

  await save();
  expect(fieldError("Template name")).toBe("Enter a name.");
  expect(field("Template name").getAttribute("aria-invalid")).toBe("true");
  expect(fieldError("Template text")).toBe("");

  await type("Template name", "Second");
  expect(fieldError("Template name")).toBe("");
  await save();
  expect(fieldError("Template text")).toBe("Enter template text.");

  await type("Template text", "Second body");
  await type("Template trigger", "Bad Trigger!");
  await save();
  expect(fieldError("Template trigger")).toBe(
    "Use 1 to 24 letters, numbers or dashes for the trigger.",
  );

  await type("Template trigger", "review");
  await save();
  expect(fieldError("Template trigger")).toBe(
    "This trigger is already used by another template.",
  );
  // Every failed save leaves the draft in place and writes nothing.
  expect(field("Template name").value).toBe("Second");
  expect(field("Template text").value).toBe("Second body");
  expect(loadPromptTemplates()).toHaveLength(1);

  await type("Template trigger", "second");
  await save();
  expect(loadPromptTemplates().map((row) => row.trigger)).toEqual(["review", "second"]);
});

// Regression for #1034: typing in the editor must not re-parse the stored templates JSON per keystroke.
it("does not re-parse the stored templates while the draft is typed", async () => {
  const stored = localStorage.getItem("bycoda.promptTemplates");
  const input = container.querySelector<HTMLInputElement>('[aria-label="Template name"]')!;
  const parse = vi.spyOn(JSON, "parse");
  for (const value of ["R", "Re", "Rev", "Revi"]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  expect(input.value).toBe("Revi");
  expect(parse.mock.calls.filter(([text]) => text === stored)).toHaveLength(0);
});
