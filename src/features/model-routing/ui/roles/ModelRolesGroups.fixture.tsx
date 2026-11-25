// @vitest-environment happy-dom
import { Button } from "../../../../shared/ui/Button";
import { NativeSelect } from "../../../../shared/ui/Select";
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingState,
} from "../../../../shared/model/host-contracts/model-routing";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import { ModelRolesGroups } from "./ModelRolesGroups";
import { ModelChoiceField, type ModelChoiceFieldProps } from "../choice/ModelChoiceField";

const mocks = vi.hoisted(() => ({ routing: vi.fn(), resolve: vi.fn() }));
vi.mock("../../model/modelRoutingClient", () => ({
  useModelRouting: mocks.routing,
  resolveModelRouting: mocks.resolve,
}));
vi.mock("../../../../shared/ui/settings", () => ({
  SettingsFeedback: ({
    children,
    action,
  }: {
    children: ReactNode;
    action?: { label: string; onClick: () => void };
  }) => (
    <p>
      {children}
      {action ? <button onClick={action.onClick}>{action.label}</button> : null}
    </p>
  ),
  Group: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <section>
      {title}
      {children}
    </section>
  ),
  Row: ({
    label,
    children,
    feedback,
  }: {
    label: ReactNode;
    children: ReactNode;
    feedback?: ReactNode;
  }) => (
    <section data-role-row>
      <div data-role-label>{label}</div>
      {children}
      {feedback}
    </section>
  ),
}));
vi.mock("../../../../shared/ui/SegmentedControl", () => ({
  SegmentedControl: ({
    options,
    onValueChange,
    value,
  }: {
    options: { value: string; label: string; disabled?: boolean }[];
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <div>
      {options.map((option) => (
        <Button
          key={option.value}
          disabled={option.disabled}
          aria-pressed={value === option.value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  ),
}));
vi.mock("../../../../shared/ui/Select", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../shared/ui/Select")>()),
  Select: ({
    options,
    value,
    onValueChange,
    disabled,
  }: {
    options: { value: string; label: string; disabled?: boolean }[];
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <NativeSelect
      aria-label="Model pool"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </NativeSelect>
  ),
}));
vi.mock("../../../sessions/public/models", () => ({
  defaultModelId: () => "gpt-test",
  resolveModel: () => ({}),
  defaultModelSettings: () => ({ effort: "high", crossAdvisor: "bad" }),
}));
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: ({
    onChange,
    onSettingsChange,
    presentation,
  }: {
    onChange: (harness: string, model: string, account?: string) => void;
    onSettingsChange: (settings: Record<string, string>) => void;
    presentation: string;
  }) => (
    <div data-presentation={presentation}>
      <Button onClick={() => onChange("claude", "sonnet", "account-2")}>Pick target</Button>
      <Button
        onClick={() =>
          onSettingsChange({
            effort: "low",
            ...Object.fromEntries(MODEL_ROUTING_DELEGATION_KEYS.map((key) => [key, "bad"])),
          })
        }
      >
        Set options
      </Button>
    </div>
  ),
}));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let state: ModelRoutingState;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state = {
    ...structuredClone(EMPTY_MODEL_ROUTING),
    version: 7,
    updatedAt: 0,
    pools: [{ id: "p", name: "Named pool", entryIds: ["e"] }],
  };
  mocks.routing.mockImplementation(() => ({
    state,
    supported: true,
    loading: false,
    refetch: async () => ({ data: state, isError: false }),
  }));
  mocks.resolve.mockResolvedValue({
    ok: true,
    target: { harness: "codex", model: "live-model", modelSettings: {} },
    source: { kind: "order", entryId: "e" },
    skipped: [],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  client.clear();
});
async function render(node: ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function click(text: string, scope: ParentNode = container) {
  const button = Array.from(scope.querySelectorAll("button")).find(
    (item) => item.textContent === text,
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function choose(row: ParentNode, value: string) {
  const select = row.querySelector("select")!;
  expect(select, value).toBeTruthy();
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function selected(row: ParentNode) {
  const select = row.querySelector("select")!;
  return select.options[select.selectedIndex]?.textContent;
}
function field(overrides: Partial<ModelChoiceFieldProps> = {}) {
  return (
    <ModelChoiceField
      routingRole={overrides.routingRole ?? "task.worker"}
      value={undefined}
      onChange={vi.fn()}
      machineId="host"
      supported
      allowDefault
      fixed={<span>Own picker</span>}
      {...overrides}
    />
  );
}

it("renders only the fixed slot without capability or machine, and undefined uses Fixed", async () => {
  await render(field({ supported: false }));
  expect(container.textContent).toBe("Own picker");
  expect(mocks.routing).not.toHaveBeenCalled();
  await render(field({ machineId: undefined }));
  expect(container.textContent).toBe("Own picker");
  await render(field());
  expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Fixed");
  await render(field({ allowDefault: false }));
  expect(container.textContent).not.toContain("Default");
});
it("maps Any model to the main order, lists named groups, and preserves missing groups", async () => {
  const onChange = vi.fn();
  await render(field({ onChange }));
  await click("Any model");
  expect(onChange).toHaveBeenLastCalledWith({ kind: "order" });
  await render(field({ value: { kind: "pool", poolId: "gone" }, onChange }));
  expect(container.textContent).toContain("Deleted group");
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "p";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith({ kind: "pool", poolId: "p" });
  await act(async () => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith({ kind: "order" });
});
it("resolves Default and opens Models without changing form choice", async () => {
  const onManage = vi.fn();
  await render(field({ value: { kind: "default" }, onManage }));
  expect(container.textContent).toContain("Now usesLive Model");
  expect(mocks.resolve).toHaveBeenCalledWith("host", {
    role: "task.worker",
    choice: { kind: "default" },
    fixed: undefined,
  });
  await click("Manage models");
  expect(onManage).toHaveBeenCalledOnce();
});
it.each([
  ["notConfigured", "Uses the item's own model."],
  ["noEligibleEntry", "Runs wait for an eligible model."],
])("shows nonblocking %s resolution", async (reason, wording) => {
  mocks.resolve.mockResolvedValue({ ok: false, reason, skipped: [] });
  await render(field({ value: { kind: "default" } }));
  expect(container.textContent).toContain(wording);
  expect(container.querySelector("button")?.disabled).toBe(false);
});
it("handles resolution errors without disabling choice", async () => {
  mocks.resolve.mockRejectedValue(new Error("offline"));
  await render(field({ value: { kind: "default" } }));
  expect(container.textContent).toContain("You can still edit this choice.");
});
let latest: OrderDraft;
function Groups({
  initial,
  live = true,
  disabled = false,
}: {
  initial: OrderDraft;
  live?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- expose the committed fixture draft to test assertions outside React
  useEffect(() => {
    // Keep the test's observable draft in sync after React commits the fixture.
    latest = draft;
  }, [draft]);
  return (
    <ModelRolesGroups
      machineId="host"
      draft={draft}
      savedVersion={7}
      live={live}
      disabled={disabled}
      onChange={setDraft}
    />
  );
}
const NO_LIMITS = { maxRunningTasks: 2, dailyAgentMinutes: 0 };
const draftOf = (overrides: Partial<ModelRoutingState> = {}) =>
  orderDraft({ ...state, ...overrides }, NO_LIMITS);
const entry = {
  id: "e",
  harness: "codex",
  model: "m",
  modelSettings: {},
  unknownLimit: "use",
} as const;
const rowOf = (label: string) =>
  Array.from(container.querySelectorAll("[data-role-row]")).find((row) =>
    row.querySelector("[data-role-label]")?.textContent?.startsWith(label),
  )!;

it("groups all roles and stores fixed targets in the draft without delegation keys", async () => {
  await render(<Groups initial={draftOf()} />);
  expect(container.textContent).toContain("Unattended work");
  expect(container.textContent).toContain("Assistant and voice");
  expect(container.textContent).toContain("Helper models");
  const row = rowOf("Task worker");
  await choose(row, "fixed");
  await click("Pick target", row);
  await click("Set options", row);
  expect(row.querySelector('[data-presentation="field"]')).toBeTruthy();
  expect(latest.routing.roles["task.worker"]).toEqual({
    kind: "fixed",
    target: {
      harness: "claude",
      model: "sonnet",
      providerAccountId: "account-2",
      modelSettings: { effort: "low" },
    },
  });
  expect(latest.routing.pools).toEqual(state.pools);
});

it("shows the no-fallback hint only while a job is Fixed", async () => {
  await render(<Groups initial={draftOf()} />);
  const noFallback = () => rowOf("Task worker").textContent?.includes("No fallback:");
  expect(noFallback()).toBe(false);
  await choose(rowOf("Task worker"), "fixed");
  expect(noFallback()).toBe(true);
  await choose(rowOf("Task worker"), "order");
  expect(noFallback()).toBe(false);
});

it("deletes a non-helper role switched to Any model, in order", async () => {
  state.roles = { "task.worker": { kind: "pool", poolId: "p" } };
  await render(<Groups initial={draftOf({ roles: state.roles })} />);
  const row = rowOf("Task worker");
  expect(selected(row)).toBe("Group: Named pool");
  await choose(row, "order");
  expect(latest.routing.roles).toEqual({});
  expect(selected(row)).toBe("Any model, in order");
});

it("offers a group that exists only in the draft", async () => {
  const draft = draftOf();
  draft.routing.pools = [...draft.routing.pools, { id: "fresh", name: "Fresh pool", entryIds: [] }];
  await render(<Groups initial={draft} />);
  const row = rowOf("Task worker");
  expect(Array.from(row.querySelectorAll("option")).map((item) => item.textContent)).toContain(
    "Group: Fresh pool",
  );
  await choose(row, "pool:fresh");
  expect(latest.routing.roles["task.worker"]).toEqual({ kind: "pool", poolId: "fresh" });
  expect(selected(row)).toBe("Group: Fresh pool");
});

it("keeps a role bound to a missing group visible instead of dropping it", async () => {
  const draft = draftOf({ roles: { "task.worker": { kind: "pool", poolId: "gone" } } });
  await render(<Groups initial={draft} />);
  expect(rowOf("Task worker").textContent).toContain("Deleted group");
  expect(latest.routing.roles["task.worker"]).toEqual({ kind: "pool", poolId: "gone" });
});

it("shows Automatic for helpers and keeps explicit Model order, then resets", async () => {
  await render(<Groups initial={draftOf()} />);
  const row = rowOf("Title");
  expect(selected(row)).toBe("Automatic");
  await choose(row, "order");
  expect(latest.routing.roles["text.title"]).toEqual({ kind: "order" });
  await choose(row, "automatic");
  expect(latest.routing.roles["text.title"]).toBeUndefined();
  expect("text.title" in latest.routing.roles).toBe(false);
});

it("describes helper fallback when every entry is ineligible", async () => {
  mocks.resolve.mockResolvedValue({ ok: false, reason: "noEligibleEntry", skipped: [] });
  await render(
    <Groups initial={draftOf({ entries: [entry], roles: { "text.title": { kind: "order" } } })} />,
  );
  const row = rowOf("Title");
  expect(row.textContent).toContain("Automatic uses this helper's own model selection.");
  expect(row.textContent).not.toContain("Runs wait");
});

it("does not claim the helper's own model when the preview fails or is slow", async () => {
  const roles = { "text.title": { kind: "order" } } as const;
  mocks.resolve.mockRejectedValue(new Error("offline"));
  await render(<Groups initial={draftOf({ entries: [entry], roles })} />);
  const failed = rowOf("Title").textContent;
  expect(failed).toContain("Current model could not be checked.");
  expect(failed).not.toContain("helper's own model selection");

  // A Host slower than the old 500 ms deadline still gets to answer.
  client.clear();
  mocks.resolve.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: "noEligibleEntry", skipped: [] }), 700),
      ),
  );
  await render(<Groups initial={draftOf({ entries: [entry], roles })} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  const slow = rowOf("Title").textContent;
  expect(slow).toContain("Automatic uses this helper's own model selection.");
  expect(slow).not.toContain("could not be checked");
});

it("says which model every job uses now, on the order and on groups, only while live", async () => {
  const draft = draftOf({
    entries: [entry],
    pools: [{ id: "p", name: "Named pool", entryIds: ["e"] }],
    roles: { "task.reviewer": { kind: "pool", poolId: "p" } },
  });
  mocks.resolve.mockResolvedValue({
    ok: true,
    target: { harness: "codex", model: "m", modelSettings: {} },
    skipped: [],
  });
  await render(<Groups initial={draft} />);
  await act(async () => {});
  expect(rowOf("Task worker").textContent).toContain("Now uses");
  expect(rowOf("Task reviewer").textContent).toContain("Now uses");
  mocks.resolve.mockClear();
  await render(<Groups initial={draft} live={false} />);
  expect(container.textContent).not.toContain("Now uses");
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("shows no preview and asks no Host while the draft has no models", async () => {
  await render(<Groups initial={draftOf()} />);
  expect(container.textContent).not.toContain("Now uses");
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("disables every choice while a save is pending", async () => {
  await render(<Groups initial={draftOf()} disabled />);
  const selects = Array.from(container.querySelectorAll("select"));
  expect(selects.length).toBeGreaterThan(0);
  expect(selects.every((select) => select.disabled)).toBe(true);
});
