// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TerminalProfileDiscovery } from "./TerminalProfileDiscovery";
import { providerAccounts } from "../../providers/model/providerAccounts";
import {
  defaultProviderAccountId,
  setDefaultProviderAccount,
} from "../../providers/model/providerAccounts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(TerminalProfileDiscovery, {
        provider: "claude",
        disabled: false,
      }),
    ),
  );
  await click("Terminal account profiles");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("discovers profiles without connecting or logging in, then connects the selected path", async () => {
  const profile = {
    id: "terminal-work",
    provider: "claude",
    label: "claude-f",
    path: "C:\\Users\\example\\.claude-f",
  };
  vi.mocked(invoke).mockResolvedValueOnce([profile]);
  await click("Find terminal profiles");
  expect(providerAccounts("claude")).toHaveLength(1);
  expect(document.body.textContent).toContain(profile.path);
  vi.mocked(invoke).mockResolvedValueOnce(profile);
  await click("Connect");
  expect(invoke).toHaveBeenLastCalledWith("provider_terminal_profile_connect", {
    provider: "claude",
    path: profile.path,
  });
  expect(providerAccounts("claude").map((account) => account.id)).toContain(profile.id);
  expect(document.body.textContent).toContain("Connected");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("automatically finds profiles for setup and uses an explicitly chosen account", async () => {
  const profile = {
    id: "terminal-other",
    provider: "claude" as const,
    label: "Other",
    path: "D:/profiles/claude",
  };
  vi.mocked(invoke).mockResolvedValueOnce([profile]);
  const onConnected = vi.fn((account) => setDefaultProviderAccount(account.provider, account.id));
  await act(async () =>
    root.render(
      createElement(TerminalProfileDiscovery, {
        provider: "claude",
        disabled: false,
        autoDiscover: true,
        onConnected,
      }),
    ),
  );
  expect(invoke).toHaveBeenLastCalledWith("provider_terminal_profiles", { provider: "claude" });
  expect(onConnected).not.toHaveBeenCalled();
  expect(defaultProviderAccountId("claude")).toBe("default");
  expect(document.body.textContent).toContain(profile.path);
  vi.mocked(invoke).mockResolvedValueOnce(profile);
  await click("Use account");
  expect(onConnected).toHaveBeenCalledWith(profile);
  expect(defaultProviderAccountId("claude")).toBe(profile.id);
});

it("shows discovery failures and allows retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Profile directory unavailable"));
  await click("Find terminal profiles");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Profile directory unavailable",
  );
  vi.mocked(invoke).mockResolvedValueOnce([]);
  await click("Find terminal profiles");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("No terminal profiles found");
});

it("closes on provider changes and ignores a late discovery error from the previous provider", async () => {
  let rejectOld!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  await click("Find terminal profiles");
  await act(async () =>
    root.render(createElement(TerminalProfileDiscovery, { provider: "codex", disabled: false })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("Terminal account profiles");
  await act(async () => rejectOld(new Error("Old provider error")));
  expect(document.body.textContent).not.toContain("Old provider error");
});

it("does not save a connection receipt after its provider was changed", async () => {
  const profile = {
    id: "terminal-race",
    provider: "claude" as const,
    label: "Work",
    path: "C:/fixture/.claude",
  };
  vi.mocked(invoke).mockResolvedValueOnce([profile]);
  await click("Find terminal profiles");
  let resolveConnect!: (value: typeof profile) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
  );
  await click("Connect");
  await act(async () =>
    root.render(createElement(TerminalProfileDiscovery, { provider: "codex", disabled: false })),
  );
  await act(async () => resolveConnect(profile));
  expect(providerAccounts("claude").map((account) => account.id)).not.toContain(profile.id);
  expect(providerAccounts("codex").map((account) => account.id)).not.toContain(profile.id);
});
