// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelOrderSettings } from "./ModelOrderSettings";
import { ModelOrderLimits } from "./ModelOrderLimits";
import { orderDraft } from "../../model/modelRoutingDraft";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import { ModelOrderRow } from "./ModelOrderRow";
import { useOrderSettings } from "./useOrderDraft";
import type { ModelPicker } from "../../../sessions/public/ModelPicker";

let picker: ComponentProps<typeof ModelPicker>;
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
    picker = props;
    return createElement("span", null, "Model picker");
  },
}));
vi.mock("../../../sessions/public/models", () => ({
  defaultModelSettings: () => ({
    effort: "high",
    crossAdvisor: "reserved",
    imageModels: "reserved",
  }),
  resolveModel: () => ({}),
}));
vi.mock("../../../sessions/public/modelSource", () => ({ useModelSource: vi.fn() }));
vi.mock("../../../sessions/public/ModelLabel", () => ({ ModelLabel: () => null }));
vi.mock("../../model/modelProfile", () => ({
  modelProfile: () => ({ intelligence: 4, cost: 2, estimated: true }),
  inferAccountKind: (label: string) => (/work/i.test(label) ? "work" : undefined),
}));
vi.mock("./useOrderDraft", () => ({ useOrderSettings: vi.fn(), useOrderDraft: vi.fn() }));
vi.mock("../../../settings/public/settingsControls", () => ({
  Group: ({ children }: { children: ReactNode }) => createElement("section", null, children),
  Row: ({ label, children }: { label: ReactNode; children: ReactNode }) =>
    createElement("div", null, label, children),
}));
vi.mock("../../../providers/public/providerAccounts", () => ({
  subscribeProviderAccounts: () => () => {},
  providerAccounts: () => [
    { id: "default", label: "Default account" },
    { id: "work", label: "Work login" },
  ],
  defaultProviderAccountId: () => "default",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

it.each([
  { dailyAgentMinutes: 120, usedMinutes: 75, limitReached: false, usageUncertain: false },
  { dailyAgentMinutes: 120, usedMinutes: 125, limitReached: true, usageUncertain: false },
  { dailyAgentMinutes: 120, usedMinutes: 75, limitReached: false, usageUncertain: true },
  { dailyAgentMinutes: 0, usedMinutes: 75, limitReached: false, usageUncertain: true },
])("shows acknowledged machine usage independently of draft limits: %j", async (usage) => {
  const limits = { machineId: "host", machineName: "Workstation", maxRunningTasks: 2, ...usage };
  const draft = orderDraft(
    { ...EMPTY_MODEL_ROUTING, version: 0, updatedAt: 0 },
    { maxRunningTasks: 2, dailyAgentMinutes: 999 },
  );
  await act(() =>
    root.render(createElement(ModelOrderLimits, { draft, usage: limits, onChange: vi.fn() })),
  );
  expect(container.textContent).toContain("Used today");
  expect(container.textContent).toContain(usage.usedMinutes === 125 ? "2h 5m" : "1h 15m");
  expect(container.textContent?.includes("Limit reached")).toBe(usage.limitReached);
  expect(container.textContent?.includes("Today's agent time is incomplete.")).toBe(
    usage.usageUncertain,
  );
  const meter = container.querySelector('[role="meter"]');
  if (usage.dailyAgentMinutes > 0 && !usage.usageUncertain) {
    expect(meter?.getAttribute("aria-valuemax")).toBe("120");
    expect(meter?.getAttribute("aria-valuenow")).toBe(String(Math.min(120, usage.usedMinutes)));
  } else expect(meter).toBeNull();
  expect(container.textContent?.includes(" of 2h 0m")).toBe(usage.dailyAgentMinutes > 0);
  expect(container.textContent?.includes("New work waits until tomorrow")).toBe(
    usage.dailyAgentMinutes > 0 && usage.usageUncertain,
  );
});

function rowProps(): ComponentProps<typeof ModelOrderRow> {
  return {
    entry: {
      id: "a",
      harness: "claude",
      model: "sonnet",
      modelSettings: { effort: "medium" },
      unknownLimit: "use",
    },
    index: 0,
    count: 2,
    percent: "25",
    status: { entryId: "a", leftPercent: 15, skip: "belowLimit" },
    statusLoading: false,
    sortable: {
      setItemRef: vi.fn(),
      onItemPointerDown: vi.fn(),
      onItemKeyDown: vi.fn(),
      draggingId: null,
    } as unknown as ComponentProps<typeof ModelOrderRow>["sortable"],
    onChange: vi.fn(),
    onPercent: vi.fn(),
    onRemove: vi.fn(),
  };
}

it.each([
  { machineId: "host", supported: false },
  { machineId: undefined, supported: true },
])("shows unavailable state without querying when %j", async (props) => {
  await act(() => root.render(createElement(ModelOrderSettings, props)));
  expect(container.textContent).toContain("Model order is unavailable");
  expect(useOrderSettings).not.toHaveBeenCalled();
  expect(container.querySelector("input")).toBeNull();
});

const more = (index = 1) => `[aria-label="More for model ${index}"]`;
async function openMore() {
  await act(() => container.querySelector<HTMLButtonElement>(more())!.click());
}

it("renders one compact line with picker, account, profile, quota and skip reason", async () => {
  await act(() => root.render(createElement(ModelOrderRow, rowProps())));
  expect(picker.presentation).toBe("field");
  expect(container.textContent).toContain("15% left");
  expect(container.textContent).toContain("Below the reserved limit");
  expect(container.textContent).toContain("Default account");
  expect(container.textContent).toContain("4/5 · $$");
  // Rare settings stay behind the overflow control until it opens.
  expect(container.querySelector('input[type="number"]')).toBeNull();
});

it("tags an account with its inferred kind and keeps rare settings in the overflow", async () => {
  const props = rowProps();
  props.entry.providerAccountId = "work";
  await act(() => root.render(createElement(ModelOrderRow, props)));
  expect(container.textContent).toContain("Work login");
  expect(container.textContent).toContain("Work");
  await openMore();
  expect(document.body.textContent).toContain("Keep % for my own use");
  expect(document.body.textContent).toContain("If the limit is unknown");
  expect(document.body.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("25");
});

it("strips delegation defaults on model selection, preserves picker account selection", async () => {
  const props = rowProps();
  await act(() => root.render(createElement(ModelOrderRow, props)));
  await act(() => picker.onChange("codex", "gpt", "work"));
  expect(props.onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      harness: "codex",
      model: "gpt",
      providerAccountId: "work",
      modelSettings: { effort: "high" },
    }),
  );
  await act(() =>
    picker.onSettingsChange({
      effort: "low",
      crossSubagents: "reserved",
      crossSubagentMaxEffort: "reserved",
    }),
  );
  expect(props.onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ modelSettings: { effort: "low" } }),
  );
});

it("clears account when switching to a provider without accounts and hides account field", async () => {
  const props = rowProps();
  props.entry.providerAccountId = "work";
  await act(() => root.render(createElement(ModelOrderRow, props)));
  await act(() => picker.onChange("grok", "grok", "work"));
  expect(props.onChange).toHaveBeenCalledWith(
    expect.objectContaining({ providerAccountId: undefined }),
  );
  await act(() =>
    root.render(
      createElement(ModelOrderRow, {
        ...props,
        entry: { ...props.entry, harness: "grok", providerAccountId: undefined },
      }),
    ),
  );
  expect(container.textContent).not.toContain("Account");
});

it("reorders with the grip only and removes from the overflow", async () => {
  const props = rowProps();
  await act(() => root.render(createElement(ModelOrderRow, props)));
  expect(container.querySelector('[aria-label="Move model 1 down"]')).toBeNull();
  expect(container.querySelector('[aria-label="Reorder model 1"]')).not.toBeNull();
  await openMore();
  await act(() =>
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "Remove model 1")!
      .click(),
  );
  expect(props.onRemove).toHaveBeenCalledOnce();
});

it("distinguishes a genuine unknown quota from loading", async () => {
  const props = rowProps();
  props.status = { entryId: "a" };
  props.statusLoading = false;
  await act(() => root.render(createElement(ModelOrderRow, props)));
  expect(container.textContent).toContain("Limit unknown");
  expect(container.textContent).not.toContain("could not be read");
  props.statusLoading = true;
  await act(() => root.render(createElement(ModelOrderRow, props)));
  expect(container.textContent).toContain("Reading limit");
});

it("shows unavailable rather than unknown when the quota read fails", async () => {
  const props = rowProps();
  props.status = undefined;
  props.statusLoading = false;
  props.statusError = true;
  await act(() => root.render(createElement(ModelOrderRow, props)));
  expect(container.textContent).toContain("Limit unavailable");
  expect(container.textContent).not.toContain("Limit unknown");
});
