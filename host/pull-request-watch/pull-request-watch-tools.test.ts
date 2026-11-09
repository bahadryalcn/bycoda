import { describe, expect, it, vi } from "vitest";
import type { RuntimeLogPrincipal } from "../execution/runtime-log-tools";
import {
  describePullRequestWatchTool,
  isPullRequestWatchTool,
  parsePullRequestWatchInput,
  PULL_REQUEST_WATCH_TOOLS,
  PullRequestWatchTools,
} from "./pull-request-watch-tools";

const principal: RuntimeLogPrincipal = {
  projectId: "project",
  sessionId: "caller",
  provider: "codex",
  kind: "session" as const,
};

function setup() {
  const watches = {
    watch: vi.fn(async () => ({
      watchId: "w1",
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      state: "OPEN",
    })),
    unwatch: vi.fn(async () => true),
    list: vi.fn(async () => [{ watchId: "w1", number: 12, url: "u", state: "OPEN" }]),
  };
  const tools = new PullRequestWatchTools(watches);
  const call = (
    action: Parameters<PullRequestWatchTools["call"]>[0],
    input: Record<string, unknown> = {},
    authorized = () => true,
  ) => tools.call(action, input, principal, authorized);
  return { watches, call };
}

describe("pull request watch tool input", () => {
  it("accepts a number, a github pull request URL, or neither", () => {
    expect(parsePullRequestWatchInput({})).toEqual({});
    expect(parsePullRequestWatchInput({ number: 12 })).toEqual({ number: 12 });
    expect(
      parsePullRequestWatchInput({ url: "https://github.com/acme/app/pull/12", number: 12 }),
    ).toEqual({ url: "https://github.com/acme/app/pull/12", number: 12 });
  });

  it("rejects numbers that are not positive integers", () => {
    for (const number of [0, -1, 1.5, "12", 1_000_000_000])
      expect(() => parsePullRequestWatchInput({ number })).toThrow("number must be");
  });

  it("rejects URLs that are not github pull request links or are too long", () => {
    expect(() => parsePullRequestWatchInput({ url: "https://example.com/pull/1" })).toThrow(
      "github.com pull request link",
    );
    expect(() => parsePullRequestWatchInput({ url: "" })).toThrow("at most 500");
    expect(() =>
      parsePullRequestWatchInput({ url: `https://github.com/a/b/pull/1${"x".repeat(500)}` }),
    ).toThrow("at most 500");
  });

  it("rejects a number that disagrees with the URL", () => {
    expect(() =>
      parsePullRequestWatchInput({ url: "https://github.com/acme/app/pull/12", number: 13 }),
    ).toThrow("does not match");
  });
});

describe("pull request watch tools", () => {
  it("routes the three actions and recognises only its own names", () => {
    expect(Object.keys(PULL_REQUEST_WATCH_TOOLS)).toEqual([
      "pullRequests.watch",
      "pullRequests.unwatch",
      "pullRequests.watches",
    ]);
    expect(isPullRequestWatchTool("pullRequests.watch")).toBe(true);
    expect(isPullRequestWatchTool("goals.create")).toBe(false);
    expect(describePullRequestWatchTool("pullRequests.unwatch")).toContain("removed=false");
    expect(describePullRequestWatchTool("goals.create")).toBeUndefined();
  });

  it("watches under the calling session and project", async () => {
    const { watches, call } = setup();
    const result = await call("pullRequests.watch", { number: 12 });
    expect(watches.watch).toHaveBeenCalledWith(
      { sessionId: "caller", projectId: "project" },
      { number: 12 },
    );
    expect(result).toMatchObject({ watchId: "w1", number: 12 });
  });

  it("unwatches only by the caller's session and validates the watch ID", async () => {
    const { watches, call } = setup();
    expect(await call("pullRequests.unwatch", { watchId: "w1" })).toEqual({ removed: true });
    expect(watches.unwatch).toHaveBeenCalledWith("caller", "w1");
    await expect(call("pullRequests.unwatch", { watchId: "../x" })).rejects.toThrow("watchId");
    await expect(call("pullRequests.unwatch", {})).rejects.toThrow("watchId");
  });

  it("lists the caller's watches", async () => {
    const { watches, call } = setup();
    const result = await call("pullRequests.watches");
    expect(watches.list).toHaveBeenCalledWith("caller");
    expect(result).toEqual({
      watches: [{ watchId: "w1", number: 12, url: "u", state: "OPEN" }],
    });
  });

  it("refuses every action once the session authority is revoked", async () => {
    const { watches, call } = setup();
    const revoked = () => false;
    await expect(call("pullRequests.watch", {}, revoked)).rejects.toThrow("authority revoked");
    await expect(call("pullRequests.unwatch", { watchId: "w1" }, revoked)).rejects.toThrow(
      "authority revoked",
    );
    expect(watches.watch).not.toHaveBeenCalled();
    expect(watches.unwatch).not.toHaveBeenCalled();
  });
});
