// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useGithubPrChecks, type GithubPrChecksView } from "./useGithubPrChecks";
import type { GithubPrChecks } from "../model/githubPrChecks";

const { fetchGithubPrChecks } = vi.hoisted(() => ({
  fetchGithubPrChecks: vi.fn(),
}));
vi.mock("../model/githubPrChecks", () => ({ fetchGithubPrChecks }));
const check = (headOid: string): GithubPrChecks => ({ headOid, checks: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let view: GithubPrChecksView;
function Consumer({ revision }: { revision: number }) {
  view = useGithubPrChecks({
    cwd: "/work",
    repo: "a/b",
    number: 1,
    enabled: true,
    open: false,
    revision,
  });
  return null;
}
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  fetchGithubPrChecks.mockReset();
  vi.unstubAllGlobals();
});

it.each(["resolve", "reject"] as const)(
  "ignores an earlier revision's %s while its replacement is pending",
  async (outcome) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    fetchGithubPrChecks.mockResolvedValueOnce(check("initial"));
    await act(async () => root.render(createElement(Consumer, { revision: 0 })));
    const old = deferred<GithubPrChecks>();
    const replacement = deferred<GithubPrChecks>();
    fetchGithubPrChecks.mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    await act(async () => view.refresh());
    await act(async () => root.render(createElement(Consumer, { revision: 1 })));
    expect(view.stale).toBe(true);
    await act(async () => {
      if (outcome === "resolve") old.resolve(check("obsolete"));
      else old.reject(new Error("old error"));
    });
    expect(view.checks?.headOid).toBe("initial");
    expect(view.error).toBeNull();
    expect(view.stale).toBe(true);
    expect(view.refreshing).toBe(true);
    await act(async () => replacement.resolve(check("current")));
    expect(view.checks?.headOid).toBe("current");
    expect(view.stale).toBe(false);
  },
);
