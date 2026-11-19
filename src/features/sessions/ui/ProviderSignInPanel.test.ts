// @vitest-environment happy-dom
// Keep this as .ts because the project test glob intentionally excludes .test.tsx.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const opener = vi.hoisted(() => ({
  openExternal: vi.fn<(url: string | URL) => Promise<void>>(),
}));

vi.mock("../../../platform/tauri/openExternal", () => ({
  openExternal: opener.openExternal,
  isExternalUrl: () => true,
}));

import {
  clearSignInInstructions,
  offerSignInInstructionLine,
  signInInstructionsKey,
} from "../../../integrations/harness/core/authInstructions";
import { ProviderSignInPanel, type ProviderSignInState } from "./ProviderSignInPanel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opener.openExternal.mockReset().mockResolvedValue();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearSignInInstructions(signInInstructionsKey("codex"));
  clearSignInInstructions(signInInstructionsKey("codex", "account-work"));
  vi.unstubAllGlobals();
});

function render(state: ProviderSignInState, accountId?: string) {
  act(() =>
    root.render(
      createElement(ProviderSignInPanel, {
        harness: "codex",
        accountId,
        state,
        error: null,
        onSignIn: vi.fn(),
      }),
    ),
  );
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent) === text,
  );
}

describe("ProviderSignInPanel browser fallback", () => {
  it("shows the printed code and link with open and copy actions while signing in", () => {
    render("running");
    expect(container.textContent).not.toContain("ABCD-EFGH");
    act(() => {
      offerSignInInstructionLine(signInInstructionsKey("codex"), "Enter code ABCD-EFGH");
      offerSignInInstructionLine(
        signInInstructionsKey("codex"),
        "Open https://auth.example.com/device",
      );
    });
    expect(container.textContent).toContain("ABCD-EFGH");
    expect(buttonWithText("Copy code")).toBeDefined();
    expect(buttonWithText("Copy link")).toBeDefined();
    act(() => buttonWithText("Open sign-in link")?.click());
    expect(opener.openExternal).toHaveBeenCalledExactlyOnceWith("https://auth.example.com/device");
  });

  it("shows nothing outside a running sign-in", () => {
    act(() => offerSignInInstructionLine(signInInstructionsKey("codex"), "Enter code ABCD-EFGH"));
    for (const state of ["idle", "error", "complete"] as const) {
      render(state);
      expect(container.textContent, state).not.toContain("ABCD-EFGH");
      expect(buttonWithText("Open sign-in link"), state).toBeUndefined();
    }
  });

  it("shows only the instructions of the account the panel belongs to", () => {
    act(() =>
      offerSignInInstructionLine(
        signInInstructionsKey("codex", "account-work"),
        "Enter code WORK-CODE1",
      ),
    );
    render("running");
    expect(container.textContent).not.toContain("WORK-CODE1");
    render("running", "account-work");
    expect(container.textContent).toContain("WORK-CODE1");
  });
});
