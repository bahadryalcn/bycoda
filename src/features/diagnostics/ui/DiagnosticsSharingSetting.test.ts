// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiagnosticsSharingSetting } from "./DiagnosticsSharingSetting";

const send = vi.hoisted(() => vi.fn());
vi.mock("../model/diagnosticsService", () => ({ sendDiagnosticLogs: send }));
vi.mock("../model/diagnosticsConsent", () => ({
  getDiagnosticsMode: () => "ask",
  subscribeDiagnosticsConsent: () => () => undefined,
  setDiagnosticsMode: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  send.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const press = async (label: string) =>
  act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click();
  });
function typeNote(text: string) {
  const field = document.body.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("asks for the note in a dialog and sends it with the manual trigger", async () => {
  send.mockResolvedValueOnce("sent");
  await act(async () => root.render(createElement(DiagnosticsSharingSetting)));
  expect(container.querySelector("input")).toBeNull();
  await press("Send logs now");
  typeNote("Original problem");
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .filter((button) => button.textContent === "Send")
      .at(-1)!
      .click();
  });
  expect(send).toHaveBeenCalledWith({ trigger: "manual", note: "Original problem" });
});
