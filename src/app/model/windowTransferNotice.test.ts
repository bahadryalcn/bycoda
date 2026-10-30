// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelledTransferMessage,
  dismissWindowTransferNotice,
  getWindowTransferNotice,
  publishWindowTransferNotice,
  queuedTransferMessage,
  rejectedTransferMessage,
  restoredSplitMessage,
  subscribeWindowTransferNotice,
  transferFailureReason,
} from "./windowTransferNotice";

afterEach(() => {
  dismissWindowTransferNotice();
  document.querySelector("[data-drag-announcer]")?.remove();
});

describe("window transfer notice store", () => {
  it("publishes one notice, notifies subscribers and announces the sentence", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWindowTransferNotice(listener);
    publishWindowTransferNotice("info", queuedTransferMessage());
    expect(listener).toHaveBeenCalledOnce();
    expect(getWindowTransferNotice()).toMatchObject({
      tone: "info",
      message: "This tab moves to a new window when the response finishes.",
    });
    // Announced once by the rendered notice's live role, not a second announcer.
    expect(document.querySelector("[data-drag-announcer]")?.textContent ?? "").toBe("");
    unsubscribe();
    publishWindowTransferNotice("info", cancelledTransferMessage());
    expect(listener).toHaveBeenCalledOnce();
  });

  it("gives an identical repeated notice a new id so it restarts", () => {
    publishWindowTransferNotice("info", restoredSplitMessage());
    const first = getWindowTransferNotice()?.id;
    publishWindowTransferNotice("info", restoredSplitMessage());
    expect(getWindowTransferNotice()?.id).not.toBe(first);
  });

  it("dismisses once and ignores a second dismissal", () => {
    const listener = vi.fn();
    publishWindowTransferNotice("danger", "x");
    const unsubscribe = subscribeWindowTransferNotice(listener);
    dismissWindowTransferNotice();
    dismissWindowTransferNotice();
    expect(getWindowTransferNotice()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("strips Error prefixes for display only", () => {
    expect(transferFailureReason(new Error("Panel is busy"))).toBe("Panel is busy");
    expect(transferFailureReason("Error: Panel is busy")).toBe("Panel is busy");
    expect(transferFailureReason("TypeError: Error: nope")).toBe("nope");
    expect(rejectedTransferMessage("Error: This panel is not ready")).toBe(
      "The tab could not be placed in this window. This panel is not ready. It stays in its original window.",
    );
    expect(rejectedTransferMessage("Error: Already done.")).toContain("Already done. It stays");
    expect(rejectedTransferMessage("")).toBe(
      "The tab could not be placed in this window. It stays in its original window.",
    );
  });
});
