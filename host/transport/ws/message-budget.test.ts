import { describe, expect, it } from "vitest";
import { NATIVE_BUFFER_UPLOAD_LIMITS } from "../../../src/shared/model/host-contracts/native-buffer-upload";
import { PeerMessageBudget, WS_MESSAGE_BUDGET } from "./message-budget";

const MAX_FRAME = 1_048_576;

describe("PeerMessageBudget", () => {
  it("accepts a burst up to the message allowance and refuses the next message", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    for (let index = 0; index < WS_MESSAGE_BUDGET.messageBurst; index += 1) {
      expect(budget.admit(1, 0)).toBe("accept");
    }
    expect(budget.admit(1, 0)).toBe("drop");
  });

  it("keeps legitimate sustained traffic under the refill rate without refusals", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    // One message every 20 ms is 50 per second, half the sustained allowance.
    for (let at = 0; at <= 2_000; at += 20) {
      expect(budget.admit(512, at)).toBe("accept");
    }
  });

  it("refills message allowance over time after a burst is spent", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    for (let index = 0; index < WS_MESSAGE_BUDGET.messageBurst; index += 1) budget.admit(1, 0);
    expect(budget.admit(1, 0)).toBe("drop");
    // One second later the sustained rate has restored exactly one second of messages.
    for (let index = 0; index < WS_MESSAGE_BUDGET.messagesPerSecond; index += 1) {
      expect(budget.admit(1, 1_000)).toBe("accept");
    }
    expect(budget.admit(1, 1_000)).toBe("drop");
  });

  it("charges bytes, so large frames exhaust the byte allowance before the message count", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    const framesInByteBurst = WS_MESSAGE_BUDGET.byteBurst / MAX_FRAME;
    for (let index = 0; index < framesInByteBurst; index += 1) {
      expect(budget.admit(MAX_FRAME, 0)).toBe("accept");
    }
    expect(budget.admit(MAX_FRAME, 0)).toBe("drop");
  });

  it("admits a maximum-size native upload without depending on budget refills", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    const { maxBytes, chunkBytes } = NATIVE_BUFFER_UPLOAD_LIMITS;
    expect(budget.admit(1024, 0)).toBe("accept"); // Negotiation and begin.
    for (let offset = 0; offset < maxBytes; offset += chunkBytes) {
      const base64Bytes = 4 * Math.ceil(Math.min(chunkBytes, maxBytes - offset) / 3);
      expect(budget.admit(base64Bytes + 1024, 0)).toBe("accept");
    }
    expect(budget.admit(1024, 0)).toBe("accept"); // Commit.
  });

  it("closes the connection after a sustained run of refused messages", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    for (let index = 0; index < WS_MESSAGE_BUDGET.messageBurst; index += 1) budget.admit(1, 0);
    for (let index = 1; index < WS_MESSAGE_BUDGET.maxConsecutiveDrops; index += 1) {
      expect(budget.admit(1, 0)).toBe("drop");
    }
    expect(budget.admit(1, 0)).toBe("close");
  });

  it("resets the drop run when an accepted message follows refusals", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 0);
    for (let index = 0; index < WS_MESSAGE_BUDGET.messageBurst; index += 1) budget.admit(1, 0);
    for (let index = 1; index < WS_MESSAGE_BUDGET.maxConsecutiveDrops; index += 1) {
      expect(budget.admit(1, 0)).toBe("drop");
    }
    // A refill accepts a message and clears the run: the next refusal is the first of a fresh count.
    expect(budget.admit(1, 1_000)).toBe("accept");
    for (let index = 1; index < WS_MESSAGE_BUDGET.messagesPerSecond; index += 1) {
      expect(budget.admit(1, 1_000)).toBe("accept");
    }
    expect(budget.admit(1, 1_000)).toBe("drop");
  });

  it("treats a clock that moves backwards as no elapsed time", () => {
    const budget = new PeerMessageBudget(WS_MESSAGE_BUDGET, 5_000);
    for (let index = 0; index < WS_MESSAGE_BUDGET.messageBurst; index += 1) budget.admit(1, 5_000);
    expect(budget.admit(1, 1_000)).toBe("drop");
  });
});
