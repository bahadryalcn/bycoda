// @vitest-environment happy-dom
import { act, createElement, type CSSProperties, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAdvisor, encodeSubagents } from "../../../shared/model/host-contracts/delegation";

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
  Popover: ({
    children,
    role,
    kind,
    className,
    tabIndex,
    onKeyDown,
    ...props
  }: {
    children: ReactNode;
    role?: string;
    kind?: string;
    className?: string;
    tabIndex?: number;
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
    minHeight?: number;
    maxHeight?: number;
    style?: CSSProperties;
    anchor?: unknown;
    side?: string;
    "aria-label"?: string;
    "data-model-picker"?: boolean;
  }) =>
    createElement(
      "div",
      {
        role: kind === "dialog" ? "dialog" : role,
        className,
        tabIndex,
        onKeyDown,
        style: props.style,
        "data-min-height": props.minHeight,
        "data-max-height": props.maxHeight,
        "data-anchor-element":
          props.anchor instanceof HTMLElement ||
          (typeof props.anchor === "object" &&
            props.anchor != null &&
            "current" in props.anchor &&
            props.anchor.current instanceof HTMLElement)
            ? "true"
            : "false",
        "data-side": props.side,
        "aria-label": props["aria-label"],
        "data-model-picker": props["data-model-picker"] ? "" : undefined,
      },
      children,
    ),
}));

import { ModelPicker, preloadModelPicker } from "./ModelPicker";
import { resetDisabledModels, resetHarnessModelOverlays, setHarnessModels } from "../model/models";
import { renameProviderAccount, saveProviderAccount } from "../../providers/model/providerAccounts";
import { idleRateLimits } from "../../providers/model/rateLimits";
import { clearCachedRateLimits, setCachedRateLimits } from "../../providers/model/rateLimitsCache";

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
  clearCachedRateLimits();
  vi.useRealTimers();
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

describe("cross-provider delegation rows", () => {
  const model = (
    harness: "codex" | "opencode" | "cursor" | "pi",
    nativeId: string,
    name: string,
  ) => ({
    id: `${harness}:${nativeId}`,
    harness,
    name,
    nativeId,
  });
  const codexModel = model("codex", "gpt-6.1-sol", "GPT 6.1 Sol");
  const opencodeModel = model("opencode", "openai/gpt-5.6-luna", "Luna");
  const cursorModel = model("cursor", "composer-2", "Composer 2");
  const piModel = model("pi", "pi-default", "Pi Default");

  function seedCatalogs() {
    setHarnessModels("codex", [codexModel]);
    setHarnessModels("opencode", [opencodeModel]);
    setHarnessModels("cursor", [cursorModel]);
    setHarnessModels("pi", [piModel]);
  }

  const PANEL = '[role="dialog"][aria-label="Model and settings"]';

  async function openPanel(
    harness: "codex" | "opencode" | "cursor" | "pi" | "claude",
    id: string,
    values: Record<string, string> = {},
    onSettingsChange = vi.fn(),
  ) {
    await act(async () =>
      root.render(
        createElement(ModelPicker, {
          harness,
          model: id,
          values,
          showEffortSummary: true,
          onChange: vi.fn(),
          onSettingsChange,
        }),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    return showAgents();
  }

  /** The settings column on its Agents tab (shown directly when it holds only delegation). */
  async function showAgents() {
    const column = container.querySelector<HTMLElement>(`${PANEL} [data-model-settings]`)!;
    const tab = [...column.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) =>
      item.textContent?.startsWith("Agents"),
    );
    if (tab) await act(async () => tab.click());
    return column;
  }

  /** The labels of the visible setting blocks (a field's inset name, else the block's first text). */
  const settingLabels = (column: HTMLElement) =>
    [...column.querySelectorAll<HTMLElement>("[data-setting-id]")].map(
      (block) =>
        (block.querySelector("[data-setting-label]") ?? block.querySelector("span"))?.textContent ??
        "",
    );

  /** Opens a delegation setting's column-wide list (Add or its value button) and returns its options. */
  const choices = async (column: HTMLElement, label: string) => {
    const id = label === "Subagents" ? "crossSubagents" : "crossAdvisor";
    if (!container.querySelector(`[data-model-setting-picker="${id}"]`)) {
      const block = column.querySelector<HTMLElement>(`[data-setting-id="${id}"]`)!;
      const open =
        block.querySelector<HTMLButtonElement>("[data-model-setting-add]") ??
        block.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]') ??
        // Subagents without a list: the Custom segment opens the picker.
        [...block.querySelectorAll<HTMLElement>("button, [role=radio], [role=tab]")].find(
          (item) => item.textContent === "Custom",
        )!;
      await act(async () => open.click());
    }
    const picker = container.querySelector<HTMLElement>(`[data-model-setting-picker="${id}"]`)!;
    return [...picker.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  };

  describe("account limits", () => {
    const opus = {
      id: "claude:opus-5.5",
      harness: "claude",
      name: "Opus 5.5",
      nativeId: "opus-5.5",
    } as const;
    const ref = { harness: "claude", model: opus.id, providerAccountId: "default" } as const;

    function writeUsage(usedPercent: number, resetsAt: number) {
      setCachedRateLimits("claude", "default", {
        ...idleRateLimits("claude"),
        status: "ok",
        session: { usedPercent, resetsAt, windowMinutes: 300 },
      });
    }

    async function openWithExhaustedAccount(values: Record<string, string> = {}) {
      seedCatalogs();
      setHarnessModels("claude", [opus]);
      renameProviderAccount("claude", "default", "Personal");
      saveProviderAccount({ id: "work", provider: "claude", label: "Work" });
      writeUsage(100, Date.now() + (4 * 60 + 9) * 60_000);
      const onChange = vi.fn();
      const onSettingsChange = vi.fn();
      await act(async () =>
        root.render(
          createElement(ModelPicker, {
            harness: "claude",
            model: opus.id,
            accountId: "default",
            accountChoices: true,
            values,
            onChange,
            onSettingsChange,
          }),
        ),
      );
      await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
      return { onChange, onSettingsChange };
    }

    it("blocks the account and main model while retaining the marked selection, then reenables them", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
      const { onChange } = await openWithExhaustedAccount();
      // Two accounts collapse behind the account control; open it to see the rows.
      await act(async () =>
        document.querySelector<HTMLButtonElement>("[data-model-account-menu]")!.click(),
      );
      const account = document.querySelector<HTMLButtonElement>(
        '[data-model-account-list] [aria-checked="true"]',
      )!;
      const model = container.querySelector<HTMLButtonElement>(
        '[role="option"][aria-selected="true"]',
      )!;
      expect(account.textContent).toContain("Personal");
      expect(account.textContent).toContain("Limit reached");
      expect(account.disabled).toBe(true);
      expect(model.getAttribute("aria-disabled")).toBe("true");
      expect(model.textContent).toContain("Limit reached · resets in 4h 9m");
      await act(async () => model.click());
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => writeUsage(99, Date.now() + 60_000));
      expect(account.disabled).toBe(false);
      expect(model.getAttribute("aria-disabled")).toBeNull();
      await act(async () => writeUsage(100, Date.now() + 1_000));
      expect(account.disabled).toBe(true);
      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      expect(account.disabled).toBe(false);
      expect(model.getAttribute("aria-disabled")).toBeNull();
    });

    it("blocks an exhausted Custom subagent while retaining the marked saved choice", async () => {
      const { onSettingsChange } = await openWithExhaustedAccount({
        crossSubagents: encodeSubagents([ref])!,
      });
      const subagents = await choices(await showAgents(), "Subagents");
      const saved = subagents.find((option) =>
        option.textContent?.includes("Opus 5.5 · Personal"),
      )!;
      expect(saved.getAttribute("aria-selected")).toBe("true");
      expect(saved.getAttribute("aria-disabled")).toBe("true");
      expect(saved.textContent).toContain("Limit reached");
      const alternative = subagents.find((option) =>
        option.textContent?.includes("Opus 5.5 · Work"),
      )!;
      expect(alternative.getAttribute("aria-disabled")).toBeNull();
      await act(async () => saved.click());
      expect(onSettingsChange).not.toHaveBeenCalled();
      await act(async () => writeUsage(80, Date.now() + 60_000));
      expect(saved.getAttribute("aria-disabled")).toBeNull();
    });

    it("blocks an exhausted advisor while retaining the marked saved choice", async () => {
      const { onSettingsChange } = await openWithExhaustedAccount({
        crossAdvisor: encodeAdvisor(ref)!,
      });
      const advisors = await choices(await showAgents(), "Advisor");
      const saved = advisors.find((option) => option.getAttribute("aria-selected") === "true")!;
      expect(saved.textContent).toContain("Personal");
      expect(saved.getAttribute("aria-disabled")).toBe("true");
      expect(saved.textContent).toContain("Limit reached");
      await act(async () => saved.click());
      expect(onSettingsChange).not.toHaveBeenCalled();
      await act(async () => writeUsage(80, Date.now() + 60_000));
      expect(saved.getAttribute("aria-disabled")).toBeNull();
    });

    it("prevents applying a new subagent that exhausts during editing", async () => {
      const { onSettingsChange } = await openWithExhaustedAccount();
      await act(async () => writeUsage(80, Date.now() + 60_000));
      const subagents = await choices(await showAgents(), "Subagents");
      const personal = subagents.find((option) =>
        option.textContent?.includes("Opus 5.5 · Personal"),
      )!;
      const work = subagents.find((option) => option.textContent?.includes("Opus 5.5 · Work"))!;
      const apply = [
        ...container.querySelectorAll<HTMLButtonElement>("[data-model-subagent-editor] button"),
      ].find((button) => button.textContent === "Apply")!;
      await act(async () => personal.click());
      expect(apply.getAttribute("aria-disabled")).not.toBe("true");
      await act(async () => writeUsage(100, Date.now() + 60_000));
      expect(apply.getAttribute("aria-disabled")).toBe("true");
      await act(async () => apply.click());
      expect(onSettingsChange).not.toHaveBeenCalled();
      await act(async () => personal.click());
      await act(async () => work.click());
      await act(async () => apply.click());
      expect(onSettingsChange).toHaveBeenCalledWith({
        crossSubagents: encodeSubagents([{ ...ref, providerAccountId: "work" }]),
      });
    });
  });

  it.each([
    ["codex", codexModel.id],
    ["opencode", opencodeModel.id],
    ["cursor", cursorModel.id],
    ["pi", piModel.id],
  ] as const)(
    "shows both any-provider settings on the Agents tab for a %s model",
    async (harness, id) => {
      seedCatalogs();
      const column = await openPanel(harness, id);
      const labels = settingLabels(column);
      expect(labels).toContain("Subagents");
      expect(labels).toContain("Advisor");
      expect(column.querySelector('[data-setting-id="crossSubagents"]')).not.toBeNull();
      expect(column.querySelector('[data-setting-id="crossAdvisor"]')).not.toBeNull();
    },
  );

  it("writes the picked subagents as one encoded list, keeping the panel open", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const column = await openPanel("cursor", cursorModel.id, {}, onSettingsChange);
    const codexOption = (await choices(column, "Subagents")).find((option) =>
      option.textContent?.includes("GPT 6.1 Sol"),
    )!;
    expect(codexOption.getAttribute("aria-selected")).toBe("false");
    await act(async () => codexOption.click());
    expect(onSettingsChange).not.toHaveBeenCalled();
    const subagents = await choices(column, "Subagents");
    expect(
      subagents
        .find((option) => option.textContent?.includes("GPT 6.1 Sol"))!
        .getAttribute("aria-selected"),
    ).toBe("true");
    const opencodeOption = subagents.find((option) => option.textContent?.includes("Luna"))!;
    await act(async () => opencodeOption.click());
    expect(onSettingsChange).not.toHaveBeenCalled();
    const picker = container.querySelector('[data-model-setting-picker="crossSubagents"]')!;
    const apply = [...picker.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    )!;
    await act(async () => apply.click());
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossSubagents: encodeSubagents([
        { harness: "codex", model: codexModel.id, providerAccountId: "default" },
        { harness: "opencode", model: opencodeModel.id },
      ]),
    });
    expect(container.querySelector(PANEL)).not.toBeNull();
    expect(container.querySelector("[data-model-subagent-editor]")).toBeNull();
  });

  it("removes picked subagents and discards uncommitted picks on Cancel", async () => {
    seedCatalogs();
    const picked = encodeSubagents([
      { harness: "codex", model: codexModel.id, providerAccountId: "default" },
    ])!;
    const onSettingsChange = vi.fn();
    const column = await openPanel(
      "cursor",
      cursorModel.id,
      { crossSubagents: picked },
      onSettingsChange,
    );
    const block = column.querySelector<HTMLElement>('[data-setting-id="crossSubagents"]')!;
    expect(block.textContent).toContain("GPT 6.1 Sol");
    const remove = block.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!;
    await act(async () => remove.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ crossSubagents: "[]" });

    await act(async () =>
      block.querySelector<HTMLButtonElement>("[data-model-setting-add]")!.click(),
    );
    const picker = container.querySelector<HTMLElement>(
      '[data-model-setting-picker="crossSubagents"]',
    )!;
    const available = picker.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="false"]',
    )!;
    await act(async () => available.click());
    const cancel = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Cancel",
    )!;
    expect(picker.querySelector('[role="listbox"]')!.contains(cancel)).toBe(false);
    await act(async () => cancel.click());
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-model-setting-picker]")).toBeNull();
    expect(container.querySelector(PANEL)).not.toBeNull();
  });

  it("offers the current model and other models as advisor, with Off first", async () => {
    seedCatalogs();
    const column = await openPanel("cursor", cursorModel.id);
    const options = await choices(column, "Advisor");
    expect(options[0].textContent).toBe("Off");
    const labels = options.map((option) => option.textContent ?? "");
    expect(labels.some((label) => label.includes("Composer 2"))).toBe(true);
    expect(labels.some((label) => label.includes("GPT 6.1 Sol"))).toBe(true);
  });

  it("picks the advisor as one encoded ref and keeps the panel open", async () => {
    seedCatalogs();
    const onSettingsChange = vi.fn();
    const column = await openPanel("cursor", cursorModel.id, {}, onSettingsChange);
    const codexOption = (await choices(column, "Advisor")).find((option) =>
      option.textContent?.includes("GPT 6.1 Sol"),
    )!;
    await act(async () => codexOption.click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      crossAdvisor: encodeAdvisor({
        harness: "codex",
        model: codexModel.id,
        providerAccountId: "default",
      }),
    });
    expect(container.querySelector(PANEL)).not.toBeNull();
  });

  it("hides a lone advisor account without rewriting the saved choice", async () => {
    seedCatalogs();
    const saved = encodeAdvisor({ harness: "codex", model: codexModel.id })!;
    const onSettingsChange = vi.fn();
    const column = await openPanel(
      "cursor",
      cursorModel.id,
      { crossAdvisor: saved },
      onSettingsChange,
    );
    const options = await choices(column, "Advisor");
    expect(options.some((choice) => choice.textContent?.includes("Unavailable"))).toBe(false);
    const selected = options.filter((choice) => choice.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("GPT 6.1 Sol");
    expect(selected[0].textContent).not.toContain("Default");
    expect(selected[0].querySelector("[data-model-account-number]")).toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
    await act(async () => selected[0].click());
    expect(onSettingsChange).toHaveBeenLastCalledWith({ crossAdvisor: saved });
  });

  it("shows one unified delegation setting per kind for Claude", async () => {
    seedCatalogs();
    setHarnessModels("claude", [
      { id: "claude:sonnet-5", harness: "claude", name: "Sonnet 5", nativeId: "sonnet-5" },
    ]);
    const labels = settingLabels(await openPanel("claude", "claude:sonnet-5"));
    expect(labels.filter((label) => label === "Subagents")).toHaveLength(1);
    expect(labels.filter((label) => label === "Advisor")).toHaveLength(1);
    expect(labels).not.toContain("Subagent model");
  });
});
