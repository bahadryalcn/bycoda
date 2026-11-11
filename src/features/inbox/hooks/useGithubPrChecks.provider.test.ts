// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useGithubPrChecks, type GithubPrChecksView } from "./useGithubPrChecks";
import type { GithubPrChecks } from "../model/githubPrChecks";
import { withQueryClient } from "../../../../tests/browser/support/queryTest";
const { fetchPrChecks } = vi.hoisted(() => ({ fetchPrChecks: vi.fn() }));
vi.mock("../model/prChecks", () => ({ fetchPrChecks }));
let view!: GithubPrChecksView;
function Consumer() {
  const current = useGithubPrChecks({
    provider: "gitlab",
    cwd: "",
    repo: "g/r",
    number: 1,
    enabled: true,
    open: false,
  });
  useLayoutEffect(() => {
    view = current;
  });
  return null;
}
const Wrapped = withQueryClient(Consumer);
it("drops the old instance response on account change and reloads checks for closed MRs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveOld!: (value: GithubPrChecks) => void;
  fetchPrChecks
    .mockReturnValueOnce(
      new Promise<GithubPrChecks>((resolve) => {
        resolveOld = resolve;
      }),
    )
    .mockResolvedValueOnce({
      headOid: "new",
      checks: [],
      provider: "gitlab",
      instance: "https://new.example",
    });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Wrapped)));
    await act(async () => {
      window.dispatchEvent(new Event("bycoda:gitlab-change"));
    });
    expect(view.checks?.instance).toBe("https://new.example");
    await act(async () =>
      resolveOld({
        headOid: "old",
        checks: [],
        instance: "https://old.example",
      }),
    );
    expect(view.checks?.headOid).toBe("new");
    expect(fetchPrChecks).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
