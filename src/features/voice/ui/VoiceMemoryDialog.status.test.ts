// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MEMORY_LIMITS } from "../model/voiceMemory";
import { VoiceMemoryDialog } from "./VoiceMemoryDialog";

const state = vi.hoisted(() => ({
  memory: { enabled: true, notes: [] as { id: string; text: string; at: number }[] },
}));

vi.mock("../model/voiceMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/voiceMemory")>()),
  useVoiceMemory: () => state.memory,
}));

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(VoiceMemoryDialog, { onClose: vi.fn() })));
}

const addButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((button) =>
    button.textContent?.includes("Add"),
  )!;

it("shows the note count and warns, with Add disabled, when the list is full", async () => {
  state.memory = {
    enabled: true,
    notes: Array.from({ length: MEMORY_LIMITS.notes }, (_, index) => ({
      id: `n${index}`,
      text: `note ${index}`,
      at: index,
    })),
  };
  await render();
  expect(document.body.textContent).toContain(`${MEMORY_LIMITS.notes} / ${MEMORY_LIMITS.notes}`);
  expect(document.body.textContent).toContain("Memory is full. Forget a note to make room.");
  expect(addButton().disabled).toBe(true);
});

it("says why the form is disabled when memory is turned off", async () => {
  state.memory = { enabled: false, notes: [] };
  await render();
  expect(document.body.textContent).toContain("Memory is turned off in Settings.");
  expect(document.querySelector<HTMLInputElement>("input")?.disabled).toBe(true);
  expect(addButton().disabled).toBe(true);
});
