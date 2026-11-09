import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import { sessionWorkedMs } from "./sessionActivity";

const block = (fields: Partial<Block>): Block =>
  ({ id: "b", role: "user", text: "", ...fields }) as Block;

describe("sessionWorkedMs", () => {
  it("sums finished submitted turns only", () => {
    const blocks = [
      block({ startedAt: 1, durationMs: 60_000 }),
      block({ startedAt: 2, durationMs: 30_000, continuationOf: undefined }),
      block({ startedAt: 3, durationMs: 9_000, draft: true }),
      block({ role: "assistant", durationMs: 5_000 }),
      block({ startedAt: 4, durationMs: -10 }),
      block({ startedAt: 5, durationMs: Number.NaN }),
      block({ startedAt: 6 }),
    ];
    expect(sessionWorkedMs({ blocks })).toBe(90_000);
  });
});
