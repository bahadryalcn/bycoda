// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceWorkDraft } from "./VoiceWorkDraft";

const { copyText } = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}) }));
vi.mock("../../../../platform/tauri/clipboard", () => ({ copyText }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copyText.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
}

it("preserves owner edits across evidence changes and adds the new evidence only on request", async () => {
  function Harness({ source }: { source: "first" | "next" }) {
    const [draft, onDraftChange] = useState("Owner notes");
    const evidence =
      source === "first"
        ? { title: "Earlier check", status: "Completed", output: "Previous output" }
        : { title: "Build package", status: "Failed", output: "Output line 1\nOutput line 2" };
    return createElement(VoiceWorkDraft, { draft, onDraftChange, evidence });
  }
  await act(async () => root.render(createElement(Harness, { source: "first" })));
  const field = container.querySelector("textarea")!;
  expect(field.value).toBe("Owner notes");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(field, "Owner notes\nNeeds another pass.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.render(createElement(Harness, { source: "next" })));
  expect(field.value).toBe("Owner notes\nNeeds another pass.");
  expect(copyText).not.toHaveBeenCalled();

  expect(button("Insert")).toBeDefined();
  await act(async () => button("Insert")?.click());
  const appended =
    "Owner notes\nNeeds another pass.\n\nBuild package\nStatus · Failed\n\nOutput\nOutput line 1\nOutput line 2";
  expect(field.value).toBe(appended);
  expect(copyText).not.toHaveBeenCalled();
  await act(async () => button("Copy")?.click());
  expect(copyText).toHaveBeenCalledExactlyOnceWith(appended);
});

it("keeps an empty draft editable without offering evidence insertion or copying", async () => {
  const onDraftChange = vi.fn();
  await act(async () => root.render(createElement(VoiceWorkDraft, { draft: "", onDraftChange })));
  expect(container.querySelector("textarea")?.disabled).toBe(false);
  expect(button("Insert")).toBeUndefined();
  expect(button("Copy")?.disabled).toBe(true);
  expect(onDraftChange).not.toHaveBeenCalled();
});
