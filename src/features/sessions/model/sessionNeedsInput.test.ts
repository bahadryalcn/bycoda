import { describe, expect, it, vi } from "vitest";
import { hasPendingApproval, sessionNeedsInput } from "./session";
import type { Block, Session } from "./session";

function block(id: string, approval?: { decided: boolean }): Block {
  return { id, role: "assistant", text: id, approval } as unknown as Block;
}

function uncached(blocks: Block[]): boolean {
  return blocks.some((b) => b.approval && !b.approval.decided);
}

describe("hasPendingApproval memo", () => {
  const cases: Block[][] = [
    [],
    [block("a")],
    [block("a", { decided: true })],
    [block("a", { decided: false })],
    [block("a"), block("b", { decided: true }), block("c", { decided: false })],
    [block("a", { decided: true }), block("b", { decided: true })],
  ];

  it("matches the uncached predicate, on first and repeated calls", () => {
    for (const blocks of cases) {
      expect(hasPendingApproval(blocks)).toBe(uncached(blocks));
      expect(hasPendingApproval(blocks)).toBe(uncached(blocks));
    }
  });

  it("reuses the answer for the same array without rescanning", () => {
    const blocks = [block("a"), block("b", { decided: false })];
    const some = vi.spyOn(blocks, "some");
    expect(hasPendingApproval(blocks)).toBe(true);
    expect(hasPendingApproval(blocks)).toBe(true);
    expect(some).toHaveBeenCalledTimes(1);
  });

  it("recomputes for a new array even with equal contents of a changed block", () => {
    const first = [block("a", { decided: false })];
    expect(hasPendingApproval(first)).toBe(true);
    const second = [block("a", { decided: true })];
    expect(hasPendingApproval(second)).toBe(false);
    expect(hasPendingApproval(first)).toBe(true);
  });
});

describe("sessionNeedsInput", () => {
  const base = { worktreeRemoved: false } as unknown as Session;

  it("follows approvals, questions and removed worktrees", () => {
    const pending = [block("a", { decided: false })];
    const done = [block("a", { decided: true })];
    expect(sessionNeedsInput({ ...base, blocks: pending })).toBe(true);
    expect(sessionNeedsInput({ ...base, blocks: done })).toBe(false);
    expect(
      sessionNeedsInput({
        ...base,
        blocks: done,
        pendingQuestion: { requestId: 1, questions: [] },
      } as Session),
    ).toBe(true);
    expect(sessionNeedsInput({ ...base, blocks: pending, worktreeRemoved: true })).toBe(false);
  });
});
