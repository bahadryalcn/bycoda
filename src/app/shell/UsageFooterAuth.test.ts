// @vitest-environment happy-dom
import { withQueryClient } from "../../../tests/browser/queryTest";
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { focusManager } from "@tanstack/react-query";
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string) => Promise<void>>(),
}));
const rateLimitsFetch = vi.hoisted(() => ({
  consumeCodexRateLimitResetCredit: vi.fn(),
  fetchClaudeRateLimits: vi.fn(),
  fetchCodexRateLimits: vi.fn(),
}));

vi.mock("../../integrations/harness/core/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../integrations/harness/core/auth")>()),
  loginHarness: auth.loginHarness,
}));
vi.mock("../../features/providers/model/rateLimitsFetch", () => rateLimitsFetch);

import type {
  ProviderRateLimits,
  RateLimitProvider,
} from "../../features/providers/model/rateLimits";
import {
  clearCachedRateLimits,
  setCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";
import { UsageFooter as QueryComponent } from "./UsageFooter";
import {
  defaultProviderAccountId,
  removeProviderAccount,
  renameProviderAccount,
  saveProviderAccount,
} from "../../features/providers/model/providerAccounts";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  auth.loginHarness.mockReset();
  rateLimitsFetch.consumeCodexRateLimitResetCredit.mockReset();
  rateLimitsFetch.fetchClaudeRateLimits.mockReset();
  rateLimitsFetch.fetchCodexRateLimits.mockReset();
  clearCachedRateLimits();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

function signedOutLimits(provider: RateLimitProvider): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: Date.now(),
    error: `${provider} is not signed in`,
    status: "error",
  };
}

function connectedLimits(provider: RateLimitProvider): ProviderRateLimits {
  return {
    ...signedOutLimits(provider),
    error: null,
    status: "ok",
  };
}

describe("UsageFooter provider authentication", () => {
  it("persists the displayed account without changing session pins or defaults, refreshes it, and falls back after removal", async () => {
    renameProviderAccount("claude", "default", "personal");
    saveProviderAccount({ provider: "claude", id: "account-work", label: "work" });
    renameProviderAccount("codex", "default", "codex-personal");
    saveProviderAccount({ provider: "codex", id: "account-work", label: "codex-work" });
    rateLimitsFetch.fetchClaudeRateLimits.mockImplementation(async (accountId) => ({
      ...connectedLimits("claude"),
      weekly: {
        usedPercent: accountId === "account-work" ? 13 : 81,
        resetsAt: null,
        windowMinutes: 10080,
      },
    }));
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue({
      ...connectedLimits("codex"),
      weekly: { usedPercent: 40, resetsAt: null, windowMinutes: 10080 },
    });
    const onSelectAccount = vi.fn();
    const session = { harness: "claude" as const, providerAccountId: "default" };
    const props = {
      providers: ["claude", "codex"] as RateLimitProvider[],
      session,
      onSelectAccount,
    };
    await act(async () => root.render(createElement(UsageFooter, props)));
    await act(async () => button("Claude Code usage details").click());
    await act(async () => button("work").click());
    expect(button("Claude Code usage details").textContent).toContain("work");
    expect(button("Claude Code usage details").textContent).toContain("87%");
    expect(button("Codex usage details").textContent).toContain("codex-personal");
    expect(button("work").getAttribute("aria-pressed")).toBe("true");
    expect(defaultProviderAccountId("claude")).toBe("default");
    expect(session.providerAccountId).toBe("default");
    expect(onSelectAccount).not.toHaveBeenCalled();
    await act(async () => button("Claude Code usage details").click());
    await act(async () => button("Refresh usage").click());
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenLastCalledWith("account-work", false);
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(UsageFooter, props)));
    expect(button("Claude Code usage details").textContent).toContain("work");
    await act(async () => removeProviderAccount("claude", "account-work"));
    expect(button("Claude Code usage details").textContent).not.toContain("work");
    expect(button("Claude Code usage details").textContent).toContain("19%");
    await act(async () => button("Refresh usage").click());
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenLastCalledWith("default", false);
  });

  it("keeps the selected account label visible when usage is unavailable", async () => {
    renameProviderAccount("claude", "default", "personal");
    saveProviderAccount({ provider: "claude", id: "account-work", label: "work" });
    rateLimitsFetch.fetchClaudeRateLimits.mockResolvedValue(signedOutLimits("claude"));
    await act(async () => root.render(createElement(UsageFooter, { providers: ["claude"] })));
    await act(async () => button("Claude Code usage details").click());
    await act(async () => button("work").click());
    expect(button("Claude Code usage details").textContent).toContain("work");
    await act(async () => button("Sign in to Claude Code").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("claude", "account-work");
  });

  it("reuses usage on remount and supports manual Refresh", async () => {
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(connectedLimits("codex"));
    await act(async () => root.render(createElement(UsageFooter, { providers: ["codex"] })));
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(UsageFooter, { providers: ["codex"] })));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

    await act(async () => button("Refresh usage").click());
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
  });

  it("refreshes displayed providers every two minutes and stops on unmount", async () => {
    vi.useFakeTimers();
    rateLimitsFetch.fetchClaudeRateLimits.mockResolvedValue(connectedLimits("claude"));
    rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(connectedLimits("codex"));
    await act(async () =>
      root.render(createElement(UsageFooter, { providers: ["claude", "codex"] })),
    );

    await act(async () => vi.advanceTimersByTimeAsync(119_999));
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(1);
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(2);
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);

    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(3);
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(rateLimitsFetch.fetchClaudeRateLimits).toHaveBeenCalledTimes(3);
    expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(3);
  });

  it("keeps a healthy Grok provider label non-interactive", () => {
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: false,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).not.toContain("sign in");
    expect(container.querySelector("button")).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens Grok sign-in from its footer provider popover", async () => {
    let finishLogin: (() => void) | undefined;
    auth.loginHarness.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    act(() =>
      root.render(
        createElement(UsageFooter, {
          providers: [],
          session: {
            id: "grok-session",
            harness: "grok",
            authRequired: true,
          },
        }),
      ),
    );

    expect(container.textContent).toContain("grok");
    expect(container.textContent).toContain("sign in");
    act(() => button("Grok Build sign-in required").click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Authentication required");
    expect(dialog?.querySelector(".size-9")).not.toBeNull();

    act(() => button("Sign in to Grok Build").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("grok", undefined);
    expect(dialog?.textContent).toContain("Waiting for browser…");

    await act(async () => finishLogin?.());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("sign in");
  });

  it("starts a waiting recovery after another provider login fails", async () => {
    let rejectClaude: ((error: Error) => void) | undefined;
    auth.loginHarness.mockImplementation((harness) => {
      if (harness === "claude") {
        return new Promise<void>((_resolve, reject) => {
          rejectClaude = reject;
        });
      }
      return Promise.resolve();
    });
    rateLimitsFetch.fetchClaudeRateLimits.mockResolvedValue(signedOutLimits("claude"));
    rateLimitsFetch.fetchCodexRateLimits
      .mockResolvedValueOnce(signedOutLimits("codex"))
      .mockResolvedValueOnce(connectedLimits("codex"));

    await act(async () => {
      root.render(
        createElement(UsageFooter, {
          providers: ["claude", "codex"],
        }),
      );
    });

    act(() => button("Claude Code usage details").click());
    act(() => button("Sign in to Claude Code").click());
    await vi.waitFor(() => expect(auth.loginHarness).toHaveBeenCalledWith("claude"));

    act(() => button("Codex usage details").click());
    act(() => button("Sign in to Codex").click());
    expect(auth.loginHarness).not.toHaveBeenCalledWith("codex");

    await act(async () => rejectClaude?.(new Error("Claude login failed")));
    await vi.waitFor(() => expect(auth.loginHarness).toHaveBeenCalledWith("codex"));
  });
});

const UsageFooter = withQueryClient(QueryComponent);

it("pauses usage polls and cache retries while hidden, then force refreshes on focus", async () => {
  vi.useFakeTimers();
  rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(signedOutLimits("codex"));
  await act(async () => root.render(createElement(UsageFooter, { providers: ["codex"] })));
  await act(async () => focusManager.setFocused(false));
  await act(async () => vi.advanceTimersByTimeAsync(360_000));
  expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(1);
  rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(connectedLimits("codex"));
  await act(async () => focusManager.setFocused(true));
  expect(rateLimitsFetch.fetchCodexRateLimits).toHaveBeenCalledTimes(2);
});

it("does not commit a usage render for an equal host cache payload", async () => {
  vi.useFakeTimers();
  const value = connectedLimits("codex");
  rateLimitsFetch.fetchCodexRateLimits.mockResolvedValue(value);
  const onRender = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        Profiler,
        { id: "usage", onRender },
        createElement(UsageFooter, { providers: ["codex"] }),
      ),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(10));
  onRender.mockClear();
  await act(async () => {
    setCachedRateLimits("codex", "default", { ...value });
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(onRender).not.toHaveBeenCalled();
});
