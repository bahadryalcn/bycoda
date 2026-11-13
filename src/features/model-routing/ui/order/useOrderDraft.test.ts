import { clearRetainedTransactions } from "../../model/retainedTransaction";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EMPTY_MODEL_ROUTING,
  HOST_MODEL_ROUTING,
  type ModelRoutingState,
} from "../../../../shared/model/host-contracts/model-routing";
import { remoteRequest } from "../../../connections/public/connections";
import {
  listMachineLimits,
  saveMachineLimits,
  settingsMachines,
  type MachineLimits,
} from "../../../tasks/public/hostSettings";
import { useOrderDraft, useOrderSettings } from "./useOrderDraft";

vi.mock("../../../connections/public/connections", () => ({ remoteRequest: vi.fn() }));
vi.mock("../../../tasks/public/hostSettings", async (original) => ({
  ...(await original<typeof import("../../../tasks/public/hostSettings")>()),
  settingsMachines: vi.fn(),
  listMachineLimits: vi.fn(),
  saveMachineLimits: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const machine = { id: "host", name: "Host", endpoint: "http://localhost", environmentId: "test" };
let hostState: ModelRoutingState;
let hostLimits: MachineLimits;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let editor: ReturnType<typeof useOrderDraft>;

function Harness() {
  const settings = useOrderSettings(machine.id);
  if (!settings.routing.state || !settings.limits.data) return null;
  return createElement(DraftHarness, { settings });
}
function DraftHarness({ settings }: { settings: ReturnType<typeof useOrderSettings> }) {
  editor = useOrderDraft(
    settings,
    { routing: settings.routing.state!, limits: settings.limits.data!.state },
    machine.id,
  );
  return null;
}
async function mount() {
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Harness))),
  );
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(editor).toBeDefined();
  });
}

beforeEach(() => {
  clearRetainedTransactions();
  vi.resetAllMocks();
  hostState = { ...structuredClone(EMPTY_MODEL_ROUTING), version: 4, updatedAt: 1 };
  hostLimits = {
    machineId: "host",
    machineName: "Host",
    maxRunningTasks: 2,
    dailyAgentMinutes: 0,
    usedMinutes: 0,
    limitReached: false,
  };
  vi.mocked(settingsMachines).mockResolvedValue([machine]);
  vi.mocked(listMachineLimits).mockImplementation(async () => [hostLimits]);
  vi.mocked(saveMachineLimits).mockImplementation(async (_machine, limits) => {
    hostLimits = { ...hostLimits, ...limits };
    return hostLimits;
  });
  vi.mocked(remoteRequest).mockImplementation(async (_machine, method, input) => {
    if (method === "modelRouting.get") return { state: hostState };
    if (method === "modelRouting.save") {
      const request = input as { expectedVersion: number; draft: typeof EMPTY_MODEL_ROUTING };
      if (request.expectedVersion !== hostState.version)
        throw new Error("Model routing changed; reload before saving.");
      hostState = { ...request.draft, version: hostState.version + 1, updatedAt: 2 };
      return { state: hostState };
    }
    throw new Error(`Unexpected method ${method}`);
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  editor = undefined!;
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  client.clear();
});

it("saves routing with captured version and work limits through their client", async () => {
  await mount();
  await act(() =>
    editor.change({
      ...editor.draft,
      maxRunMinutes: "30",
      limits: { maxRunningTasks: "3", dailyAgentMinutes: "120" },
    }),
  );
  await act(() => editor.save());
  expect(remoteRequest).toHaveBeenCalledWith(
    "host",
    "modelRouting.save",
    expect.objectContaining({
      expectedVersion: 4,
      draft: expect.objectContaining({ defaultMaxRunMinutes: 30 }),
    }),
    false,
    true,
  );
  expect(saveMachineLimits).toHaveBeenCalledWith(machine, {
    maxRunningTasks: 3,
    dailyAgentMinutes: 120,
  });
  expect(editor.dirty).toBe(false);
  expect(editor.saved).toBe(true);
});

it("keeps unsaved edits on optimistic conflict and reloads latest only explicitly", async () => {
  await mount();
  await act(() => editor.change({ ...editor.draft, maxRunMinutes: "30" }));
  hostState = { ...hostState, version: 5, defaultMaxRunMinutes: 90 };
  await act(() => editor.save());
  expect(editor.conflict).toBe(true);
  expect(editor.draft.maxRunMinutes).toBe("30");
  expect(saveMachineLimits).not.toHaveBeenCalled();
  await act(() => editor.reload());
  expect(editor.draft.maxRunMinutes).toBe("90");
  expect(editor.conflict).toBe(false);
  expect(editor.dirty).toBe(false);
});

it("retains draft if conflict reload fails", async () => {
  await mount();
  await act(() => editor.change({ ...editor.draft, maxRunMinutes: "30" }));
  hostState = { ...hostState, version: 5 };
  await act(() => editor.save());
  vi.mocked(listMachineLimits).mockRejectedValue(new Error("Host disconnected"));
  await act(() => editor.reload());
  expect(editor.draft.maxRunMinutes).toBe("30");
  expect(editor.conflict).toBe(true);
  expect(editor.error).toBe("Host disconnected");
});

it("detects background changes without overwriting dirty draft", async () => {
  await mount();
  await act(() => editor.change({ ...editor.draft, maxRunMinutes: "30" }));
  await act(async () => {
    client.setQueryData([HOST_MODEL_ROUTING, "host"], {
      ...hostState,
      version: 5,
      defaultMaxRunMinutes: 90,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(editor.draft.maxRunMinutes).toBe("30");
  expect(editor.conflict).toBe(true);
  await act(() => editor.save());
  expect(remoteRequest).not.toHaveBeenCalledWith(
    "host",
    "modelRouting.save",
    expect.anything(),
    false,
    true,
  );
});

it("adopts a background update when clean and clears prior success", async () => {
  await mount();
  await act(async () => {
    client.setQueryData([HOST_MODEL_ROUTING, "host"], {
      ...hostState,
      version: 5,
      defaultMaxRunMinutes: 90,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(editor.draft.maxRunMinutes).toBe("90");
  expect(editor.dirty).toBe(false);
});

it("reports partial acknowledgement and retries only unsaved limits", async () => {
  await mount();
  await act(() =>
    editor.change({
      ...editor.draft,
      maxRunMinutes: "30",
      limits: { ...editor.draft.limits, maxRunningTasks: "3" },
    }),
  );
  vi.mocked(saveMachineLimits).mockRejectedValueOnce(new Error("Host disconnected"));
  await act(() => editor.save());
  expect(editor.error).toContain("Model order saved; work limits were not saved.");
  expect(editor.dirty).toBe(true);
  expect(editor.draft.limits.maxRunningTasks).toBe("3");
  expect(editor.conflict).toBe(false);
  await act(() => editor.save());
  expect(
    vi.mocked(remoteRequest).mock.calls.filter((call) => call[1] === "modelRouting.save"),
  ).toHaveLength(1);
  expect(saveMachineLimits).toHaveBeenCalledTimes(2);
  expect(editor.dirty).toBe(false);
});

it("blocks double submission and invalid edits without a request", async () => {
  await mount();
  await act(() =>
    editor.change({ ...editor.draft, limits: { ...editor.draft.limits, maxRunningTasks: "0" } }),
  );
  await act(() => editor.save());
  expect(saveMachineLimits).not.toHaveBeenCalled();
  await act(() =>
    editor.change({ ...editor.draft, limits: { ...editor.draft.limits, maxRunningTasks: "3" } }),
  );
  await act(async () => {
    await Promise.all([editor.save(), editor.save()]);
  });
  expect(saveMachineLimits).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(remoteRequest).mock.calls.filter((call) => call[1] === "modelRouting.save"),
  ).toHaveLength(0);
});
it("keeps the submitted limit draft locked until Host acknowledgement", async () => {
  await mount();
  await act(() =>
    editor.change({
      ...editor.draft,
      limits: { ...editor.draft.limits, dailyAgentMinutes: "180" },
    }),
  );
  let release!: (value: MachineLimits) => void;
  vi.mocked(saveMachineLimits).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let saving!: Promise<void>;
  await act(async () => {
    saving = editor.save();
  });
  expect(editor.pending).toBe(true);
  await act(() =>
    editor.change({
      ...editor.draft,
      limits: { ...editor.draft.limits, dailyAgentMinutes: "240" },
    }),
  );
  expect(editor.draft.limits.dailyAgentMinutes).toBe("180");
  await act(async () => {
    release({ ...hostLimits, dailyAgentMinutes: 180 });
    await saving;
  });
  expect(editor.pending).toBe(false);
  expect(editor.draft.limits.dailyAgentMinutes).toBe("180");
  expect(editor.dirty).toBe(false);
});

it("retains a dirty draft and in-flight save across remount", async () => {
  await mount();
  await act(() => editor.change({ ...editor.draft, maxRunMinutes: "35" }));
  await act(async () => root.render(createElement(QueryClientProvider, { client }, null)));
  editor = undefined!;
  await mount();
  expect(editor.draft.maxRunMinutes).toBe("35");
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    void editor.save();
  });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, null)));
  editor = undefined!;
  await mount();
  expect(editor.pending).toBe(true);
  act(() => {
    void editor.save();
  });
  expect(
    vi.mocked(remoteRequest).mock.calls.filter((call) => call[1] === "modelRouting.save"),
  ).toHaveLength(1);
  await act(async () => finish({ state: { ...hostState, version: 5, defaultMaxRunMinutes: 35 } }));
  expect(editor.pending).toBe(false);
  expect(editor.saved).toBe(true);
});
