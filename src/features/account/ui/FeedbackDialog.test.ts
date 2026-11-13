// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const feedback = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../model/accountApi", () => ({
  accountApi: () => ({ sendAnonymousFeedback: feedback.send }),
  reportAccountFailure: vi.fn(),
}));
vi.mock("../hooks/useAccount", () => ({ useAccountState: () => ({ phase: "signed-out" }) }));
vi.mock("../../diagnostics", () => ({
  getDiagnosticsMode: () => "off",
  diagnosticResultText: () => "",
  sendDiagnosticLogs: vi.fn(),
}));
vi.mock("../../../shared/ui/Modal", () => ({
  Modal: ({ children, footer, onClose }: any) =>
    createElement(
      "section",
      null,
      children,
      footer,
      createElement("button", { onClick: onClose }, "Close dialog"),
    ),
  ModalActions: ({ children }: any) => createElement("div", null, children),
}));
import { FeedbackDialog } from "./FeedbackDialog";
import { openFeedbackDialog, closeFeedbackDialog } from "../model/feedbackDialog";

it("keeps the unsent feedback when its mounted dialog closes and reopens", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(FeedbackDialog));
      openFeedbackDialog();
    });
    const input = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Türkçe taslak 👩🏽‍💻",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => closeFeedbackDialog());
    expect(container.querySelector("textarea")).toBeNull();
    await act(async () => openFeedbackDialog());
    expect(container.querySelector("textarea")!.value).toBe("Türkçe taslak 👩🏽‍💻");
  } finally {
    await act(async () => {
      root.unmount();
      closeFeedbackDialog();
    });
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "keeps feedback receipt and newer draft separate (newer=%s)",
  async (newer) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let complete!: (receipt: { id: string }) => void;
    feedback.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const type = async (text: string) =>
      act(async () => {
        const field = container.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          field,
          text,
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    try {
      await act(async () => {
        root.render(createElement(FeedbackDialog));
        openFeedbackDialog();
      });
      await type("Submitted feedback");
      await act(async () => {
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      if (newer) await type("New unsent feedback");
      await act(async () => complete({ id: "feedback-receipt" }));
      expect(container.textContent).toContain("Reference: feedback-receipt");
      if (newer) expect(container.querySelector("textarea")!.value).toBe("New unsent feedback");
      const close = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Close dialog",
      )!;
      await act(async () => close.click());
      await act(async () => openFeedbackDialog());
      expect(container.querySelector("textarea")!.value).toBe(newer ? "New unsent feedback" : "");
    } finally {
      await act(async () => {
        root.unmount();
        closeFeedbackDialog();
      });
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
