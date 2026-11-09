import { describe, expect, it, vi } from "vitest";
import { handlePullRequestsRpc } from "./rpc-pull-requests";

function setup(projectId = "p1") {
  const watch = vi.fn(async () => ({
    watchId: "w1",
    number: 12,
    url: "https://github.com/a/b/pull/12",
    state: "OPEN",
  }));
  const unwatch = vi.fn(async () => true);
  const list = vi.fn(async () => [{ watchId: "w1" }]);
  const dependencies = {
    pullRequestWatch: { watch, unwatch, list },
    engine: { store: { session: async () => ({ projectId }) } },
  };
  const run = async (method: string, params: Record<string, unknown>) => {
    const request = { input: { method }, params, result: undefined as unknown };
    await handlePullRequestsRpc(dependencies as never, request as never);
    return request.result;
  };
  return { run, watch, unwatch, list };
}

describe("pullRequests RPC", () => {
  it("links by url or number through the watch service", async () => {
    const s = setup();
    expect(
      await s.run("pullRequests.link", { projectId: "p1", sessionId: "s1", number: 12 }),
    ).toMatchObject({ number: 12, state: "OPEN" });
    expect(s.watch).toHaveBeenCalledWith({ sessionId: "s1", projectId: "p1" }, { number: 12 });
    await s.run("pullRequests.link", {
      projectId: "p1",
      sessionId: "s1",
      url: "https://github.com/a/b/pull/12",
    });
    expect(s.watch).toHaveBeenLastCalledWith(
      { sessionId: "s1", projectId: "p1" },
      { url: "https://github.com/a/b/pull/12" },
    );
  });

  it("rejects bad input before touching the service", async () => {
    const s = setup();
    await expect(
      s.run("pullRequests.link", {
        projectId: "p1",
        sessionId: "s1",
        url: "https://example.com/x",
      }),
    ).rejects.toThrow(/github/);
    await expect(
      s.run("pullRequests.link", { projectId: "p1", sessionId: "s1", number: 0 }),
    ).rejects.toThrow(/positive/);
    await expect(
      s.run("pullRequests.unlink", { projectId: "p1", sessionId: "s1" }),
    ).rejects.toThrow(/watchId/);
    expect(s.watch).not.toHaveBeenCalled();
  });

  it("refuses a session of another project", async () => {
    const s = setup("other");
    await expect(
      s.run("pullRequests.linked", { projectId: "p1", sessionId: "s1" }),
    ).rejects.toThrow(/another project/);
  });

  it("unlinks and lists", async () => {
    const s = setup();
    expect(
      await s.run("pullRequests.unlink", { projectId: "p1", sessionId: "s1", watchId: "w1" }),
    ).toEqual({ removed: true });
    expect(await s.run("pullRequests.linked", { projectId: "p1", sessionId: "s1" })).toEqual({
      watches: [{ watchId: "w1" }],
    });
  });
});
