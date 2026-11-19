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

describe("askSideQuestion concurrency", () => {
  const deferred = () => {
    let resolve!: (answer: string) => void;
    const promise = new Promise<string>((done) => (resolve = done));
    return { promise, resolve };
  };
  const paramsFor = (sessionId: string) =>
    SideQuestionParamsSchema.parse({ sessionId, question: "Why?", history: [] });
  const flush = () => new Promise((done) => setTimeout(done, 0));
  // Each session gets its own cwd, so the mock run can be gated per session.
  const sessionPorts = (run: unknown) => ({
    session: async (id: string) => session({ cwd: `/work/${id}` }),
    authorize: async () => {},
    run: run as never,
  });

  it("refuses a second question for the same session while the first is running", async () => {
    const gate = deferred();
    const run = vi.fn(async (_request: unknown) => gate.promise);
    const ports = sessionPorts(run);
    const first = askSideQuestion(paramsFor("a"), ports);
    await flush();
    await expect(askSideQuestion(paramsFor("a"), ports)).rejects.toThrow(/already running/);
    expect(run).toHaveBeenCalledOnce();
    gate.resolve("Done.");
    await expect(first).resolves.toEqual({ answer: "Done." });
  });

  it("runs at most the Host limit at once and starts queued questions as slots free", async () => {
    const gates = new Map(["/work/a", "/work/b", "/work/c"].map((cwd) => [cwd, deferred()]));
    const run = vi.fn(async (request: { cwd: string }) => gates.get(request.cwd)!.promise);
    const ports = sessionPorts(run);
    const questions = ["a", "b", "c"].map((id) => askSideQuestion(paramsFor(id), ports));
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    gates.get("/work/a")!.resolve("A");
    await expect(questions[0]).resolves.toEqual({ answer: "A" });
    await flush();
    expect(run).toHaveBeenCalledTimes(3);
    gates.get("/work/b")!.resolve("B");
    gates.get("/work/c")!.resolve("C");
    await expect(Promise.all(questions.slice(1))).resolves.toEqual([
      { answer: "B" },
      { answer: "C" },
    ]);
  });

  it("cancels a queued question without starting a provider run", async () => {
    const gates = new Map(["/work/a", "/work/b"].map((cwd) => [cwd, deferred()]));
    const run = vi.fn(async (request: { cwd: string }) => gates.get(request.cwd)!.promise);
    const ports = sessionPorts(run);
    const first = askSideQuestion(paramsFor("a"), ports);
    const second = askSideQuestion(paramsFor("b"), ports);
    const controller = new AbortController();
    const queued = askSideQuestion(paramsFor("c"), ports, controller.signal);
    await flush();
    controller.abort();
    await expect(queued).rejects.toThrow(/cancelled/);
    expect(run).toHaveBeenCalledTimes(2);
    gates.get("/work/a")!.resolve("A");
    gates.get("/work/b")!.resolve("B");
    await expect(Promise.all([first, second])).resolves.toEqual([{ answer: "A" }, { answer: "B" }]);
  });

  it("releases the session and Host slot when a question fails", async () => {
    const run = vi.fn(async () => "Ok.");
    const failing = {
      session: async () => session(),
      authorize: async () => {
        throw new Error("revoked");
      },
      run: run as never,
    };
    await expect(askSideQuestion(paramsFor("a"), failing)).rejects.toThrow("revoked");
    const ports = sessionPorts(run);
    await expect(askSideQuestion(paramsFor("a"), ports)).resolves.toEqual({ answer: "Ok." });
    expect(run).toHaveBeenCalledOnce();
  });
});
