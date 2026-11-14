// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SmartSetupAction } from "./SmartSetupAction";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import { applySmartSetup, setupCandidates, type SetupCandidate } from "../../model/smartSetup";
import { planSmartSetup } from "../../model/smartSetupAi";
import { toast } from "../../../../shared/ui/ToastRegion";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

vi.mock("../../../sessions/public/modelSource", () => ({ useModelSource: () => ({}) }));
vi.mock("../../model/smartSetup", () => ({
  setupCandidates: vi.fn(),
  applySmartSetup: vi.fn(),
}));
vi.mock("../../model/smartSetupAi", () => ({ planSmartSetup: vi.fn() }));
vi.mock("../../../../shared/ui/ToastRegion", () => ({ toast: { show: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const candidate = { target: { harness: "codex", model: "gpt" } } as unknown as SetupCandidate;
const plan = { order: [0], pools: [], roles: {} };
const start = () =>
  orderDraft(
    { ...EMPTY_MODEL_ROUTING, version: 1, updatedAt: 0 },
    { maxRunningTasks: 2, dailyAgentMinutes: 0 },
  );

async function mount() {
  const edits: ((draft: OrderDraft) => OrderDraft)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() =>
    root.render(createElement(SmartSetupAction, { onEdit: (operation) => edits.push(operation) })),
  );
  return { edits, container, root };
}

it("plans with localized pool names, applies the plan once and names the planner", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan, plannedBy: "Sol" });
  const next = start();
  vi.mocked(applySmartSetup).mockReturnValue(next);
  const { edits, container } = await mount();
  expect(container.textContent).toBe("Smart setup");
  await act(async () => container.querySelector("button")!.click());
  expect(planSmartSetup).toHaveBeenCalledWith(
    [candidate],
    {
      smartest: "Smartest",
      balanced: "Balanced",
      fast: "Fast",
      work: "Work",
      personal: "Personal",
    },
    { signal: expect.any(AbortSignal) },
  );
  expect(edits).toHaveLength(1);
  const base = start();
  expect(edits[0]!(base)).toBe(next);
  expect(applySmartSetup).toHaveBeenCalledWith(base, [candidate], plan);
});

it("tells the owner who planned the setup once the draft changed", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(() =>
    root.render(createElement(SmartSetupAction, { onEdit: (operation) => operation(start()) })),
  );
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan, plannedBy: "Sol" });
  await act(async () => container.querySelector("button")!.click());
  expect(vi.mocked(toast.show).mock.calls[0]![0]).toMatchObject({ tone: "success" });
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan });
  await act(async () => container.querySelector("button")!.click());
  expect(vi.mocked(toast.show).mock.calls[1]![0]).toMatchObject({ tone: "warning" });
});

it("surfaces a missing catalog and a thrown error through the draft editor", async () => {
  vi.mocked(setupCandidates).mockReturnValue([]);
  const { edits, container } = await mount();
  await act(async () => container.querySelector("button")!.click());
  expect(planSmartSetup).not.toHaveBeenCalled();
  expect(() => edits[0]!(start())).toThrow("No available provider models found");
  vi.mocked(setupCandidates).mockImplementation(() => {
    throw new Error("Catalog failed");
  });
  await act(async () => container.querySelector("button")!.click());
  expect(() => edits[1]!(start())).toThrow("Catalog failed");
  expect(applySmartSetup).not.toHaveBeenCalled();
});

it("shows pending state while planning and drops the result after unmount", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  let finish!: (value: { candidates: SetupCandidate[]; plan: typeof plan }) => void;
  vi.mocked(planSmartSetup).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const { edits, container, root } = await mount();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  const signal = vi.mocked(planSmartSetup).mock.calls[0]![2].signal!;
  await act(() => root.unmount());
  roots.length = 0;
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ candidates: [candidate], plan }));
  expect(edits).toHaveLength(0);
});
