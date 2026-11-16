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
import { ModelsPage, resetRetainedModelsPage, type ModelsView } from "./ModelsPage";
import { saveProviderAccount } from "../../../providers/model/providerAccounts";
import { saveAccountSessionDefaults } from "../../../sessions/model/accountSessionDefaults";
import { loadProjectProviderSettings } from "../../../sessions/model/projectProviders";
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

vi.mock("../../../model-routing/public/settings", async (original) => ({
  ...(await original<typeof import("../../../model-routing/public/settings")>()),
  ModelOrderSettings: () => createElement("div", { "data-testid": "model-order" }),
  ModelRolesSettings: () => createElement("div", { "data-testid": "model-assignments" }),
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

async function render(view: ModelsView = "chat") {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ModelsPage, { cwd: "/repo", view }),
      ),
    ),
  );
}

describe("model defaults scope inheritance", () => {
  it("waits for the Host identity before offering an editable defaults draft", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "remote_machines"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : undefined,
    );
    vi.mocked(machineCapabilities).mockResolvedValue([]);
    await render();
    expect(container.querySelector(".provider-defaults-save-bar")).toBeNull();
    await act(async () =>
      finish([{ id: "initial-host", localHost: true, endpoint: "http://127.0.0.1:7777" }]),
    );
    await vi.waitFor(() =>
      expect(container.querySelector(".provider-defaults-save-bar")).not.toBeNull(),
    );
  });

  it("keeps work routing and chat defaults in their respective views", async () => {
    const visible = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`)?.closest("[hidden]") === null;
    await render("work");
    await vi.waitFor(() => expect(visible("model-order")).toBe(true));
    expect(visible("model-assignments")).toBe(true);
    expect(container.querySelector(".provider-defaults-save-bar")).toBeNull();
    await render("delegation");
    expect(visible("model-order")).not.toBe(true);
    expect(visible("model-assignments")).not.toBe(true);
    expect(container.querySelector(".provider-defaults-save-bar")).not.toBeNull();
    await render("chat");
    expect(visible("model-order")).not.toBe(true);
    expect(visible("model-assignments")).not.toBe(true);
    expect(container.querySelector(".provider-defaults-save-bar")).not.toBeNull();
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
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
        "Saved to Bycoda defaults",
      );
      await act(async () => savedButton.blur());
      focusVisible.mockRestore();
      await selectScope("repo");
      await pick("Codex default permissions", "Supervised");
      await clickButton("Save");
      expect(providerSessionDefaults("codex", "/repo")).toMatchObject({
        runtimeMode: "supervised",
      });
      await pick("Codex default permissions", "Bycoda defaults (Full access)");
      await clickButton("Save");
      expect(providerSessionDefaults("codex", "/repo").runtimeMode).toBe("full-access");
    } finally {
      await act(async () => resetHarnessModelOverlays());
    }
  });
  async function pick(label: string, optionLabel: string) {
    await vi.waitFor(() =>
      expect(container.querySelector(`[aria-label^="${label}"]`)).toBeTruthy(),
    );
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
    await pick("Provider defaults", provider);
  }
  async function selectScope(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Save in"]')!;
    await act(async () => trigger.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((node) => node.textContent === "Project overrides")!
        .click(),
    );
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (node) =>
        [...node.querySelectorAll("span.truncate")].some((span) => span.textContent === label),
    );
    expect(option, document.body.textContent ?? "").toBeTruthy();
    await act(async () => option!.click());
    expect(option!.getAttribute("aria-selected")).toBe("true");
    const done = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Done",
    );
    await act(async () => done!.click());
  }

  it("lets a project pick the account a provider starts on and inherit its defaults", async () => {
    saveProviderAccount({ id: "account-home", provider: "claude", label: "Home" });
    saveProviderAccount({ id: "account-work", provider: "claude", label: "Work" });
    saveAccountSessionDefaults("claude", "account-work", { runtimeMode: "supervised" });
    await render();
    await openDefaults("Claude Code");
    // Global keeps its scope switch; a project saves which account its chats start on.
    expect(
      container.querySelector('[aria-label="Claude Code account for this project"]'),
    ).toBeNull();
    await selectScope("repo");
    const permissions = () =>
      container.querySelector('[aria-label^="Claude Code default permissions"]')?.textContent;
    expect(permissions()).not.toContain("Supervised");
    await pick("Claude Code account for this project", "Work");
    expect(permissions()).toContain("Bycoda defaults (Supervised)");
    await clickButton("Save");
    expect(loadProjectProviderSettings("/repo").accounts).toEqual({ claude: "account-work" });
  });

  it("keeps pending defaults across tabs until Save or Discard", async () => {
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    await render("delegation");
    await render();
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
  it("keeps subagent rows out of Chats, shows them in Subagents and saves one draft across both", async () => {
    await render();
    await openDefaults("Claude Code");
    expect(container.querySelector(".provider-cli-selector")).toBeNull();
    expect(container.querySelector('[aria-label^="Claude Code default Advisor"]')).toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Subagents"]')).toBeNull();
    await pick("Claude Code default permissions", "Full access");
    await render("delegation");
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

  it("keeps account selection and drafts between Chats and Subagents", async () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
    );
    await render();
    await openDefaults("Claude Code");
    await pick("Account", "Work");
    await pick("Claude Code default permissions", "Full access");
    await render("delegation");
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
        const input = params as {
          expectedVersion: number;
          draft: typeof EMPTY_MODEL_ROUTING;
        };
        expect(input.expectedVersion).toBe(5);
        expect(input.draft.defaultMaxRunMinutes).toBe(75);
        hostState = { ...input.draft, version: 6, updatedAt: 2 };
      }
      return { state: hostState };
    });
    await render();
    await openDefaults("Claude Code");
    await render("delegation");
    expect(container.textContent).not.toContain("Global settings apply to chats");
    expect(container.querySelector('button[aria-label="Help"]')).not.toBeNull();
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
  it("retains a delayed defaults save across remount and blocks duplicate submission", async () => {
    let hostState: ModelRoutingState = {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      version: 5,
      updatedAt: 1,
    };
    vi.mocked(invoke).mockResolvedValue([
      { id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" },
    ]);
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    let finish!: (value: unknown) => void;
    vi.mocked(remoteRequest).mockImplementation(async (_id, method) =>
      method === "modelRouting.save"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : { state: hostState },
    );
    await render();
    await openDefaults("Claude Code");
    await render("delegation");
    const group = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    await act(async () =>
      [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((node) => node.textContent === "Off")!
        .click(),
    );
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Save")!
        .click();
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await act(async () =>
      root.render(createElement(QueryClientProvider, { client: queryClient }, null)),
    );
    await render("delegation");
    expect(
      vi.mocked(remoteRequest).mock.calls.filter((call) => call[1] === "modelRouting.save"),
    ).toHaveLength(1);
    hostState = {
      ...hostState,
      version: 6,
      delegation: { ...hostState.delegation, providers: { claude: { crossSubagents: "[]" } } },
    };
    await act(async () => finish({ state: hostState }));
    await vi.waitFor(() =>
      expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
        "Saved",
      ),
    );
  });

  async function pendingDefaults(hostId: string, account = false) {
    if (account)
      localStorage.setItem(
        "bycoda.providerAccounts.v1",
        JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
      );
    let hostState: ModelRoutingState = {
      ...structuredClone(EMPTY_MODEL_ROUTING),
      version: 5,
      updatedAt: 1,
    };
    vi.mocked(invoke).mockResolvedValue([
      { id: hostId, localHost: true, endpoint: "http://127.0.0.1:7777" },
    ]);
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    let reject!: (error: Error) => void;
    let resolve!: (value: unknown) => void;
    vi.mocked(remoteRequest).mockImplementation(async (_id, method) =>
      method === "modelRouting.save"
        ? new Promise((done, fail) => {
            resolve = done;
            reject = fail;
          })
        : { state: hostState },
    );
    await render();
    await openDefaults("Claude Code");
    if (account) await pick("Account", "Work");
    await render("delegation");
    const group = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    await act(async () =>
      [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((node) => node.textContent === "Off")!
        .click(),
    );
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Save")!
        .click();
    });
    await vi.waitFor(() => expect(reject).toBeDefined());
    return {
      reject: (error: Error) => reject(error),
      resolve: () => {
        hostState = { ...hostState, version: 6 };
        resolve({ state: hostState });
      },
    };
  }
  it("retains a failed delayed save after remount and retries once", async () => {
    const pending = await pendingDefaults("fail-host");
    await act(async () =>
      root.render(createElement(QueryClientProvider, { client: queryClient }, null)),
    );
    await render("delegation");
    await act(async () => pending.reject(new Error("deferred failure")));
    await vi.waitFor(() =>
      expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
        "Retry",
      ),
    );
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain("Retry");
    vi.mocked(remoteRequest).mockImplementation(async (_id, method) => ({
      state: {
        ...structuredClone(EMPTY_MODEL_ROUTING),
        version: method === "modelRouting.save" ? 6 : 5,
        updatedAt: 1,
      },
    }));
    await clickButton("Retry");
    expect(
      vi.mocked(remoteRequest).mock.calls.filter((call) => call[1] === "modelRouting.save"),
    ).toHaveLength(2);
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain("Saved");
  });
  it("does not apply a pending target outcome to a different target draft", async () => {
    const pending = await pendingDefaults("target-host");
    const request = vi
      .mocked(remoteRequest)
      .mock.calls.find((call) => call[1] === "modelRouting.save")!;
    expect(request[0]).toBe("target-host");
    expect(request[2]).toMatchObject({
      expectedVersion: 5,
      draft: { delegation: { providers: { claude: { crossSubagents: "[]" } } } },
    });
    await selectScope("repo (Chats only)");
    const group = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    await act(async () =>
      [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        .find((node) => node.textContent === "Off")!
        .click(),
    );
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
      "1 unsaved change",
    );
    await act(async () => pending.resolve());
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain(
      "1 unsaved change",
    );
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).not.toContain(
      "Saved",
    );
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Save in"]')!;
    await act(async () => trigger.click());
    const global = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (node) => node.textContent === "Bycoda defaults",
    )!;
    await act(async () => global.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((node) => node.textContent === "Done")!
        .click(),
    );
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain("Saved");
  });
  it("keeps provider and account drafts separate in one project", async () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
    );
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    await pick("Account", "Work");
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).not.toContain(
      "1 unsaved change",
    );
    await pick("Provider defaults", "Codex");
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).not.toContain(
      "1 unsaved change",
    );
  });

  it("shows loading while Host capabilities are pending", async () => {
    let finish!: (value: string[]) => void;
    vi.mocked(invoke).mockResolvedValue([
      { id: "pending", localHost: true, endpoint: "http://127.0.0.1:7777" },
    ]);
    vi.mocked(machineCapabilities).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render("delegation");
    await vi.waitFor(() => expect(finish).toBeDefined());
    await vi.waitFor(() => expect(container.textContent).toContain("Loading"));
    expect(container.textContent).not.toContain("unavailable on this Host");
    await act(async () => finish(["models.routing.v1"]));
  });

  it("keeps originating account payload when the provider changes during save", async () => {
    const pending = await pendingDefaults("account-host", true);
    const request = vi
      .mocked(remoteRequest)
      .mock.calls.find((call) => call[1] === "modelRouting.save")!;
    expect(request[0]).toBe("account-host");
    expect(request[2]).toMatchObject({
      expectedVersion: 5,
      draft: { delegation: { accounts: { "claude\naccount-work": { crossSubagents: "[]" } } } },
    });
    await pick("Provider defaults", "Codex");
    await act(async () => pending.resolve());
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).not.toContain(
      "Saved",
    );
    await pick("Provider defaults", "Claude Code");
    expect(container.querySelector(".provider-defaults-save-bar")?.textContent).toContain("Saved");
  });
});
