// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  renameProviderAccount,
  saveTerminalProviderAccount,
} from "../../providers/model/providerAccounts";
import { SessionAgentIdentity } from "./SessionAgentIdentity";

it("updates the account label without a parent render", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  saveTerminalProviderAccount({ provider: "claude", id: "r2t3-account", label: "Before" });
  try {
    act(() =>
      root.render(
        createElement(SessionAgentIdentity, {
          harness: "claude",
          model: "claude:opus-5",
          accountId: "r2t3-account",
          running: false,
          showAccount: true,
        }),
      ),
    );
    expect(container.textContent).toContain("Before");
    act(() => renameProviderAccount("claude", "r2t3-account", "After"));
    expect(container.textContent).toContain("After");
    expect(container.textContent).not.toContain("Before");
  } finally {
    act(() => root.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
