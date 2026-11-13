// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setHarnessModels, resetHarnessModelOverlays } from "../../../sessions/model/models";
import {
  providerSessionDefaults,
  accountSessionDefaults,
} from "../../../sessions/public/providerSessionDefaults";
import { expectedProductExtras as productExtras } from "../settingsDefaultsFixture";
import { ModelsPage, resetRetainedModelsPage } from "./ModelsPage";
import { machineCapabilities } from "../../../automations/model/machineSnapshot";
import { remoteRequest } from "../../../connections/public/connections";
import {
  EMPTY_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../../shared/model/host-contracts/model-routing";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("../../../automations/model/machineSnapshot", () => ({ machineCapabilities: vi.fn() }));
vi.mock("../../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../../integrations/harness/core/availability", () => ({
  isHarnessAvailable: (id: string) => id === "claude" || id === "cursor",
  hasProbedHarnessAvailability: () => true,
  getHarnessAvailabilitySnapshot: () => 0,
  subscribeHarnessAvailability: () => () => {},
  probeHarnessAvailability: async () => {},
  harnessUnavailableHint: () => "",
}));

vi.mock("../../../model-routing/public/settings", () => ({
  ModelOrderSettings: () => null,
  ModelRolesSettings: () => null,
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetRetainedModelsPage();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(remoteRequest).mockReset();
  vi.mocked(machineCapabilities).mockReset();
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
        createElement(ModelsPage, { cwd: "/repo" }),
      ),
    ),
  );
}

describe("model defaults scope inheritance", () => {
  it("keeps hidden defaults from clipping the model order and role pages", async () => {
    await render();
    expect(container.querySelector(".provider-defaults-save-bar")).toBeNull();
    const selectTab = async (label: string) => {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (node) => node.textContent === label,
      )!;
      await act(async () => tab.click());
    };
    await selectTab("Assignments");
    expect(container.querySelector(".provider-defaults-save-bar")).toBeNull();
    await selectTab("Chat defaults");
    expect(container.querySelector(".provider-defaults-save-bar")).not.toBeNull();
    await selectTab("Subagents");
    expect(container.querySelector(".provider-defaults-save-bar")).not.toBeNull();
    await selectTab("Model order");
    expect(container.querySelector(".provider-defaults-save-bar")).toBeNull();
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
      expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
        "2 unsaved changes",
      );
      await clickButton("Save");
      expect(providerSessionDefaults("codex")).toEqual({
        effort: "high",
        runtimeMode: "full-access",
        extras: productExtras,
      });
      const savedButton = container.querySelector<HTMLButtonElement>(
        '.provider-defaults-save-bar button[aria-label="Saved"]',
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
    const radio =
      trigger.querySelector<HTMLButtonElement>(`[role="radio"][aria-label="${optionLabel}"]`) ??
      [...trigger.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) =>
        node.textContent?.endsWith(optionLabel),
      );
    if (radio) {
      await act(async () => radio.click());
      return;
    }
    await act(async () => trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (node) => node.textContent?.trim().endsWith(optionLabel),
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
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((node) =>
      node.textContent?.trim().startsWith("Chat defaults"),
    )!;
    await act(async () => tab.click());
    await pick("Provider defaults", provider);
  }
  async function selectScope(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Save in"]')!;
    await act(async () => trigger.click());
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (node) =>
        [...node.querySelectorAll("span.truncate")].some((span) => span.textContent === label),
    );
    expect(option).toBeTruthy();
    await act(async () => option!.click());
    expect(option!.getAttribute("aria-selected")).toBe("true");
    const global = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (node) => node.querySelector("span.truncate")?.textContent === "Global",
    );
    if (global?.getAttribute("aria-selected") === "true") await act(async () => global.click());
    const done = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Done",
    );
    await act(async () => done!.click());
  }

  it("keeps pending defaults across tabs until Save or Discard", async () => {
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    const tab = (name: string) =>
      Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((node) =>
        node.textContent?.trim().startsWith(name),
      )!;
    await act(async () => tab("Subagents").click());
    expect(tab("Chat defaults").querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    await act(async () => tab("Chat defaults").click());
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
      "1 unsaved change",
    );
    await clickButton("Discard");
    expect(container.querySelector(".provider-save-bar-status")).toBeNull();
    expect(
      container.querySelector('.provider-defaults-save-bar button[aria-label="Saved"]'),
    ).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".provider-defaults-save-bar button")].find(
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
  it("splits chat and delegation rows and saves one draft across both tabs", async () => {
    await render();
    await openDefaults("Claude Code");
    expect(container.querySelector(".provider-cli-selector")).toBeNull();
    expect(
      [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    ).toEqual(["Model order", "Assignments", "Chat defaults", "Subagents"]);
    expect(container.querySelector('[aria-label^="Claude Code default Advisor"]')).toBeNull();
    await pick("Claude Code default permissions", "Full access");
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith("Subagents"),
    )!;
    await act(async () => tab.click());
    expect(container.querySelector('[aria-label^="Default provider"]')).toBeNull();
    expect(container.querySelector('[aria-label^="Claude Code default permissions"]')).toBeNull();
    const subagents = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    const off = [...subagents.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === "Off",
    )!;
    await act(async () => off.click());
    expect(providerSessionDefaults("claude").runtimeMode).not.toBe("full-access");
    await clickButton("Save");
    expect(providerSessionDefaults("claude")).toMatchObject({
      runtimeMode: "full-access",
      extras: { crossSubagents: "[]" },
    });
  });

  it("keeps account override scope while switching between both defaults tabs", async () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
    );
    await render();
    await openDefaults("Claude Code");
    await pick("Account", "Work");
    await pick("Claude Code default permissions", "Full access");
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith("Subagents"),
    )!;
    await act(async () => tab.click());
    expect(container.querySelector('[aria-label^="Account"]')?.textContent).toContain("Work");
    const subagents = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    const off = [...subagents.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === "Off",
    )!;
    await act(async () => off.click());
    await clickButton("Save");
    expect(accountSessionDefaults("claude", "account-work")).toMatchObject({
      runtimeMode: "full-access",
      extras: { crossSubagents: "[]" },
    });
    expect(providerSessionDefaults("claude").runtimeMode).not.toBe("full-access");
  });

  it("writes Subagents to the capable Host, preserves routing and keeps rejected drafts", async () => {
    let hostState: ModelRoutingState = {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      version: 5,
      updatedAt: 1,
      defaultMaxRunMinutes: 75,
    };
    hostState.delegation.global = { crossSubagentMaxEffort: "high" };
    vi.mocked(invoke).mockResolvedValue([
      { id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" },
    ]);
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    let rejectSave = true;
    vi.mocked(remoteRequest).mockImplementation(async (_id, method, params) => {
      if (method === "modelRouting.save") {
        if (rejectSave) throw new Error("Version conflict");
        const input = params as { expectedVersion: number; draft: typeof EMPTY_MODEL_ROUTING };
        expect(input.expectedVersion).toBe(5);
        expect(input.draft.defaultMaxRunMinutes).toBe(75);
        hostState = { ...input.draft, version: 6, updatedAt: 2 };
      }
      return { state: hostState };
    });
    await render();
    await openDefaults("Claude Code");
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) =>
      node.textContent?.startsWith("Subagents"),
    )!;
    await act(async () => tab.click());
    expect(container.textContent).toContain("Global settings apply to chats and unattended work.");
    const subagents = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    const off = [...subagents.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (node) => node.textContent === "Off",
    )!;
    await act(async () => off.click());
    await clickButton("Save");
    expect(container.textContent).toContain("Version conflict");
    expect(hostState.delegation.providers.claude).toBeUndefined();
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain("Retry");
    rejectSave = false;
    await clickButton("Retry");
    expect(hostState.delegation.providers.claude).toEqual({ crossSubagents: "[]" });
    expect(hostState.delegation.global).toEqual({ crossSubagentMaxEffort: "high" });
    expect(providerSessionDefaults("claude").extras).toMatchObject({
      crossSubagents: "[]",
      crossSubagentMaxEffort: "high",
    });
  });
});
