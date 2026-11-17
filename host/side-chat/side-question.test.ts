import { describe, expect, it, vi } from "vitest";
import { SideQuestionParamsSchema } from "../../src/shared/model/host-contracts/side-chat";
import { askSideQuestion } from "./side-question";

const session = (overrides: Record<string, unknown> = {}) =>
  ({
    session: {
      harness: "claude",
      model: "sonnet",
      cwd: "/work/project",
      blocks: [
        { id: "u1", role: "user", text: "Fix the bug", durationMs: 10 },
        { id: "a1", role: "assistant", text: "Fixed it" },
      ],
      ...overrides,
    },
  }) as never;

const params = (history: unknown[] = []) =>
  SideQuestionParamsSchema.parse({ sessionId: "s1", question: "Why?", history });

describe("askSideQuestion", () => {
  it("runs an ephemeral plan-intent prompt that carries snapshot and side thread", async () => {
    const run = vi.fn(async (_request: unknown) => "  Because.  ");
    const authorize = vi.fn(async () => {});
    const result = await askSideQuestion(
      params([
        { role: "user", text: "Earlier?" },
        { role: "assistant", text: "Yes" },
      ]),
      { session: async () => session(), authorize, run: run as never },
    );
    expect(result).toEqual({ answer: "Because." });
    const call = run.mock.calls[0]![0] as {
      prompt: string;
      ephemeral: boolean;
      intent: string;
      cwd: string;
    };
    expect(call).toMatchObject({ ephemeral: true, intent: "plan", cwd: "/work/project" });
    expect(call.prompt).toContain("Fix the bug");
    expect(call.prompt).toContain("User: Earlier?");
    expect(call.prompt).toContain("User: Why?");
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("refuses unsupported agents, missing cwd and empty sessions without starting a run", async () => {
    const run = vi.fn();
    const ports = (overrides: Record<string, unknown>) => ({
      session: async () => session(overrides),
      authorize: async () => {},
      run: run as never,
    });
    await expect(askSideQuestion(params(), ports({ harness: "fx" }))).rejects.toThrow(
      /not available/,
    );
    await expect(askSideQuestion(params(), ports({ cwd: "~" }))).rejects.toThrow(
      /working directory/,
    );
    await expect(askSideQuestion(params(), ports({ blocks: [] }))).rejects.toThrow(/no messages/);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not run when authorization fails or the answer is empty", async () => {
    const run = vi.fn(async () => "  ");
    await expect(
      askSideQuestion(params(), {
        session: async () => session(),
        authorize: async () => {
          throw new Error("revoked");
        },
        run: run as never,
      }),
    ).rejects.toThrow("revoked");
    expect(run).not.toHaveBeenCalled();
    await expect(
      askSideQuestion(params(), {
        session: async () => session(),
        authorize: async () => {},
        run: run as never,
      }),
    ).rejects.toThrow(/no answer/);
  });
});
