// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  loginHarness: vi.fn<(_harness: string, _accountId?: string) => Promise<void>>(),
}));

vi.mock("../../../integrations/harness/core/auth", () => ({
  loginHarness: auth.loginHarness,
}));

import { ProviderSignInDialog } from "./ProviderSignInDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  auth.loginHarness.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}

describe("ProviderSignInDialog", () => {
  it("girişi oturumda seçilen hesapla başlatır", async () => {
    auth.loginHarness.mockResolvedValue();
    act(() =>
      root.render(
        createElement(ProviderSignInDialog, {
          harness: "claude",
          accountId: "account-work",
          onClose: vi.fn(),
        }),
      ),
    );
    await act(async () => button("Sign in to Claude Code").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("claude", "account-work");
  });
  it("reports successful onboarding sign-in with setup-specific guidance", async () => {
    const signedIn = vi.fn();
    auth.loginHarness.mockResolvedValue();
    act(() =>
      root.render(
        createElement(ProviderSignInDialog, {
          harness: "codex",
          onClose: vi.fn(),
          onSignedIn: signedIn,
          completeDescription: "Continue setting up your projects.",
        }),
      ),
    );
    await act(async () => button("Sign in to Codex").click());
    expect(signedIn).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Continue setting up your projects.",
    );
  });

  it("does not mark an agent signed in when login fails", async () => {
    const signedIn = vi.fn();
    auth.loginHarness.mockRejectedValue(new Error("Login cancelled"));
    act(() =>
      root.render(
        createElement(ProviderSignInDialog, {
          harness: "codex",
          onClose: vi.fn(),
          onSignedIn: signedIn,
        }),
      ),
    );
    await act(async () => button("Sign in to Codex").click());
    expect(signedIn).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Login cancelled");
  });
  it("launches provider login and offers a clear continuation state", async () => {
    const close = vi.fn();
    auth.loginHarness.mockResolvedValue();
    act(() =>
      root.render(
        createElement(ProviderSignInDialog, {
          harness: "grok",
          onClose: close,
        }),
      ),
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Authentication required");
    expect(dialog?.textContent).toContain("Sign in to Grok Build");
    expect(dialog?.querySelector(".size-9")).not.toBeNull();

    await act(async () => button("Sign in to Grok Build").click());
    expect(auth.loginHarness).toHaveBeenCalledWith("grok", undefined);
    expect(dialog?.textContent).toContain("Signed in to Grok Build");

    act(() => button("Continue").click());
    expect(close).toHaveBeenCalledOnce();
  });
});
