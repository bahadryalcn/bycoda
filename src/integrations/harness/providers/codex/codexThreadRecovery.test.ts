import { describe, expect, it, vi } from "vitest";
import { CodexArchivedThreadError, resumeCodexThread } from "./codexThreadRecovery";
import type { JsonRpcWriterView } from "../turnWriter";

describe("Codex thread recovery", () => {
  const params = { threadId: "abc", excludeTurns: true };
  const run = (request: ReturnType<typeof vi.fn>) =>
    resumeCodexThread(
      { request } as unknown as Pick<JsonRpcWriterView, "request">,
      "abc",
      params,
      1000,
    );

  it("restores the exact archived thread and resumes before dispatch", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("session abc is archived. Run `codex unarchive abc` to unarchive it first."),
      )
      .mockResolvedValueOnce({ thread: { id: "abc" } })
      .mockResolvedValueOnce({ thread: { id: "abc" } });
    await expect(run(request)).resolves.toEqual({ thread: { id: "abc" } });
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "thread/resume",
      "thread/unarchive",
      "thread/resume",
    ]);
    expect(request.mock.calls[1][1]).toEqual({ threadId: "abc" });
  });

  it("does not restore another identity or treat missing history as archived", async () => {
    for (const message of [
      "session other is archived. Run codex unarchive other.",
      "Thread abc not found",
      "authentication failed",
    ]) {
      const request = vi.fn().mockRejectedValue(new Error(message));
      await expect(run(request)).rejects.toThrow(message);
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("stops on uncertain restore and mismatched identity without retrying", async () => {
    for (const outcome of [
      new Error("timeout"),
      new Error("method not found"),
      new Error("permission denied"),
      { thread: { id: "other" } },
    ]) {
      const request = vi
        .fn()
        .mockRejectedValueOnce(new Error("session abc is archived. Run codex unarchive abc."));
      if (outcome instanceof Error) request.mockRejectedValueOnce(outcome);
      else request.mockResolvedValueOnce(outcome);
      await expect(run(request)).rejects.toBeInstanceOf(CodexArchivedThreadError);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.some((call) => call[0] === "turn/start")).toBe(false);
    }
  });

  it("rejects an invalid resumed identity", async () => {
    const request = vi.fn().mockResolvedValue({ thread: { id: "other" } });
    await expect(run(request)).rejects.toThrow("different or missing thread identity");
  });
});
