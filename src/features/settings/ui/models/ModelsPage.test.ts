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
import { applyRemoteConnection, resetRemoteHealth } from "../../../connections/model/remoteHealth";
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
  resetRemoteHealth();
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetRemoteHealth();
  queryClient.clear();
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function render(view: ModelsView = "defaults") {
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

const withEnvironment = (machine: Record<string, unknown>) => ({
  environmentId: `env-${String(machine.id)}`,
  ...machine,
});
const mockLocalHost = (input: Record<string, unknown>, others: Record<string, unknown>[] = []) => {
  const machine = withEnvironment(input);
  return vi
    .mocked(invoke)
    .mockImplementation(async (command) =>
      command === "local_host_connect"
        ? machine
        : command === "remote_machines"
          ? [machine, ...others.map(withEnvironment)]
          : undefined,
    );
};

describe("model defaults scope inheritance", () => {
  it("keeps chat defaults editable while this computer's Host is rejected", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "local_host_connect")
        throw new Error("Host rejected request [RPC_AUTHORIZATION] (environment.describe)");
      return [];
    });
    await render();
    await vi.waitFor(() =>
      expect(container.querySelector("[data-settings-save-bar]")).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("RPC_AUTHORIZATION");
  });

  it("shows one error with Retry, and no 'not available' message, when the Host cannot be read", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "local_host_connect")
        throw new Error("Host rejected request [RPC_AUTHORIZATION] (environment.describe)");
      return [];
    });
    await render("work");
    await vi.waitFor(() => expect(container.textContent).toContain("RPC_AUTHORIZATION"));
    expect(container.textContent).not.toContain("Background work is not available on this Host.");
    expect(container.textContent?.match(/RPC_AUTHORIZATION/g)).toHaveLength(1);
    expect(
      [...container.querySelectorAll("button")].filter((node) => node.textContent === "Retry"),
    ).toHaveLength(1);
  });

  it("shows one error when the capability probe fails", async () => {
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" });
    vi.mocked(machineCapabilities).mockRejectedValue(new Error("synthetic probe failure"));
    await render("work");
    await vi.waitFor(() => expect(container.textContent).toContain("synthetic probe failure"));
    expect(container.textContent).not.toContain("Background work is not available on this Host.");
    expect(container.querySelector('[data-testid="model-order"]')).toBeNull();
  });

  it("offers Reconnect when this computer's Host revoked its link, and reloads after it", async () => {
    const local = withEnvironment({
      id: "local",
      localHost: true,
      endpoint: "http://127.0.0.1:7777",
    });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "local_host_connect" || command === "local_host_reconnect"
        ? local
        : command === "remote_machines"
          ? [local]
          : undefined,
    );
    let revoked = true;
    vi.mocked(machineCapabilities).mockImplementation(async () => {
      if (revoked)
        throw new Error("Host rejected request [RPC_AUTHORIZATION] (environment.describe)");
      return ["models.routing.v1"];
    });
    await render("work");
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "This computer's connection to its Host was revoked.",
      ),
    );
    expect(container.textContent).not.toContain("RPC_AUTHORIZATION");
    expect(invoke).not.toHaveBeenCalledWith("local_host_reconnect", expect.anything());
    expect(container.querySelector('[data-testid="model-order"]')).toBeNull();
    const reconnect = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "Reconnect",
    )!;
    revoked = false;
    await act(async () => reconnect.click());
    expect(invoke).toHaveBeenCalledWith("local_host_reconnect", { machineId: "local" });
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-order"]')).not.toBeNull(),
    );
    expect(container.textContent).not.toContain("was revoked");
  });

  it("keeps work routing and chat defaults in their respective views", async () => {
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" });
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    const visible = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`)?.closest("[hidden]") === null;
    await render("work");
    await vi.waitFor(() => expect(visible("model-order")).toBe(true));
    expect(container.querySelector("[data-settings-save-bar]")).toBeNull();
    await render("defaults");
    expect(visible("model-order")).not.toBe(true);
    expect(container.querySelector("[data-settings-save-bar]")).not.toBeNull();
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
      expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain(
        "2 unsaved changes",
      );
      await clickButton("Save");
      expect(providerSessionDefaults("codex")).toEqual({
        effort: "high",
        runtimeMode: "full-access",
        extras: productExtras,
      });
      const savedButton = container.querySelector<HTMLButtonElement>(
        '[data-settings-save-bar] button[aria-label^="Saved"]',
      )!;
      expect(savedButton.textContent).toBe("Saved to Bycoda defaults");
      expect(savedButton.getAttribute("aria-disabled")).toBe("true");
      expect(container.querySelector(".provider-save-bar-status")).toBeNull();
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
  async function selectScope(label: string, decision?: "Keep editing" | "Discard and leave") {
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
    if (decision) {
      expect(document.body.textContent).toContain("Save changes before leaving?");
      await act(async () =>
        [...document.querySelectorAll<HTMLButtonElement>("button")]
          .find((node) => node.textContent === decision)!
          .click(),
      );
    }
    if (decision !== "Keep editing") expect(option!.getAttribute("aria-selected")).toBe("true");
    const done = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Done",
    );
    await act(async () => (done?.disabled ? trigger.click() : done?.click()));
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

  it("asks before changing destination and keeps the draft when editing continues", async () => {
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    await selectScope("repo", "Keep editing");
    expect(container.querySelector('[aria-label="Save in"]')?.textContent).toContain(
      "Bycoda defaults",
    );
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain(
      "1 unsaved change",
    );
    await selectScope("repo", "Discard and leave");
    expect(container.querySelector('[aria-label="Save in"]')?.textContent).not.toContain(
      "Bycoda defaults",
    );
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).not.toContain(
      "unsaved change",
    );
  });

  it("keeps pending defaults across tabs until Save or Discard", async () => {
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    await render("work");
    await render();
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain(
      "1 unsaved change",
    );
    await clickButton("Discard");
    expect(container.querySelector(".provider-save-bar-status")).toBeNull();
    expect(
      container.querySelector('[data-settings-save-bar] button[aria-label^="Saved"]'),
    ).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>("[data-settings-save-bar] button")].find(
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
  it("shows chat and subagent rows together in Defaults and saves one draft", async () => {
    await render();
    await openDefaults("Claude Code");
    expect(
      container.querySelector('[aria-label^="Claude Code default permissions"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="radiogroup"][aria-label="Subagents"]')).not.toBeNull();
    await pick("Claude Code default permissions", "Full access");
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

  it("keeps the account selection while chat and subagent rows share one draft", async () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
    );
    await render();
    await openDefaults("Claude Code");
    await pick("Account", "Work");
    await pick("Claude Code default permissions", "Full access");
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
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" });
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
    expect(container.textContent).not.toContain("Global settings apply to chats");
    expect(container.querySelector('[role="img"][aria-label="Help"]')).not.toBeNull();
    const subagents = container.querySelector('[role="radiogroup"][aria-label="Subagents"]')!;
    const off = [...subagents.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (node) => node.textContent === "Off",
    )!;
    await act(async () => off.click());
    await clickButton("Save");
    expect(container.textContent).toContain("Version conflict");
    expect(hostState.delegation.providers.claude).toBeUndefined();
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Retry");
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
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" });
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
    await render();
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
      expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Saved"),
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
    mockLocalHost({ id: hostId, localHost: true, endpoint: "http://127.0.0.1:7777" });
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
    await render();
    await act(async () => pending.reject(new Error("deferred failure")));
    await vi.waitFor(() =>
      expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Retry"),
    );
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Retry");
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
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Saved");
  });
  it("keeps the destination fixed until its pending save finishes", async () => {
    const pending = await pendingDefaults("target-host");
    const request = vi
      .mocked(remoteRequest)
      .mock.calls.find((call) => call[1] === "modelRouting.save")!;
    expect(request[0]).toBe("target-host");
    expect(request[2]).toMatchObject({
      expectedVersion: 5,
      draft: { delegation: { providers: { claude: { crossSubagents: "[]" } } } },
    });
    await selectScope("repo (Chats only)", "Keep editing");
    expect(document.body.textContent).not.toContain("Discard and leave");
    expect(container.querySelector('[aria-label="Save in"]')?.textContent).toContain(
      "Bycoda defaults",
    );
    await act(async () => pending.resolve());
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Saved");
    await selectScope("repo (Chats only)");
    expect(container.querySelector('[aria-label="Save in"]')?.textContent).not.toContain(
      "Bycoda defaults",
    );
  });
  it("keeps one draft across providers and accounts in one project", async () => {
    localStorage.setItem(
      "bycoda.providerAccounts.v1",
      JSON.stringify({ claude: [{ id: "account-work", label: "Work" }] }),
    );
    await render();
    await openDefaults("Claude Code");
    await pick("Claude Code default permissions", "Full access");
    await pick("Account", "Work");
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain(
      "unsaved change",
    );
    // One draft spans every provider, so switching never hides the edit.
    await pick("Provider defaults", "Codex");
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain(
      "unsaved change",
    );
  });

  it("shows loading while Host capabilities are pending", async () => {
    let finish!: (value: string[]) => void;
    mockLocalHost({ id: "pending", localHost: true, endpoint: "http://127.0.0.1:7777" });
    vi.mocked(machineCapabilities).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render("work");
    await vi.waitFor(() => expect(finish).toBeDefined());
    await vi.waitFor(() => expect(container.textContent).toContain("Loading"));
    expect(container.textContent).not.toContain("unavailable on this Host");
    await act(async () => finish(["models.routing.v1"]));
  });

  const office = { id: "office", name: "Office", endpoint: "https://office.invalid" };
  const optionLabels = async () => {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label^="Applying settings to"]')!.click(),
    );
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((node) =>
      node.textContent?.trim(),
    );
  };

  it("lists every saved machine at once, before any of them answers", async () => {
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" }, [office]);
    vi.mocked(machineCapabilities).mockImplementation(() => new Promise(() => {}));
    await render("work");
    await vi.waitFor(() =>
      expect(container.querySelector('[aria-label^="Applying settings to"]')).not.toBeNull(),
    );
    expect(await optionLabels()).toEqual(["This computer · Checking…", "Office · Checking…"]);
    expect(container.querySelector('[data-testid="model-order"]')).toBeNull();
  });

  it("selects an offline machine without editing it or switching to another one", async () => {
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" }, [office]);
    applyRemoteConnection("env-office", {
      type: "failure",
      error: "Machine is unreachable",
      at: Date.now(),
    });
    vi.mocked(machineCapabilities).mockImplementation(async (machine) => {
      if (machine.id === "office") throw new Error("Machine is unreachable");
      return ["models.routing.v1"];
    });
    await render("work");
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-order"]')).not.toBeNull(),
    );
    expect(await optionLabels()).toEqual(["This computer", "Office · Offline"]);
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((node) => node.textContent?.includes("Office"))!
        .click(),
    );
    await vi.waitFor(() => expect(container.textContent).toContain("Office is offline."));
    expect(container.querySelector('[data-testid="model-order"]')).toBeNull();
    expect(
      [...container.querySelectorAll("button")].filter((node) => node.textContent === "Retry"),
    ).toHaveLength(1);
  });

  it("says a removed machine is gone and returns to this computer only when asked", async () => {
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" }, [office]);
    vi.mocked(machineCapabilities).mockResolvedValue(["models.routing.v1"]);
    await render("work");
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-order"]')).not.toBeNull(),
    );
    await optionLabels();
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((node) => node.textContent?.includes("Office"))!
        .click(),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-order"]')).not.toBeNull(),
    );
    mockLocalHost({ id: "local", localHost: true, endpoint: "http://127.0.0.1:7777" });
    await act(async () => {
      window.dispatchEvent(new Event("bycoda:remote-machines"));
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("This machine is no longer available."),
    );
    expect(container.querySelector('[data-testid="model-order"]')).toBeNull();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Use this computer")!
        .click(),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-order"]')).not.toBeNull(),
    );
  });

  it("keeps originating account payload and the saved state when the provider changes during save", async () => {
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
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Saved");
    await pick("Provider defaults", "Claude Code");
    expect(container.querySelector("[data-settings-save-bar]")?.textContent).toContain("Saved");
  });
});
