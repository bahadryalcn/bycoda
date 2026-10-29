// @vitest-environment happy-dom
import { focusManager } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGithubPrChecks, type GithubPrChecksView } from "./useGithubPrChecks";
import type { GithubPrChecks } from "../model/githubPrChecks";
import { withQueryClient } from "../../../../tests/browser/queryTest";

const { fetchGithubPrChecks } = vi.hoisted(() => ({
  fetchGithubPrChecks: vi.fn(),
}));
vi.mock("../model/githubPrChecks", () => ({ fetchGithubPrChecks }));

type Params = Parameters<typeof useGithubPrChecks>[0];

let view: GithubPrChecksView | undefined;
function Consumer(props: Params) {
  view = useGithubPrChecks(props);
  return null;
}
const Wrapped = withQueryClient(Consumer);

const base: Params = {
  cwd: "/tmp/web",
  repo: "acme/web",
  number: 7,
  enabled: true,
  open: true,
  revision: 0,
};

function checks(headOid: string, states: string[] = []): GithubPrChecks {
  return {
    headOid,
    checks: states.map((state, index) => ({
      name: `${state}-${index}`,
      workflow: "CI",
      state: state as GithubPrChecks["checks"][number]["state"],
      url: null,
      startedAt: null,
      completedAt: null,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  fetchGithubPrChecks.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (props: Params) =>
  act(async () => root.render(createElement(Wrapped, { ...props })));
const rerender = render;
const flush = () => act(async () => {});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The query client follows the focus manager for hidden-document ticks and visibility refreshes. */
function setHidden(value: boolean) {
  focusManager.setFocused(!value);
}
const show = () => act(async () => setHidden(false));

it("loads once on mount for open PRs whatever the revision is", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a", ["pass"]));
  await render(base);
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  expect(fetchGithubPrChecks).toHaveBeenCalledWith("/tmp/web", "acme/web", 7);
  expect(view?.loading).toBe(false);
  expect(view?.checks?.headOid).toBe("a");
  expect(view?.stale).toBe(false);
  expect(view?.error).toBeNull();
});

it("keeps initial loading distinct from an answered no-checks state", async () => {
  const pending = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(pending.promise);
  await render(base);
  expect(view?.loading).toBe(true);
  expect(view?.checks).toBeNull();

  await act(async () => {
    pending.resolve({ headOid: "a", checks: [] });
  });
  await flush();
  expect(view?.loading).toBe(false);
  expect(view?.refreshing).toBe(false);
  expect(view?.checks?.headOid).toBe("a");
  expect(view?.checks?.checks).toEqual([]);
});

it("polls every 30 seconds for open PRs", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await render(base);
  await flush();
  await advance(29_999);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await advance(1);
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
});

it("pauses polling for a hidden PR panel and refreshes when shown", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await render({ ...base, poll: false });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await advance(90_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await rerender({ ...base, poll: true });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  await rerender({ ...base, poll: false });
  await advance(60_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
});

it("skips hidden ticks and refreshes when the document becomes visible again", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await render(base);
  await flush();
  setHidden(true);
  await advance(90_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await show();
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
});

it("loads closed PRs only on mount and on manual refresh", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await render({ ...base, open: false });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  setHidden(true);
  await advance(90_000);
  await show();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await act(async () => {
    view?.refresh();
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
});

it("keeps previous results after a failed refresh but marks them stale", async () => {
  fetchGithubPrChecks.mockResolvedValueOnce(checks("a", ["pass"]));
  await render(base);
  await flush();
  fetchGithubPrChecks.mockRejectedValueOnce(new Error("network down"));
  await advance(30_000);
  await flush();
  expect(view?.stale).toBe(true);
  expect(view?.error).toBe("network down");
  expect(view?.checks?.headOid).toBe("a");
  fetchGithubPrChecks.mockResolvedValueOnce(checks("b", ["fail"]));
  await advance(30_000);
  await flush();
  expect(view?.stale).toBe(false);
  expect(view?.error).toBeNull();
  expect(view?.checks?.headOid).toBe("b");
});

it("drops a late answer after the PR changed and replaces with the new headOid", async () => {
  const first = deferred<GithubPrChecks>();
  const second = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(first.promise);
  fetchGithubPrChecks.mockReturnValueOnce(second.promise);
  await render(base);
  await rerender({ ...base, number: 8 });
  expect(fetchGithubPrChecks).toHaveBeenNthCalledWith(2, "/tmp/web", "acme/web", 8);
  await act(async () => {
    first.resolve(checks("old", ["fail"]));
  });
  expect(view?.checks).toBeNull();
  await act(async () => {
    second.resolve(checks("new", ["pass"]));
  });
  expect(view?.checks?.headOid).toBe("new");
  expect(view?.checks?.checks.map((entry) => entry.state)).toEqual(["pass"]);
});

it("starts a replacement read for a revision that lands mid-flight and ignores the older answer", async () => {
  const first = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(first.promise);
  await render(base);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  fetchGithubPrChecks.mockResolvedValue(checks("rev2"));
  await rerender({ ...base, revision: 1 });
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  await flush();
  expect(view?.checks?.headOid).toBe("rev2");
  await act(async () => {
    first.resolve(checks("rev1"));
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  expect(view?.checks?.headOid).toBe("rev2");
  expect(view?.loading).toBe(false);
  expect(view?.refreshing).toBe(false);
  expect(view?.stale).toBe(false);
});

it("keeps the previous head on screen as stale when its revision replacement fails", async () => {
  fetchGithubPrChecks.mockResolvedValueOnce(checks("a", ["pass"]));
  await render(base);
  await flush();
  const replacement = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(replacement.promise);
  await rerender({ ...base, revision: 1 });
  expect(view?.checks?.headOid).toBe("a");
  expect(view?.stale).toBe(true);
  expect(view?.refreshing).toBe(true);
  expect(view?.error).toBeNull();
  await act(async () => {
    replacement.reject(new Error("rate limited"));
  });
  await flush();
  expect(view?.checks?.headOid).toBe("a");
  expect(view?.stale).toBe(true);
  expect(view?.refreshing).toBe(false);
  expect(view?.error).toBe("rate limited");
});

it("joins repeated manual refreshes into the running request and retries on demand", async () => {
  const first = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(first.promise);
  await render(base);
  await act(async () => {
    view?.refresh();
    view?.refresh();
  });
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await act(async () => {
    first.reject(new Error("offline"));
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  expect(view?.error).toBe("offline");
  expect(view?.checks).toBeNull();
  expect(view?.loading).toBe(false);
  fetchGithubPrChecks.mockResolvedValue(checks("b"));
  await act(async () => {
    view?.refresh();
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  expect(view?.checks?.headOid).toBe("b");
  expect(view?.error).toBeNull();
  expect(view?.stale).toBe(false);
});

it("does not start another read when a poll tick joins a request and the document is hidden afterwards", async () => {
  setHidden(false);
  const pending = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(pending.promise);
  await render(base);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  // The tick lands mid-flight and joins the running request.
  await advance(30_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  setHidden(true);
  await act(async () => {
    pending.resolve(checks("a"));
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  // Becoming visible picks the polling back up.
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await show();
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  expect(view?.checks?.headOid).toBe("a");
});

it("does not poll after the PR closes, manual refresh still works", async () => {
  setHidden(false);
  const pending = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValueOnce(pending.promise);
  await render(base);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  await advance(30_000);
  await rerender({ ...base, open: false });
  await act(async () => {
    pending.resolve(checks("a"));
  });
  await flush();
  await advance(90_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(1);
  fetchGithubPrChecks.mockResolvedValue(checks("b"));
  await act(async () => {
    view?.refresh();
  });
  await flush();
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  expect(view?.checks?.headOid).toBe("b");
});

it("reports nothing and never reads while disabled", async () => {
  fetchGithubPrChecks.mockResolvedValue(checks("a"));
  await render({ ...base, enabled: false });
  await act(async () => {
    view?.refresh();
  });
  await advance(90_000);
  expect(fetchGithubPrChecks).not.toHaveBeenCalled();
  expect(view).toMatchObject({
    checks: null,
    loading: false,
    refreshing: false,
    error: null,
    stale: false,
  });
});

it("never lets requests overlap and starts nothing after unmount", async () => {
  let active = 0;
  let maxActive = 0;
  fetchGithubPrChecks.mockImplementation(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return checks("a");
  });
  await render(base);
  await act(async () => {
    view?.refresh();
  });
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(2);
  expect(maxActive).toBe(1);

  const pending = deferred<GithubPrChecks>();
  fetchGithubPrChecks.mockReturnValue(pending.promise);
  await advance(30_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(3);
  await act(async () => {
    view?.refresh();
  });
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(3);
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    pending.resolve(checks("late"));
  });
  await flush();
  await advance(90_000);
  expect(fetchGithubPrChecks).toHaveBeenCalledTimes(3);
  expect(maxActive).toBe(1);
});
