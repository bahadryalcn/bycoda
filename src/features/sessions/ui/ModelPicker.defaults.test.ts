// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: () => true,
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

vi.mock("../../../shared/ui/Popover", () => ({
  popupListClassName: "shared-popup-list",
  Popover: ({ children, role, ...props }: { children: ReactNode; role?: string }) =>
    createElement(
      "div",
      { role, "aria-label": (props as { "aria-label"?: string })["aria-label"] },
      children,
    ),
}));

import { ModelPicker, preloadModelPicker } from "./ModelPicker";
import {
  renameProviderAccount,
  saveProviderAccount,
  setDefaultProviderAccount,
} from "../../providers/model/providerAccounts";
import { OPEN_PROVIDER_SETTINGS_EVENT } from "../../providers/public/providerSettingsLink";
import { resetDisabledModels, resetHarnessModelOverlays, setHarnessModels } from "../model/models";
import { loadProjectProviderSettings, pinProjectDefault } from "../model/projectProviders";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await preloadModelPicker();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetDisabledModels();
  resetHarnessModelOverlays();
  setHarnessModels("claude", [
    { id: "claude:opus-5.5", harness: "claude", name: "Opus 5.5", nativeId: "opus-5.5" },
    { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
  ]);
  setHarnessModels("codex", [
    { id: "codex:gpt-6", harness: "codex", name: "GPT 6", nativeId: "gpt-6" },
  ]);
  renameProviderAccount("claude", "default", "personal");
  saveProviderAccount({ id: "account-work", provider: "claude", label: "work" });
  saveProviderAccount({ id: "account-lab", provider: "claude", label: "lab" });
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

const PROJECT = "/repo/app";
const panel = () => container.querySelector<HTMLElement>('[aria-label="Model and settings"]')!;
const click = async (element: Element) => act(async () => (element as HTMLElement).click());
const row = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('[role="option"]')].find((option) =>
    option.textContent?.includes(name),
  )!.parentElement!;
const pinButton = (name: string) =>
  row(name).querySelector<HTMLButtonElement>("[data-model-pin-default]")!;
const providerTab = (prefix: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
    tab.getAttribute("aria-label")?.startsWith(prefix),
  )!;

async function open(props: { project?: string; accountId?: string; harness?: "claude" | "codex" }) {
  const harness = props.harness ?? "claude";
  await act(async () =>
    root.render(
      createElement(ModelPicker, {
        harness,
        model: harness === "claude" ? "claude:sonnet-5" : "codex:gpt-6",
        values: {},
        project: props.project,
        accountId: props.accountId,
        accountChoices: true,
        onChange: vi.fn(),
        onSettingsChange: vi.fn(),
      }),
    ),
  );
  await click(container.querySelector("button")!);
}

describe("model panel defaults", () => {
  it("marks the default on the rail, the account and the model row", async () => {
    pinProjectDefault(PROJECT, "claude", "claude:opus-5.5", "account-work");
    await open({ project: PROJECT, accountId: "account-work" });
    expect(providerTab("Claude Code").getAttribute("aria-label")).toBe(
      "Claude Code · Default: Claude Code › work › Opus 5.5",
    );
    expect(
      providerTab("Claude Code").querySelector("[data-model-default-provider]"),
    ).not.toBeNull();
    expect(row("Opus 5.5").querySelector("[data-model-default]")).not.toBeNull();
    expect(row("Sonnet 5").querySelector("[data-model-default]")).toBeNull();
    expect(pinButton("Opus 5.5").getAttribute("aria-pressed")).toBe("true");
  });

  it("points at the default's account from another account", async () => {
    pinProjectDefault(PROJECT, "claude", "claude:opus-5.5", "account-work");
    await open({ project: PROJECT, accountId: "account-lab" });
    expect(row("Opus 5.5").querySelector("[data-model-default]")).toBeNull();
    const menu = panel().querySelector<HTMLButtonElement>("[data-model-account-menu]")!;
    expect(menu.getAttribute("aria-label")).toBe("Account: lab · Default: work");
    expect(menu.querySelector("[data-model-default-elsewhere]")).not.toBeNull();
    await click(menu);
    const marked = panel().querySelectorAll("[data-model-default-account]");
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('[role="radio"]')?.textContent).toContain("work");
  });

  it("badges the default provider while another provider is open", async () => {
    pinProjectDefault(PROJECT, "claude", "claude:opus-5.5", "account-work");
    await open({ project: PROJECT, harness: "codex" });
    expect(
      providerTab("Claude Code").querySelector("[data-model-default-provider]"),
    ).not.toBeNull();
    expect(providerTab("Codex").querySelector("[data-model-default-provider]")).toBeNull();
  });

  it("pins the browsed account and model for the project, and unpins it again", async () => {
    setDefaultProviderAccount("claude", "account-work");
    await open({ project: PROJECT, accountId: "account-lab" });
    await click(pinButton("Sonnet 5"));
    expect(loadProjectProviderSettings(PROJECT)).toMatchObject({
      defaultHarness: "claude",
      defaultModel: "claude:sonnet-5",
      defaultAccount: "account-lab",
    });
    expect(row("Sonnet 5").querySelector("[data-model-default]")).not.toBeNull();
    await click(pinButton("Sonnet 5"));
    expect(loadProjectProviderSettings(PROJECT)).toEqual({});
  });

  it("shows no project marks or pin without a project", async () => {
    await open({ project: "~" });
    expect(panel().querySelector("[data-model-pin-default]")).toBeNull();
    expect(panel().querySelector("[data-model-default-provider]")).toBeNull();
  });

  it("opens Provider settings from the panel footer and closes the panel", async () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_PROVIDER_SETTINGS_EVENT, listener);
    await open({ project: PROJECT });
    await click(panel().querySelector("[data-model-provider-settings]")!);
    window.removeEventListener(OPEN_PROVIDER_SETTINGS_EVENT, listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Model and settings"]')).toBeNull();
  });
});
