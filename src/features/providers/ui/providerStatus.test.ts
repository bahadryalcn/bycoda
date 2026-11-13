// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { idleRateLimits, unavailableRateLimits, errorRateLimits } from "../model/rateLimits";
import {
  clearCachedRateLimits,
  loadRateLimits,
  setCachedRateLimits,
} from "../model/rateLimitsCache";
import { grokSignInState, providerAuthState, useGrokSignInState } from "./providerStatus";

vi.mock("../model/rateLimitsCache", async (importOriginal) => {
  const cache = await importOriginal<typeof import("../model/rateLimitsCache")>();
  return { ...cache, loadRateLimits: vi.fn(async () => cache.getCachedRateLimits("grok")) };
});

it("derives Grok sign-in from the cached authenticated usage result", () => {
  expect(grokSignInState(undefined)).toEqual({ tone: "checking", label: "Checking…" });
  for (const status of ["idle", "fetching"] as const) {
    expect(grokSignInState({ ...idleRateLimits("grok"), status }).tone).toBe("checking");
  }
  const signedIn = { ...idleRateLimits("grok"), status: "ok" as const };
  expect(grokSignInState(signedIn)).toEqual({ tone: "ready", label: "Signed in" });
  expect(providerAuthState(signedIn, 0)).toEqual({ tone: "ready", label: "Signed in" });
  expect(grokSignInState(unavailableRateLimits("grok", "no cached token"))).toEqual({
    tone: "signedOut",
    label: "Signed out",
  });
});

it("does not treat a failed usage request as signed out or signed in", () => {
  expect(grokSignInState(errorRateLimits("grok", "Request timed out"))).toEqual({
    tone: "unknown",
    label: "Not checked",
  });
  expect(providerAuthState(idleRateLimits("claude"), 0)).toBeNull();
});

it("probes only enabled Grok surfaces, subscribes to the default cache and rechecks after sign-in", async () => {
  vi.mocked(loadRateLimits).mockClear();
  const node = document.createElement("div");
  const root = createRoot(node);
  function Status({ enabled, completed = false }: { enabled: boolean; completed?: boolean }) {
    return createElement("span", null, useGrokSignInState(enabled, completed).label);
  }
  try {
    await act(async () => root.render(createElement(Status, { enabled: false })));
    expect(loadRateLimits).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(Status, { enabled: true })));
    expect(loadRateLimits).toHaveBeenLastCalledWith("grok", "default", false);
    await act(async () =>
      setCachedRateLimits("grok", "default", { ...idleRateLimits("grok"), status: "ok" }),
    );
    expect(node.textContent).toBe("Signed in");
    await act(async () => root.render(createElement(Status, { enabled: true, completed: true })));
    expect(loadRateLimits).toHaveBeenLastCalledWith("grok", "default", true);
  } finally {
    await act(async () => root.unmount());
    clearCachedRateLimits("grok");
  }
});
