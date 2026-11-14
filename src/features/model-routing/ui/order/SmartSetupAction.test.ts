// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SmartSetupAction } from "./SmartSetupAction";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import { applySmartSetup, setupCandidates, type SetupCandidate } from "../../model/smartSetup";
import { refineSetupCandidates } from "../../model/smartSetupAi";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

vi.mock("../../../sessions/public/modelSource", () => ({ useModelSource: () => ({}) }));
vi.mock("../../model/smartSetup", () => ({
  setupCandidates: vi.fn(),
  applySmartSetup: vi.fn(),
}));
vi.mock("../../model/smartSetupAi", () => ({ refineSetupCandidates: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const candidate = { target: { harness: "codex", model: "gpt" } } as unknown as SetupCandidate;
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

it("refines the candidates and edits the draft once with localized pool names", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(refineSetupCandidates).mockResolvedValue({ candidates: [candidate], refined: true });
  const next = start();
  vi.mocked(applySmartSetup).mockReturnValue(next);
  const { edits, container } = await mount();
  expect(container.textContent).toBe("Smart setup");
  await act(async () => container.querySelector("button")!.click());
  expect(refineSetupCandidates).toHaveBeenCalledWith([candidate], {
    signal: expect.any(AbortSignal),
  });
  expect(edits).toHaveLength(1);
  const base = start();
  expect(edits[0]!(base)).toBe(next);
  expect(applySmartSetup).toHaveBeenCalledWith(base, [candidate], {
    smartest: "Smartest",
    balanced: "Balanced",
    fast: "Fast",
    work: "Work",
    personal: "Personal",
  });
});

it("surfaces a missing catalog and a thrown error through the draft editor", async () => {
  vi.mocked(setupCandidates).mockReturnValue([]);
  const { edits, container } = await mount();
  await act(async () => container.querySelector("button")!.click());
  expect(refineSetupCandidates).not.toHaveBeenCalled();
  expect(() => edits[0]!(start())).toThrow("No available provider models found");
  vi.mocked(setupCandidates).mockImplementation(() => {
    throw new Error("Catalog failed");
  });
  await act(async () => container.querySelector("button")!.click());
  expect(() => edits[1]!(start())).toThrow("Catalog failed");
  expect(applySmartSetup).not.toHaveBeenCalled();
});

it("shows pending state while refining and drops the result after unmount", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  let finish!: (value: { candidates: SetupCandidate[]; refined: boolean }) => void;
  vi.mocked(refineSetupCandidates).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const { edits, container, root } = await mount();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  const signal = vi.mocked(refineSetupCandidates).mock.calls[0]![1].signal!;
  await act(() => root.unmount());
  roots.length = 0;
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ candidates: [candidate], refined: true }));
  expect(edits).toHaveLength(0);
});
