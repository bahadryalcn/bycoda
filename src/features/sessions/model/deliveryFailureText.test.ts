import { describe, expect, it } from "vitest";
import { deliveryFailureSentence } from "./deliveryFailureText";

const t = (message: string) => message;

describe("deliveryFailureSentence", () => {
  it("names a full local store instead of showing the storage exception", () => {
    const raw =
      "QuotaExceededError: Failed to execute 'setItem' on 'Storage': Setting the value of 'bycoda:shared-queue:v2:[…]' exceeded the quota.";
    expect(deliveryFailureSentence(raw, t)).toBe(
      "This device's local storage is full, so the queue could not be saved.",
    );
  });

  it("names a dropped Host connection instead of showing the RPC code", () => {
    const raw =
      "RPC_WS_INTERRUPTED: Host connection ended before the result was known. The operation outcome is unknown; reconcile its command receipt before retrying.";
    expect(deliveryFailureSentence(raw, t)).toBe(
      "The connection to the Host dropped before the result was known. The queue checks again automatically.",
    );
  });

  it("keeps a plain sentence the queue wrote itself", () => {
    const raw =
      "The send was cancelled or rejected. The message remains queued and the queue is paused.";
    expect(deliveryFailureSentence(raw, t)).toBe(raw);
  });

  it("does not claim a message was unsent when the Host could not confirm the result", () => {
    const raw =
      "RPC_WS_REMOTE: The Host operation could not be confirmed. Refresh its state before retrying. The operation outcome is unknown; reconcile its command receipt before retrying.";
    expect(deliveryFailureSentence(raw, t)).toBe("Delivery unconfirmed");
  });

  it("leads with the readable first line of a multi-line reason", () => {
    expect(deliveryFailureSentence("Provider crashed: exit 1\nNative output", t)).toBe(
      "Provider crashed: exit 1",
    );
  });

  it("hides other technical failures behind the details", () => {
    for (const raw of [
      "TypeError: Cannot read properties of undefined",
      "HOST_UNAVAILABLE: no answer",
      "Error: boom\n    at stack frame",
    ])
      expect(deliveryFailureSentence(raw, t)).toBe(
        "The message was not sent. The technical reason is in the details.",
      );
  });
});
