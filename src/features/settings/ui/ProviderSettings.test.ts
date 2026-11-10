// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setHarnessModels, resetHarnessModelOverlays } from "../../sessions/model/models";
import { providerSessionDefaults } from "../../sessions/model/providerSessionDefaults";
import { expectedProductExtras as productExtras } from "./settingsDefaultsFixture";
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

  it("saves default effort and permissions through the provider controls", async () => {
    setHarnessModels("codex", [
      {
        id: "codex:test",
        harness: "codex",
        name: "Test",
        settings: [
          {
            id: "effort",
            label: "Effort",
            kind: "select",
            value: "medium",
            options: [
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
          },
        ],
      },
    ]);
    try {
      await render();
      await openDefaults("Codex");
      await pick("Codex default effort", "High");
      await pick("Codex default permissions", "Full access");
      // Nothing is written until Save; the bar counts what is pending.
      expect(providerSessionDefaults("codex").effort).toBeUndefined();
      expect(container.querySelector(".provider-save-bar")?.textContent).toContain(
        "2 unsaved changes",
      );
      await clickButton("Save");
      expect(providerSessionDefaults("codex")).toEqual({
        effort: "high",
        runtimeMode: "full-access",
        extras: productExtras,
      });
      const savedButton = container.querySelector<HTMLButtonElement>(
        '.provider-save-bar button[aria-label="Saved"]',
      )!;
      expect(savedButton.textContent).toBe("Saved");
      expect(savedButton.getAttribute("aria-disabled")).toBe("true");
      expect(container.querySelector(".provider-save-bar-status")).toBeNull();
      const matches = savedButton.matches.bind(savedButton);
      const focusVisible = vi
        .spyOn(savedButton, "matches")
        .mockImplementation((selector) => selector === ":focus-visible" || matches(selector));
      await act(async () => savedButton.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("Saved to Global");
      await act(async () => savedButton.blur());
      focusVisible.mockRestore();
      await selectScope("repo");
      await pick("Codex default permissions", "Supervised");
      await clickButton("Save");
      expect(providerSessionDefaults("codex", "/repo")).toMatchObject({
        runtimeMode: "supervised",
      });
      await pick("Codex default permissions", "Global (Full access)");
      await clickButton("Save");
      expect(providerSessionDefaults("codex", "/repo").runtimeMode).toBe("full-access");
    } finally {
      await act(async () => resetHarnessModelOverlays());
    }
  });
  async function pick(label: string, optionLabel: string) {
    const trigger = container.querySelector<HTMLButtonElement>(`[aria-label^="${label}"]`)!;
    expect(trigger).toBeTruthy();
    await act(async () => trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.trim() === optionLabel,
    )!;
    expect(option).toBeTruthy();
    await act(async () => option.click());
  }
  const clickButton = async (text: string) =>
    act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === text)!
        .click(),
    );
  async function openDefaults(provider: string) {
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (node) => node.textContent?.trim() === "Defaults",
    )!;
    await act(async () => tab.click());
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".provider-cli-selector button"),
    ).find((node) => node.textContent?.trim().startsWith(provider))!;
    await act(async () => button.click());
  }
  async function selectScope(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label^="Apply defaults to"]',
    )!;
    await act(async () => trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(
      (node) => node.querySelector(".truncate")?.textContent?.trim() === label,
    );
    expect(option).toBeTruthy();
    await act(async () => option!.click());
  }

  it("keeps pending defaults across tabs until Save or Discard", async () => {
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    const tab = (name: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((node) =>
        node.textContent?.trim().startsWith(name),
      )!;
    await act(async () => tab("Models").click());
    expect(tab("Defaults").querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    await act(async () => tab("Defaults").click());
    expect(container.querySelector(".provider-save-bar")?.textContent).toContain(
      "1 unsaved change",
    );
    await clickButton("Discard");
    expect(container.querySelector(".provider-save-bar-status")).toBeNull();
    expect(container.querySelector('.provider-save-bar button[aria-label="Saved"]')).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".provider-save-bar button")].find(
        (button) => button.textContent === "Save",
      )?.disabled,
    ).toBe(true);
    expect(providerSessionDefaults("claude").runtimeMode).not.toBe("full-access");
  });

  it("inherits the global default provider and picker visibility in project scope", async () => {
    localStorage.setItem(
      "bycoda.lastModel",
      JSON.stringify({ harness: "claude", model: "claude:opus-5" }),
    );
    localStorage.setItem("bycoda.hiddenPickerProviders", JSON.stringify(["cursor"]));
    await render();
    await openDefaults("Claude Code");
    await selectScope("repo");

    // A project with no overrides shows the inherited global default provider.
    expect(container.querySelector('[aria-label^="Default provider"]')?.textContent).toContain(
      "Claude Code",
    );
    const projectToggle = (name: string) =>
      container.querySelector<HTMLButtonElement>(
        `[aria-label="Show ${name} in the project model picker"]`,
      )!;
    // Picker visibility also inherits the global setting.
    expect(projectToggle("Claude Code").getAttribute("aria-checked")).toBe("true");
    await openDefaults("Cursor");
    // Global precedence: the project toggle cannot turn a globally hidden provider back on.
    expect(projectToggle("Cursor").getAttribute("aria-checked")).toBe("false");
    expect(projectToggle("Cursor").hasAttribute("disabled")).toBe(true);
    expect(projectToggle("Cursor").closest(".settings-row")?.textContent).toContain(
      "Hidden globally",
    );
  });
});
