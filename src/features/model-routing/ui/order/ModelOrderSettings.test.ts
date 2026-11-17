// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelOrderSettings } from "./ModelOrderSettings";
import { ModelOrderLimits } from "./ModelOrderLimits";
import { orderDraft, prepareOrderSave, type OrderDraft } from "../../model/modelRoutingDraft";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import { ModelOrderRow } from "./ModelOrderRow";
import { useOrderDraft, useOrderSettings } from "./useOrderDraft";
import { pendingSources } from "../../../../shared/ui/settings/pendingChanges";
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
vi.mock("../../model/modelRoutingClient", () => ({
  useModelRoutingStatus: () => ({
    entries: [],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  resolveModelRouting: async () => ({ ok: false, reason: "notConfigured", skipped: [] }),
}));
vi.mock("../../../../shared/ui/settings", async () => {
  const { SettingsSaveBar } = await import("../../../../shared/ui/settings/SettingsSaveBar");
  return {
    SettingsSaveBar,
    SettingsFeedback: ({ children }: { children: ReactNode }) => createElement("p", null, children),
    Group: ({
      title,
      action,
      children,
    }: {
      title?: ReactNode;
      action?: ReactNode;
      children: ReactNode;
    }) =>
      createElement(
        "section",
        null,
        title ? createElement("h3", null, title) : null,
        action,
        children,
      ),
    Row: ({ label, children }: { label: ReactNode; children: ReactNode }) =>
      createElement("div", null, label, children),
  };
});
vi.mock("../../../providers/public/providerAccounts", () => ({
  subscribeProviderAccounts: () => () => {},
  providerAccounts: () => [
    { id: "default", label: "Default account" },
    { id: "work", label: "Work login" },
    { id: "own", label: "Own login", kind: "personal" },
  ],
  defaultProviderAccountId: () => "default",
  supportsProviderAccounts: (harness: string) => ["claude", "codex", "grok"].includes(harness),
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

it("shows one compact cap table with unlimited placeholders and saved provider rows only", async () => {
  const limits = {
    machineId: "host",
    machineName: "Workstation",
    maxRunningTasks: 2,
    dailyAgentMinutes: 0,
    usedMinutes: 0,
    limitReached: false,
    usageUncertain: false,
  };
  const draft = orderDraft(
    {
      ...EMPTY_MODEL_ROUTING,
      version: 0,
      updatedAt: 0,
      workCaps: { providers: { codex: { daily: { tokens: 500 } } } },
    } as never,
    { maxRunningTasks: 2, dailyAgentMinutes: 0 },
  );
  await act(() =>
    root.render(createElement(ModelOrderLimits, { draft, usage: limits, onChange: vi.fn() })),
  );
  expect(container.querySelectorAll("table")).toHaveLength(1);
  expect(container.textContent).toContain("All providers");
  const inputs = [...container.querySelectorAll<HTMLInputElement>("table input")];
  expect(inputs.every((input) => input.placeholder === "No limit" || input.value !== "")).toBe(
    true,
  );
  expect(container.querySelector("table button")).toBeNull();
  expect(container.querySelectorAll("tbody tr").length).toBeLessThan(4);
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
  expect(container.textContent).toContain("Model routing is not available");
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

// The whole Background work screen edits one draft and saves it once.
const NO_LIMITS = { maxRunningTasks: 2, dailyAgentMinutes: 0 };
const modelEntry = (id: string, harness: string, providerAccountId?: string) => ({
  id,
  harness,
  model: "m",
  modelSettings: {},
  unknownLimit: "use" as const,
  ...(providerAccountId ? { providerAccountId } : {}),
});
const saves: ReturnType<typeof prepareOrderSave>[] = [];
let editorDirty = false;

async function renderScreen(
  entries: ReturnType<typeof modelEntry>[],
  pools: object[] = [],
  waitForSave?: Promise<void>,
) {
  const routing = {
    ...EMPTY_MODEL_ROUTING,
    version: 3,
    updatedAt: 0,
    entries,
    pools,
  } as never;
  const initial = orderDraft(routing, NO_LIMITS);
  vi.mocked(useOrderSettings).mockReturnValue({
    routing: { loading: false, state: routing },
    limits: { isPending: false, data: { state: NO_LIMITS }, refetch: vi.fn() },
  } as never);
  vi.mocked(useOrderDraft).mockImplementation((() => {
    const [draft, setDraft] = useState<OrderDraft>(initial);
    editorDirty = JSON.stringify(draft) !== JSON.stringify(initial);
    const change = (next: OrderDraft) => setDraft(next);
    return {
      draft,
      base: initial,
      dirty: editorDirty,
      pending: false,
      saved: false,
      validation: "",
      error: "",
      conflict: false,
      change,
      edit: (operation: (current: OrderDraft) => OrderDraft) => change(operation(draft)),
      save: async () => {
        await waitForSave;
        saves.push(prepareOrderSave(draft));
      },
      revert: vi.fn(),
      reload: vi.fn(),
    };
  }) as never);
  const client = new QueryClient();
  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ModelOrderSettings, { machineId: "host", supported: true }),
      ),
    ),
  );
}
const headings = () => [...container.querySelectorAll("h3")].map((item) => item.textContent);

it("returns the Host save promise to the shared leave guard", async () => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await renderScreen([modelEntry("save", "codex")], [], wait);
  const input = container.querySelector<HTMLInputElement>('[aria-label="Max concurrent tasks"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "3");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const saving = pendingSources()
    .find((source) => source.id.startsWith("background-work:"))!
    .save();
  expect(saving).toBeInstanceOf(Promise);
  finish();
  await saving;
});

it("starts an empty catalog with setup instead of the role assignment form", async () => {
  await renderScreen([]);
  expect(container.textContent).toContain("Choose the models for unattended work");
  expect(container.textContent).toContain("Plan with AI");
  const roles = container.querySelector<HTMLDetailsElement>("details");
  expect(roles).not.toBeNull();
  expect(roles?.open).toBe(false);
});

it("splits models into work, personal and shared lists by account kind", async () => {
  saves.length = 0;
  await renderScreen([
    modelEntry("s1", "grok"),
    modelEntry("w1", "claude", "work"),
    modelEntry("p1", "codex", "own"),
    modelEntry("s2", "claude"),
  ]);
  expect(headings().slice(0, 3)).toEqual(["Work accounts", "Personal accounts", "Shared models"]);
  expect(container.querySelectorAll('[aria-label^="More for model"]')).toHaveLength(4);
  // Each list numbers its own rows from 1; shared holds the grok and the default-account model.
  const labels = [...container.querySelectorAll('[aria-label^="More for model"]')].map((item) =>
    item.getAttribute("aria-label"),
  );
  expect(labels).toEqual([
    "More for model 1",
    "More for model 1",
    "More for model 1",
    "More for model 2",
  ]);
});

it("uses one All models title when no account has a kind", async () => {
  await renderScreen([modelEntry("s1", "grok"), modelEntry("s2", "claude")]);
  expect(headings()[0]).toBe("All models");
  expect(headings()).not.toContain("Work accounts");
  expect(headings()).not.toContain("Personal accounts");
  expect(headings()).not.toContain("Shared models");
});

it("saves a job choice and a model edit together with one Save", async () => {
  saves.length = 0;
  await renderScreen(
    [modelEntry("w1", "claude", "work"), modelEntry("s1", "grok")],
    [{ id: "p", name: "Fast pool", entryIds: ["s1"] }],
  );
  const choice = container.querySelector<HTMLElement>(
    'button[aria-label^="Model for Task worker"]',
  );
  expect(choice, "Task worker choice").toBeTruthy();
  await act(async () => choice!.click());
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes("Fast pool"),
  );
  expect(option, "Fast pool option").toBeTruthy();
  await act(async () => option!.click());
  await act(() => picker.onChange("codex", "gpt-new"));
  expect(container.textContent).toContain("unsaved change");
  const save = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === "Save",
  );
  expect(save, "Save").toBeTruthy();
  await act(async () => save!.click());
  expect(saves).toHaveLength(1);
  expect(saves[0]!.routing.roles["task.worker"]).toEqual({ kind: "pool", poolId: "p" });
  expect(saves[0]!.routing.entries.some((item) => item.model === "gpt-new")).toBe(true);
  expect(
    [...container.querySelectorAll("button")].filter((item) => item.textContent === "Save"),
  ).toHaveLength(1);
});
