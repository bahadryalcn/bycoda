// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProvidersPage, resetRetainedProvidersPage } from "./ProviderSettings";
import { SettingsSaveBar } from "../../../shared/ui/settings";
import * as harnessUpdates from "../../providers/model/harnessUpdateActions";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  editProviderAccount,
} from "../../providers/model/providerAccounts";

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

function DraftEditor({ wait }: { wait?: Promise<void> }) {
  const [dirty, setDirty] = useState(true);
  const [pending, setPending] = useState(false);
  return createElement(SettingsSaveBar, {
    id: "test-editor",
    title: "Defaults",
    changes: dirty ? [{ id: "effort", label: "Effort" }] : [],
    pending,
    saved: false,
    onSave: async () => {
      setPending(true);
      await wait;
      setDirty(false);
      setPending(false);
    },
    onDiscard: () => setDirty(false),
  });
}

async function render(withPendingChange = false, wait?: Promise<void>) {
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ProvidersPage, { cwd: "/repo" }),
        withPendingChange ? createElement(DraftEditor, { wait }) : null,
      ),
    ),
  );
}

describe("providers scope inheritance", () => {
  it("does not repeat the default designation beside an account named Default", async () => {
    editProviderAccount("claude", DEFAULT_PROVIDER_ACCOUNT_ID, { label: "Default" });
    await render();
    const row = container.querySelector(".provider-account-row")!;
    expect(row.querySelector(".provider-account-name")?.textContent).toBe("Default");
    expect(row.textContent).not.toContain("Default account");
  });

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

it("lists the three Models tabs and keeps provider setup rows mounted across tabs", async () => {
  await render();
  const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((node) => node.textContent?.trim())).toEqual([
    "Background work",
    "Defaults",
    "Providers",
  ]);
  const row = container.querySelector('[data-setting-id="cli-path-codex"]')!;
  expect(row.closest<HTMLElement>("[hidden]")).not.toBeNull();
  await act(async () => tabs.find((node) => node.textContent === "Providers")!.click());
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>(".provider-cli-selector button")]
      .find((button) => button.textContent?.trim().startsWith("Codex"))!
      .click(),
  );
  expect(row.closest("[hidden]")).toBeNull();
  await act(async () => tabs.find((node) => node.textContent === "Defaults")!.click());
  expect(container.querySelector('[data-setting-id="cli-path-codex"]')).toBe(row);
  expect(row.closest<HTMLElement>("[hidden]")).not.toBeNull();
});

it("asks before switching Models tabs while an editor has pending changes", async () => {
  await render(true);
  const providers = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (node) => node.textContent === "Providers",
  )!;
  await act(async () => providers.click());
  expect(providers.getAttribute("aria-selected")).toBe("false");
  expect(document.body.textContent).toContain("Save changes before leaving?");
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent === "Keep editing")!
      .click(),
  );
  expect(providers.getAttribute("aria-selected")).toBe("false");
});

it("waits for the save before leaving a Models tab", async () => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await render(true, wait);
  const providers = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (node) => node.textContent === "Providers",
  )!;
  await act(async () => providers.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent === "Save and leave")!
      .click(),
  );
  expect(providers.getAttribute("aria-selected")).toBe("false");
  await act(async () => finish());
  await vi.waitFor(() => expect(providers.getAttribute("aria-selected")).toBe("true"));
  expect(document.body.textContent).not.toContain("Some changes were not saved.");
});

it("does not offer discard while a save is committing", async () => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await render(true, wait);
  await act(async () =>
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-settings-save-bar="test-editor"] button',
      ),
    ]
      .find((node) => node.textContent === "Save")!
      .click(),
  );
  await act(async () =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((node) => node.textContent === "Providers")!
      .click(),
  );
  expect(document.body.textContent).not.toContain("Discard and leave");
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Save and leave",
    )!.disabled,
  ).toBe(true);
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((node) => node.textContent === "Keep editing")!
      .click(),
  );
  await act(async () => finish());
});

it("validates new account names against the selected provider before sign-in", async () => {
  await render();
  const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === "Add account",
  )!;
  await act(async () => add.click());
  const editor = container.querySelector<HTMLFormElement>('[data-settings-part="account-editor"]')!;
  const input = editor.querySelector("input")!;
  expect(editor.textContent).toContain("Account name");
  expect(editor.textContent).toContain("Enter an account name");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Default account",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(editor.textContent).toContain("An account with this name already exists");
  const submit = container.querySelector<HTMLButtonElement>(
    `button[form="${editor.id}"][type="submit"]`,
  )!;
  expect(submit.getAttribute("aria-disabled")).toBe("true");
  const cancel = [...editor.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(document.activeElement).toBe(add);
});

it("does not claim every installed CLI is current from a checked subset", async () => {
  const snapshot = {
    checking: false,
    runs: {},
    checks: [
      {
        harness: "claude" as const,
        installed: "2.1.0",
        latest: "2.1.0",
        status: "current" as const,
      },
    ],
  };
  const spy = vi.spyOn(harnessUpdates, "getHarnessUpdateSnapshot").mockReturnValue(snapshot);
  try {
    await render();
    const cli = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (node) => node.textContent === "Providers",
    )!;
    await act(async () => cli.click());
    const summary = container.querySelector("#setting-harness-updates")!;
    expect(summary.textContent).toContain("Up to date");
    expect(summary.textContent).not.toContain("All CLIs are up to date");
  } finally {
    spy.mockRestore();
  }
});
