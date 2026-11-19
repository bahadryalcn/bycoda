// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { forgetVoiceNote } from "../model/voiceMemory";
import { VoiceMemoryDialog } from "./VoiceMemoryDialog";

vi.mock("../model/voiceMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/voiceMemory")>()),
  useVoiceMemory: () => ({
    enabled: true,
    notes: [
      { id: "n1", text: "Short answers", at: 1 },
      { id: "n2", text: "Morning tea", at: 2 },
    ],
  }),
  forgetVoiceNote: vi.fn(),
}));

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(VoiceMemoryDialog, { onClose: vi.fn() })));
}

it("names each forget button after the note it removes", async () => {
  await render();
  const names = [...document.querySelectorAll<HTMLButtonElement>('ul[aria-label] button')].map(
    (button) => button.getAttribute("aria-label"),
  );
  expect(names).toEqual(["Forget note: Morning tea", "Forget note: Short answers"]);
});

it("forgets only the note whose button was pressed", async () => {
  await render();
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Forget note: Short answers"]',
  );
  await act(async () => button!.click());
  expect(forgetVoiceNote).toHaveBeenCalledWith("n1");
});
