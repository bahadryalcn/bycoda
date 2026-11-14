import { clearRetainedTransactions } from "../../model/retainedTransaction";
// @vitest-environment happy-dom
import { Button } from "../../../../shared/ui/Button";
import { NativeSelect } from "../../../../shared/ui/Select";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingState,
} from "../../../../shared/model/host-contracts/model-routing";
import { ModelRolesSettings } from "./ModelRolesSettings";
import { ModelChoiceField, type ModelChoiceFieldProps } from "../choice/ModelChoiceField";

const mocks = vi.hoisted(() => ({ routing: vi.fn(), resolve: vi.fn(), save: vi.fn() }));
vi.mock("../../model/modelRoutingClient", () => ({
  useModelRouting: mocks.routing,
  resolveModelRouting: mocks.resolve,
}));
vi.mock("../../../settings/public/settingsControls", () => ({
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
    <section aria-label={String(label)}>
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
  clearRetainedTransactions();
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
    save: { mutateAsync: mocks.save, isPending: false },
  }));
  mocks.resolve.mockResolvedValue({
    ok: true,
    target: { harness: "codex", model: "live-model", modelSettings: {} },
    source: { kind: "order", entryId: "e" },
    skipped: [],
  });
  mocks.save.mockImplementation(async ({ draft }: { draft: object }) => ({
    ...draft,
    version: 8,
    updatedAt: 1,
  }));
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
it("maps Pool to main order, lists named pools, and preserves missing pools", async () => {
  const onChange = vi.fn();
  await render(field({ onChange }));
  await click("Pool");
  expect(onChange).toHaveBeenLastCalledWith({ kind: "order" });
  await render(field({ value: { kind: "pool", poolId: "gone" }, onChange }));
  expect(container.textContent).toContain("Missing pool (gone)");
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
it("groups all roles and saves fixed targets using optimistic version without delegation keys", async () => {
  await render(<ModelRolesSettings machineId="host" supported />);
  expect(container.textContent).toContain("Unattended work");
  expect(container.textContent).toContain("Assistant and voice");
  expect(container.textContent).toContain("Helper models");
  const row = container.querySelector('section[aria-label="Task worker"]')!;
  await choose(row, "fixed");
  await click("Pick target", row);
  await click("Set options", row);
  expect(row.querySelector('[data-presentation="field"]')).toBeTruthy();
  await click("Save");
  const input = mocks.save.mock.calls[0][0];
  expect(input.expectedVersion).toBe(7);
  expect(input.draft.roles["task.worker"]).toEqual({
    kind: "fixed",
    target: {
      harness: "claude",
      model: "sonnet",
      providerAccountId: "account-2",
      modelSettings: { effort: "low" },
    },
  });
  expect(input.draft.pools).toEqual(state.pools);
});
it("omits roles switched to Model order", async () => {
  state.roles = { "task.worker": { kind: "pool", poolId: "p" } };
  await render(<ModelRolesSettings machineId="host" supported />);
  const row = container.querySelector('section[aria-label="Task worker"]')!;
  expect(selected(row)).toBe("Pool: Named pool");
  await choose(row, "order");
  await click("Save");
  expect(mocks.save.mock.calls[0][0].draft.roles).toEqual({});
});
it("acknowledges a saved role snapshot without discarding a newer fixed target", async () => {
  state.roles = {
    "task.worker": {
      kind: "fixed",
      target: {
        harness: "codex",
        model: "initial",
        modelSettings: {},
      },
    },
  };
  let resolve!: (value: ModelRoutingState) => void;
  const pending = {
    promise: new Promise<ModelRoutingState>((done) => {
      resolve = done;
    }),
    resolve: (value: ModelRoutingState) => resolve(value),
  };
  mocks.save.mockImplementationOnce(() => pending.promise);
  await render(<ModelRolesSettings machineId="host" supported />);
  const row = container.querySelector('section[aria-label="Task worker"]')!;
  await click("Set options", row);
  await click("Save");
  const submitted = mocks.save.mock.calls[0][0];
  await click("Pick target", row);
  state = { ...state, ...submitted.draft, version: 8, updatedAt: 1 };
  await act(async () => {
    pending.resolve(state);
  });
  expect(container.textContent).toContain("Unsaved changes");
  await click("Save");
  expect(mocks.save.mock.calls[1][0]).toMatchObject({
    expectedVersion: 8,
    draft: {
      roles: {
        "task.worker": {
          kind: "fixed",
          target: {
            harness: "claude",
            model: "sonnet",
            providerAccountId: "account-2",
          },
        },
      },
    },
  });
});
it("keeps edited draft and original version when another save arrives, and reports conflicts", async () => {
  await render(<ModelRolesSettings machineId="host" supported />);
  await choose(container.querySelector('section[aria-label="Task worker"]')!, "pool:p");
  state = { ...state, version: 9 };
  await render(<ModelRolesSettings machineId="host" supported />);
  await click("Save");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Settings changed elsewhere.");
  expect(container.querySelector('section[aria-label="Task worker"] select')).toBeTruthy();
  await click("Use latest settings");
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Model order",
  );
});

it("shows Automatic for helpers and stores explicit Model order, then resets", async () => {
  await render(<ModelRolesSettings machineId="host" supported />);
  mocks.save.mockImplementation(async ({ draft }: { draft: object }) => {
    state = { ...state, ...draft, version: state.version + 1 };
    return state;
  });
  const row = container.querySelector('section[aria-label="Title"]')!;
  expect(selected(row)).toBe("Automatic");
  await choose(row, "order");
  await click("Save");
  expect(mocks.save.mock.calls[0][0].draft.roles["text.title"]).toEqual({ kind: "order" });
  await choose(row, "automatic");
  await click("Save");
  expect(mocks.save.mock.calls[1][0].draft.roles["text.title"]).toBeUndefined();
});

it("describes helper fallback when every entry is ineligible", async () => {
  state.entries = [
    { id: "e", harness: "codex", model: "m", modelSettings: {}, unknownLimit: "use" },
  ];
  state.roles["text.title"] = { kind: "order" };
  mocks.resolve.mockResolvedValue({ ok: false, reason: "noEligibleEntry", skipped: [] });
  await render(<ModelRolesSettings machineId="host" supported />);
  const row = container.querySelector('section[aria-label="Title"]')!;
  expect(row.textContent).toContain("Automatic uses this helper's own model selection.");
  expect(row.textContent).not.toContain("Runs wait");
});

it("keeps rows on the order quiet and previews only pools", async () => {
  state.entries = [
    { id: "e", harness: "codex", model: "m", modelSettings: {}, unknownLimit: "use" },
  ];
  state.pools = [{ id: "p", name: "Named pool", entryIds: ["e"] }];
  state.roles["task.worker"] = { kind: "order" };
  state.roles["task.reviewer"] = { kind: "pool", poolId: "p" };
  mocks.resolve.mockResolvedValue({
    ok: true,
    target: { harness: "codex", model: "m", modelSettings: {} },
    skipped: [],
  });
  await render(<ModelRolesSettings machineId="host" supported />);
  await act(async () => {});
  const worker = container.querySelector('section[aria-label="Task worker"]')!;
  const reviewer = container.querySelector('section[aria-label="Task reviewer"]')!;
  expect(worker.textContent).not.toContain("Now uses");
  expect(reviewer.textContent).toContain("Now uses");
});

it("explains an empty order once and links to it instead of repeating per row", async () => {
  const onOpenOrder = vi.fn();
  await render(<ModelRolesSettings machineId="host" supported onOpenOrder={onOpenOrder} />);
  expect(container.textContent).toContain("Model order is empty");
  expect(container.textContent).not.toContain("No model order configured");
  expect(mocks.resolve).not.toHaveBeenCalled();
  await click("Add models");
  expect(onOpenOrder).toHaveBeenCalledOnce();
});

it("keeps a conflicted draft on failed fresh read and applies a successful retry", async () => {
  let rejectRead!: (error: Error) => void;
  let resolveRead!: (value: { data: ModelRoutingState; isError: boolean }) => void;
  const refetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRead = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
  mocks.routing.mockImplementation(() => ({
    state,
    supported: true,
    loading: false,
    refetch,
    save: { mutateAsync: mocks.save, isPending: false },
  }));
  await render(<ModelRolesSettings machineId="host" supported />);
  const row = container.querySelector('section[aria-label="Task worker"]')!;
  await choose(row, "pool:p");
  state = { ...state, version: 9 };
  await render(<ModelRolesSettings machineId="host" supported />);
  await click("Save");
  expect(mocks.save).not.toHaveBeenCalled();
  await click("Use latest settings");
  await act(async () => rejectRead(new Error("offline")));
  expect(selected(row)).toBe("Pool: Named pool");
  expect(container.textContent).toContain("Model routing could not be loaded.");
  await click("Use latest settings");
  await act(async () => resolveRead({ data: state, isError: false }));
  expect(selected(row)).toBe("Model order");
});

it("offers retry when initial roles read fails", async () => {
  const refetch = vi.fn(async () => ({ data: state, isError: false }));
  mocks.routing.mockReturnValue({
    supported: true,
    state: undefined,
    error: "offline",
    refetch,
    save: { mutateAsync: mocks.save, isPending: false },
  });
  await render(<ModelRolesSettings machineId="host" supported />);
  expect(container.textContent).toContain("Model routing could not be loaded.");
  await click("Try again");
  expect(refetch).toHaveBeenCalledOnce();
});

it("retains a dirty role choice after unmount", async () => {
  await render(<ModelRolesSettings machineId="retention-host" supported />);
  await choose(container.querySelector('section[aria-label="Task worker"]')!, "pool:p");
  await render(null);
  await render(<ModelRolesSettings machineId="retention-host" supported />);
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Pool: Named pool",
  );
});

it("keeps originating Host pending save across remount and isolates another Host", async () => {
  let finish!: (state: ModelRoutingState) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<ModelRolesSettings machineId="host-a" supported />);
  await choose(container.querySelector('section[aria-label="Task worker"]')!, "pool:p");
  await click("Save");
  await render(null);
  await render(<ModelRolesSettings machineId="host-b" supported />);
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Model order",
  );
  await render(<ModelRolesSettings machineId="host-a" supported />);
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Pool: Named pool",
  );
  await click("Save");
  expect(mocks.save).toHaveBeenCalledTimes(1);
  const acknowledged = {
    ...state,
    version: 8,
    roles: { "task.worker": { kind: "pool" as const, poolId: "p" } },
  };
  await act(async () => finish(acknowledged));
  expect(container.textContent).toContain("No unsaved changes");
  await render(<ModelRolesSettings machineId="host-b" supported />);
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Model order",
  );
});
it("preserves a dirty Host draft across failed read and recovery", async () => {
  await render(<ModelRolesSettings machineId="host-a" supported />);
  await choose(container.querySelector('section[aria-label="Task worker"]')!, "pool:p");
  await render(null);
  mocks.routing.mockReturnValueOnce({
    supported: true,
    state: undefined,
    error: "offline",
    refetch: vi.fn(),
    save: { mutateAsync: mocks.save, isPending: false },
  });
  await render(<ModelRolesSettings machineId="host-a" supported />);
  expect(container.textContent).toContain("could not be loaded");
  await render(<ModelRolesSettings machineId="host-a" supported />);
  expect(selected(container.querySelector('section[aria-label="Task worker"]')!)).toBe(
    "Pool: Named pool",
  );
});
