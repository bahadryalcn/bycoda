// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvidersPage, resetRetainedProvidersPage } from "./ProviderSettings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: (id: string) => id === "claude" || id === "cursor",
  hasProbedHarnessAvailability: () => true,
  getHarnessAvailabilitySnapshot: () => 0,
  subscribeHarnessAvailability: () => () => {},
  probeHarnessAvailability: async () => {},
  harnessUnavailableHint: () => "",
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRetainedProvidersPage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ProvidersPage, { cwd: "/repo" }),
      ),
    ),
  );
}

describe("providers scope inheritance", () => {
  it("keeps ACP management inside its provider panel without duplicate sections", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "generic_acp_list" ? [] : undefined,
    );
    await render();
    expect(container.querySelectorAll("#setting-acp-agents")).toHaveLength(1);
    const management = container.querySelector<HTMLElement>("#setting-acp-agents")!;
    const panel = management.closest<HTMLElement>(".provider-cli-panel")!;
    expect(panel).not.toBeNull();
    expect(management.closest(".provider-cli-workspace")).not.toBeNull();
    const providerButton = (name: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".provider-cli-selector button"),
      ).find((button) => button.textContent?.trim().startsWith(name))!;
    await act(async () => providerButton("Claude Code").click());
    expect(panel.hidden).toBe(true);
    await act(async () => providerButton("ACP Agent").click());
    expect(panel.hidden).toBe(false);
    await act(async () => providerButton("Codex").click());
    expect(panel.hidden).toBe(true);
    expect(container.querySelector("#setting-acp-agents")).toBe(management);
  });
});

it("separates Accounts from CLI and keeps setup rows mounted across tabs", async () => {
  await render();
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((node) => node.textContent?.trim())).toEqual([
    "Accounts",
    "CLI",
    "Catalog",
    "Decision models",
  ]);
  const row = container.querySelector('[data-setting-id="cli-path-codex"]')!;
  expect(row.closest<HTMLElement>("[hidden]")).not.toBeNull();
  await act(async () => tabs.find((node) => node.textContent === "CLI")!.click());
  expect(row.closest("[hidden]")).toBeNull();
  expect(container.querySelector(".provider-cli-container")?.hasAttribute("hidden")).toBe(true);
  await act(async () => tabs.find((node) => node.textContent === "Accounts")!.click());
  expect(container.querySelector('[data-setting-id="cli-path-codex"]')).toBe(row);
});
