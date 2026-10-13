// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TerminalProfileDiscovery } from "./TerminalProfileDiscovery";
import { providerAccounts } from "../../providers/model/providerAccounts";

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
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
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
  expect(container.textContent).toContain(profile.path);
  vi.mocked(invoke).mockResolvedValueOnce(profile);
  await click("Connect");
  expect(invoke).toHaveBeenLastCalledWith("provider_terminal_profile_connect", {
    provider: "claude",
    path: profile.path,
  });
  expect(providerAccounts("claude").map((account) => account.id)).toContain(profile.id);
  expect(container.textContent).toContain("Connected");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("shows discovery failures and allows retry", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Profile directory unavailable"));
  await click("Find terminal profiles");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Profile directory unavailable",
  );
  vi.mocked(invoke).mockResolvedValueOnce([]);
  await click("Find terminal profiles");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("No terminal profiles found");
});
