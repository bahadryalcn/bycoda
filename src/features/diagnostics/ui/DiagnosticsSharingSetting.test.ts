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
function typeNote(text: string) {
  const field = container.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each([false, true])(
  "retires only the submitted unchanged note after upload, newer edit: %s",
  async (newer) => {
    let complete!: (status: string) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => root.render(createElement(DiagnosticsSharingSetting)));
    typeNote("Original problem");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Send logs now")!
        .click();
    });
    expect(send).toHaveBeenCalledWith({ trigger: "manual", note: "Original problem" });
    if (newer) typeNote("New unsent problem");
    await act(async () => complete("sent"));
    expect(container.querySelector("input")!.value).toBe(newer ? "New unsent problem" : "");
  },
);
