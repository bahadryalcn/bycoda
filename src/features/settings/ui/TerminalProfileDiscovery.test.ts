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

it("keeps long profile identity and path readable without hover or a focus-only tooltip", async () => {
  const profile = {
    id: "terminal-research",
    provider: "claude",
    label: "Aleksandra Wiśniewska-Kowalczyk · Araştırma 🧑🏽‍💻",
    path: "C:\\Users\\Aleksandra.Wisniewska-Kowalczyk\\AppData\\Local\\Northwind Industries Holdings\\research-and-development\\claude-work-profile",
  };
  vi.mocked(invoke).mockResolvedValueOnce([profile]);
  await click("Find terminal profiles");
  for (const value of [profile.label, profile.path]) {
    const text = [...document.querySelectorAll("p")].find(
      (element) => element.textContent === value,
    )!;
    expect(text).toBeDefined();
    expect(text.getAttribute("data-wrap")).toBe("anywhere");
    expect(text.getAttribute("data-truncate")).toBeNull();
  }
});

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
    root.render(
      createElement(TerminalProfileDiscovery, { key: "codex", provider: "codex", disabled: false }),
    ),
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
  expect(document.querySelectorAll('button[aria-busy="true"]')).toHaveLength(1);
  expect(document.querySelector('button[aria-busy="true"]')?.textContent).toBe("Connect");
  await click("Connect");
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () =>
    root.render(
      createElement(TerminalProfileDiscovery, { key: "codex", provider: "codex", disabled: false }),
    ),
  );
  await act(async () => resolveConnect(profile));
  expect(providerAccounts("claude").map((account) => account.id)).not.toContain(profile.id);
  expect(providerAccounts("codex").map((account) => account.id)).not.toContain(profile.id);
});

it("shows automatic discovery errors and clears them after a successful retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Automatic discovery failed"));
  await act(async () =>
    root.render(
      createElement(TerminalProfileDiscovery, {
        provider: "claude",
        disabled: false,
        autoDiscover: true,
      }),
    ),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Automatic discovery failed");
  vi.mocked(invoke).mockResolvedValueOnce([]);
  await click("Find terminal profiles");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it.each(["success", "failure"])(
  "ignores stale automatic discovery %s after manual discovery",
  async (outcome) => {
    let settle!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = outcome === "success" ? resolve : reject;
        }),
    );
    await act(async () =>
      root.render(
        createElement(TerminalProfileDiscovery, {
          provider: "claude",
          disabled: false,
          autoDiscover: true,
        }),
      ),
    );
    vi.mocked(invoke).mockResolvedValueOnce([
      { id: "manual", provider: "claude", label: "Manual result", path: "C:/manual" },
    ]);
    await click("Find terminal profiles");
    await act(async () => settle(outcome === "success" ? [] : new Error("Stale failure")));
    expect(document.body.textContent).toContain("Manual result");
    expect(document.body.textContent).not.toContain("Stale failure");
  },
);

it("keeps Find label while connecting another profile", async () => {
  vi.mocked(invoke).mockResolvedValueOnce([
    { id: "profile", provider: "claude", label: "Profile", path: "C:/profile" },
  ]);
  await click("Find terminal profiles");
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click("Connect");
  expect(document.querySelector('button[aria-label="Find terminal profiles"]')?.textContent).toBe(
    "Find terminal profiles",
  );
  await act(async () =>
    finish({ id: "profile", provider: "claude", label: "Profile", path: "C:/profile" }),
  );
});
