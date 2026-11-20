/**
 * Per-connection inbound budget. Every application message is charged before it is parsed,
 * so flooding invalid frames costs one counter update instead of JSON/Zod work and error replies.
 * Pong, close and ping frames never reach the message handler and are not charged.
 */
export const WS_MESSAGE_BUDGET = Object.freeze({
  messagesPerSecond: 100,
  messageBurst: 300,
  bytesPerSecond: 4_194_304,
  // A 16 MiB native upload takes over 21 MiB once split into base64 JSON frames.
  // Allow one full upload burst while keeping the sustained byte rate bounded.
  byteBurst: 24 * 1024 * 1024,
  // Consecutive refused messages before the connection is closed with 1008.
  maxConsecutiveDrops: 100,
});

export type MessageBudgetVerdict = "accept" | "drop" | "close";

export class PeerMessageBudget {
  private messages: number;
  private bytes: number;
  private lastAt: number;
  private drops = 0;

  constructor(
    private readonly limits: typeof WS_MESSAGE_BUDGET,
    now: number,
  ) {
    this.messages = limits.messageBurst;
    this.bytes = limits.byteBurst;
    this.lastAt = now;
  }

  /** Charges one message of `size` bytes at monotonic time `now` (ms). */
  admit(size: number, now: number): MessageBudgetVerdict {
    const elapsed = Math.max(0, now - this.lastAt);
    this.lastAt = now;
    this.messages = Math.min(
      this.limits.messageBurst,
      this.messages + (elapsed * this.limits.messagesPerSecond) / 1000,
    );
    this.bytes = Math.min(
      this.limits.byteBurst,
      this.bytes + (elapsed * this.limits.bytesPerSecond) / 1000,
    );
    if (this.messages >= 1 && this.bytes >= size) {
      this.messages -= 1;
      this.bytes -= size;
      this.drops = 0;
      return "accept";
    }
    this.drops += 1;
    return this.drops >= this.limits.maxConsecutiveDrops ? "close" : "drop";
  }
}
