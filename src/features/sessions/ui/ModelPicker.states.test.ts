// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessId } from "../model/session";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
  harnessUnavailableHint: (id: string) => `${id} not found. Install it.`,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../shared/ui/Popover", () => ({
  Popover: ({
    children,
    role,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    children: ReactNode;
    role?: string;
    className?: string;
    tabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    "aria-label"?: string;
  }) =>
    createElement(
      "div",
      { role, className, tabIndex, onKeyDown, "aria-label": props["aria-label"] },
      children,
    ),
}));

import { ModelControlPills, ModelPicker, preloadModelPicker } from "./ModelPicker";
import { ModelSourceContext, type ModelSource } from "./modelSource";
import { renameProviderAccount, saveProviderAccount } from "../../providers/model/providerAccounts";
import {
  resetDisabledModels,
  resetHarnessModelOverlays,
  setHarnessModels,
  type AgentModel,
} from "../model/models";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await preloadModelPicker();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetDisabledModels();
  resetHarnessModelOverlays();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

const toggle = (id: string, value: string) => ({
  id,
  label: id === "fast" ? "Fast" : id,
  kind: "toggle" as const,
  value,
  options: [
    { value: "true", label: "On" },
    { value: "false", label: "Off" },
  ],
});
const effort = (value: string) => ({
  id: "effort",
  label: "Reasoning",
  kind: "select" as const,
  value,
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
});

/** A host source over a fixed catalog; each test overrides only what it is about. */
function hostSource(models: AgentModel[], overrides: Partial<ModelSource> = {}): ModelSource {
  return {
    id: "host-1",
    modelsFor: (harness: HarnessId) => models.filter((model) => model.harness === harness),
    resolve: (harness: HarnessId, id?: string) =>
      models.find((model) => model.harness === harness && model.id === id) ??
      models.find((model) => model.harness === harness) ?? {
        id: id ?? `${harness}:unknown`,
        harness,
        name: id ?? "Unknown",
      },
    find: (id: string) => models.find((model) => model.id === id),
    available: () => true,
    probed: () => true,
    refresh: () => {},
    ...overrides,
  };
}

const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
const options = () =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].map((item) =>
    item.textContent?.trim(),
  );

describe("model picker account states", () => {
  it("lists one row per provider account and names the chosen account in the trigger", async () => {
    renameProviderAccount("claude", "default", "personal");
    saveProviderAccount({ id: "account-work", provider: "claude", label: "work" });
    saveProviderAccount({ id: "account-lab", provider: "claude", label: "lab" });
    setHarnessModels("claude", [
      { id: "claude:opus-5.5", harness: "claude", name: "Opus 5.5", nativeId: "opus-5.5" },
    ]);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5.5",
          values: {},
          hideSettings: true,
          accountChoices: true,
          accountId: "account-lab",
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    expect(trigger().querySelector("[data-model-account]")?.textContent).toBe("lab");
    await act(async () => trigger().click());
    expect(options()).toEqual(["Opus 5.5 personal", "Opus 5.5 work", "Opus 5.5 lab"]);
  });

  it("keeps a lone default account out of the trigger", async () => {
    setHarnessModels("claude", [
      { id: "claude:opus-5.5", harness: "claude", name: "Opus 5.5", nativeId: "opus-5.5" },
    ]);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5.5",
          values: {},
          hideSettings: true,
          accountChoices: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    expect(trigger().querySelector("[data-model-account]")).toBeNull();
  });

  it("shows a removed local account honestly instead of a blank or another account", async () => {
    saveProviderAccount({ id: "account-work", provider: "claude", label: "work" });
    setHarnessModels("claude", [
      { id: "claude:opus-5.5", harness: "claude", name: "Opus 5.5", nativeId: "opus-5.5" },
    ]);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "claude",
          model: "claude:opus-5.5",
          values: {},
          hideSettings: true,
          accountChoices: true,
          accountId: "account-deleted",
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    expect(trigger().querySelector("[data-model-account]")?.textContent).toBe("Removed account");
    expect(trigger().getAttribute("aria-label")).toContain("Removed account");
    // The removed account is not offered as a choice.
    await act(async () => trigger().click());
    expect(options().some((label) => label?.includes("deleted"))).toBe(false);
  });
});

describe("model picker with a remote Host catalog", () => {
  const opus: AgentModel = {
    id: "claude:opus-5.5",
    harness: "claude",
    name: "Opus 5.5",
    nativeId: "opus-5.5",
  };

  async function renderHost(source: ModelSource, accountId?: string) {
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "claude",
            model: opus.id,
            values: {},
            hideSettings: true,
            accountChoices: true,
            accountId,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
  }

  it("offers only the Host's accounts, never this computer's profiles", async () => {
    saveProviderAccount({ id: "local-only", provider: "claude", label: "this computer" });
    await renderHost(
      hostSource([opus], {
        accounts: {
          claude: [
            { id: "default", label: "Host main" },
            { id: "host-b", label: "Host second" },
          ],
        },
      }),
      "host-b",
    );
    expect(trigger().querySelector("[data-model-account]")?.textContent).toBe("Host second");
    await act(async () => trigger().click());
    expect(options()).toEqual(["Opus 5.5 Host main", "Opus 5.5 Host second"]);
    expect(container.textContent).not.toContain("this computer");
  });

  it("labels a saved account the Host no longer has as unavailable", async () => {
    await renderHost(
      hostSource([opus], { accounts: { claude: [{ id: "default", label: "Host main" }] } }),
      "host-gone",
    );
    expect(trigger().querySelector("[data-model-account]")?.textContent).toBe(
      "Unavailable Host account",
    );
    expect(trigger().getAttribute("aria-label")).toContain("Unavailable Host account");
  });

  it("offers no account rows for an empty Host account list instead of local ones", async () => {
    saveProviderAccount({ id: "local-only", provider: "claude", label: "this computer" });
    await renderHost(hostSource([opus], { accounts: { claude: [] } }));
    await act(async () => trigger().click());
    expect(options()).toEqual([]);
    expect(container.textContent).not.toContain("this computer");
  });

  it("follows a republished Host account list", async () => {
    const source = (label: string) =>
      hostSource([opus], { accounts: { claude: [{ id: "default", label }] } });
    await renderHost(source("Before"));
    await act(async () => trigger().click());
    expect(options()).toEqual(["Opus 5.5 Before"]);
    await renderHost(source("After"));
    expect(options()).toEqual(["Opus 5.5 After"]);
  });
});

describe("model picker catalog states", () => {
  it.each(["before mount", "after mount"])(
    "edits a persisted model's reasoning without selecting it again when its catalog arrives %s",
    async (arrival) => {
      const model: AgentModel = {
        id: "codex:owner-private-v42",
        harness: "codex",
        name: "Owner private model",
        settings: [{ ...effort("low"), id: "reasoningEffort" }],
      };
      setHarnessModels("codex", arrival === "before mount" ? [model] : []);
      const onChange = vi.fn();
      const onSettingsChange = vi.fn();
      const values = {
        reasoningEffort: "low",
        accountId: "owner-account",
        customPolicy: "keep-this-setting",
      };
      await act(async () =>
        root.render(
          createElement(ModelPicker, {
            harness: "codex",
            model: model.id,
            values,
            presentation: "field",
            showExtras: true,
            onChange,
            onSettingsChange,
          }),
        ),
      );
      if (arrival === "after mount") {
        expect(trigger().textContent).not.toContain("Owner private model");
        await act(async () => setHarnessModels("codex", [model]));
      }
      expect(trigger().textContent).toContain("Owner private model");
      await act(async () => trigger().click());
      const reasoning = [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.includes("Reasoning"));
      expect(reasoning).toBeTruthy();
      await act(async () => reasoning!.click());
      const high = [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
      ].find((item) => item.textContent?.trim() === "High");
      expect(high).toBeTruthy();
      await act(async () => high!.click());
      expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
        ...values,
        reasoningEffort: "high",
      });
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("keeps a saved model that the catalog no longer lists visible and selectable elsewhere", async () => {
    const listed: AgentModel = { id: "cursor:listed", harness: "cursor", name: "Listed" };
    const source = hostSource([listed], {
      resolve: (harness, id) => ({ id: id ?? "", harness, name: "Retired model" }),
    });
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "cursor",
            model: "cursor:retired",
            values: {},
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
    expect(trigger().textContent).toContain("Retired model");
    await act(async () => trigger().click());
    expect(options()).toEqual(["Listed"]);
    expect(
      container.querySelector('[role="option"][aria-selected="true"]'),
      "the missing model is not falsely marked as one of the listed models",
    ).toBeNull();
  });

  it("says a catalog is still loading rather than empty while Codex models are discovered", async () => {
    const source = hostSource([], {
      resolve: (harness, id) => ({ id: id ?? "codex:saved", harness, name: "saved" }),
    });
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "codex",
            model: "codex:saved",
            values: {},
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () => trigger().click());
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
      "Loading Codex models…",
    );
  });

  it("hides a provider whose finished probe found nothing and keeps the installed ones", async () => {
    const source = hostSource([], {
      available: (harness) => harness !== "cursor",
      probed: () => true,
    });
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "claude",
            model: "claude:opus-5.5",
            values: {},
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () => trigger().click());
    const tabs = [
      ...container.querySelectorAll('[role="tablist"][aria-label="Providers"] [role="tab"]'),
    ].map((tab) => tab.getAttribute("aria-label"));
    expect(tabs).toContain("Claude Code");
    expect(tabs).not.toContain("Cursor");
  });

  it("shows an unavailable provider's hint on its own tab while the probe is still pending", async () => {
    const source = hostSource([], {
      available: () => false,
      probed: () => false,
    });
    await act(async () =>
      root.render(
        createElement(
          ModelSourceContext.Provider,
          { value: source },
          createElement(ModelPicker, {
            harness: "claude",
            model: "claude:opus-5.5",
            values: {},
            hideSettings: true,
            onChange: vi.fn(),
            onSettingsChange: vi.fn(),
          }),
        ),
      ),
    );
    await act(async () => trigger().click());
    expect(container.querySelector('[role="listbox"]')?.textContent).toContain("not found");
  });
});

describe("model picker unsupported Reasoning and Fast", () => {
  const plain: AgentModel = {
    id: "cursor:plain",
    harness: "cursor",
    name: "Plain",
    nativeId: "plain",
    settings: [],
  };

  it("shows no Reasoning or Fast on the trigger or in the menu for a model without them", async () => {
    setHarnessModels("cursor", [plain]);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: plain.id,
          values: { effort: "high", fast: "true" },
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    // Stale saved values for settings the model lacks must not surface.
    expect(trigger().querySelector("[data-model-effort]")).toBeNull();
    expect(trigger().querySelector("[data-model-fast]")).toBeNull();
    await act(async () => trigger().click());
    const rows = [...container.querySelectorAll('[role="menuitem"]')].map((row) =>
      row.textContent?.trim(),
    );
    expect(rows.some((row) => row?.startsWith("Fast"))).toBe(false);
    expect(rows.some((row) => row?.startsWith("Reasoning"))).toBe(false);
  });

  it("renders no control pills for a model without Reasoning or Fast", async () => {
    setHarnessModels("cursor", [plain]);
    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "cursor",
          model: plain.id,
          values: { fast: "true" },
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector("[data-model-control], button")).toBeNull();
  });

  it("shows Fast alone when only Fast is supported, and toggles it with one click", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:fast-only",
        harness: "cursor",
        name: "Fast only",
        settings: [toggle("fast", "false")],
      },
    ]);
    const onSettingsChange = vi.fn();
    await act(async () =>
      root.render(
        createElement(ModelControlPills, {
          harness: "cursor",
          model: "cursor:fast-only",
          values: {},
          onSettingsChange,
        }),
      ),
    );
    const pill = container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    expect(pill.getAttribute("aria-label")).toBe("Fast: Off");
    expect(container.textContent).not.toContain("Reasoning");
    await act(async () => pill.click());
    expect(onSettingsChange).toHaveBeenCalledWith({ fast: "true" });
  });

  it("shows Reasoning and Fast on the trigger when the model supports both", async () => {
    setHarnessModels("cursor", [
      {
        id: "cursor:both",
        harness: "cursor",
        name: "Both",
        settings: [effort("low"), toggle("fast", "false")],
      },
    ]);
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness: "cursor",
          model: "cursor:both",
          values: { effort: "high", fast: "true" },
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange: vi.fn(),
        }),
      ),
    );
    expect(trigger().querySelector("[data-model-effort]")?.textContent).toBe("High");
    expect(trigger().querySelector("[data-model-fast]")).not.toBeNull();
  });
});
