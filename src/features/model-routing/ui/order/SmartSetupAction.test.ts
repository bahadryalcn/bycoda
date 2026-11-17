// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { SmartSetupAction } from "./SmartSetupAction";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import {
  applySmartSetup,
  rulePlan,
  setupCandidates,
  type SetupCandidate,
} from "../../model/smartSetup";
import { planSmartSetup } from "../../model/smartSetupAi";
import { localSetupCatalog } from "../../model/smartSetupCatalog";
import { toast } from "../../../../shared/ui/ToastRegion";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

vi.mock("../../../sessions/public/modelSource", () => ({ useModelSource: () => ({}) }));
vi.mock("../../model/smartSetup", () => ({
  setupCandidates: vi.fn(),
  applySmartSetup: vi.fn(),
  rulePlan: vi.fn(),
}));
vi.mock("../../model/smartSetupAi", () => ({ planSmartSetup: vi.fn() }));
vi.mock("../../model/smartSetupCatalog", () => ({
  localSetupCatalog: vi.fn(async () => undefined),
}));
vi.mock("../../../../shared/ui/ToastRegion", () => ({ toast: { show: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.mocked(localSetupCatalog).mockResolvedValue(undefined);
});

const candidate = { target: { harness: "codex", model: "gpt" } } as unknown as SetupCandidate;
const plan = { order: [0], pools: [], roles: {} };
const names = {
  smartest: "Smartest",
  balanced: "Balanced",
  fast: "Fast",
  work: "Work",
  personal: "Personal",
};
const start = () =>
  orderDraft(
    { ...EMPTY_MODEL_ROUTING, version: 1, updatedAt: 0 },
    { maxRunningTasks: 2, dailyAgentMinutes: 0 },
  );

/** `run` applies each edit to a draft at once, like the draft editor does; otherwise they are collected. */
async function mount(run = false) {
  const edits: ((draft: OrderDraft) => OrderDraft)[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(SmartSetupAction, {
          onEdit: (operation) => {
            edits.push(operation);
            if (run) operation(start());
          },
        }),
      ),
    ),
  );
  return { edits, container, root };
}
const primary = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Smart setup",
  )!;
async function planWithAi(container: HTMLElement) {
  const item = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === "Plan with AI",
  );
  expect(item, "Plan with AI").toBeTruthy();
  await act(async () => item!.click());
}

it("fills the draft with the researched rules at once, without asking a model", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(rulePlan).mockReturnValue(plan);
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const catalog = { models: { codex: [{ id: "gpt", name: "GPT" }] } };
  vi.mocked(localSetupCatalog).mockResolvedValue(catalog);
  const { edits, container } = await mount(true);
  expect(container.textContent).toContain("Smart setup");
  await act(async () => primary(container).click());
  expect(planSmartSetup).not.toHaveBeenCalled();
  expect(setupCandidates).toHaveBeenCalledWith(expect.anything(), catalog);
  expect(rulePlan).toHaveBeenCalledWith([candidate], names);
  expect(edits).toHaveLength(1);
  expect(applySmartSetup).toHaveBeenCalledWith(expect.anything(), [candidate], plan);
  expect(toast.show).toHaveBeenCalledWith({
    tone: "info",
    message: "Smart setup filled the draft. Review it, then save.",
  });
  expect(primary(container).getAttribute("aria-busy")).not.toBe("true");
});

it("returns the applied draft from the edit it hands to the editor", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(rulePlan).mockReturnValue(plan);
  const next = start();
  vi.mocked(applySmartSetup).mockReturnValue(next);
  const { edits, container } = await mount();
  await act(async () => primary(container).click());
  const base = start();
  expect(edits[0]!(base)).toBe(next);
  expect(applySmartSetup).toHaveBeenCalledWith(base, [candidate], plan);
});

it("surfaces a missing catalog and a thrown error through the draft editor on the rules path", async () => {
  vi.mocked(setupCandidates).mockReturnValue([]);
  const { edits, container } = await mount(false);
  await act(async () => primary(container).click());
  expect(rulePlan).not.toHaveBeenCalled();
  expect(() => edits[0]!(start())).toThrow("No available provider models found");
  vi.mocked(setupCandidates).mockImplementation(() => {
    throw new Error("Catalog failed");
  });
  await act(async () => primary(container).click());
  expect(() => edits[1]!(start())).toThrow("Catalog failed");
  expect(applySmartSetup).not.toHaveBeenCalled();
  expect(toast.show).not.toHaveBeenCalled();
});

it("plans with localized names from the split menu, applies once and names the planner", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan, plannedBy: "Sol" });
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const { edits, container } = await mount(true);
  await planWithAi(container);
  expect(rulePlan).not.toHaveBeenCalled();
  expect(planSmartSetup).toHaveBeenCalledWith([candidate], names, {
    signal: expect.any(AbortSignal),
  });
  expect(edits).toHaveLength(1);
  expect(applySmartSetup).toHaveBeenCalledWith(expect.anything(), [candidate], plan);
  expect(toast.show).toHaveBeenCalledWith({
    tone: "info",
    message: "Sol planned the setup. Review it, then save.",
  });
});

it("warns when no model could plan and the rules were used instead", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const { container } = await mount(true);
  vi.mocked(planSmartSetup).mockResolvedValue({
    candidates: [candidate],
    plan,
    failure: { planner: "Sol", reason: "timeout" },
  });
  await planWithAi(container);
  const warning = vi.mocked(toast.show).mock.calls[0]![0];
  expect(warning).toMatchObject({ tone: "warning" });
  expect(warning.message).toContain("Sol could not plan the setup (it timed out)");
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan });
  await planWithAi(container);
  expect(vi.mocked(toast.show).mock.calls[1]![0]).toMatchObject({
    tone: "warning",
    message: expect.stringContaining("No model could plan the setup"),
  });
});

it("surfaces a missing catalog through the draft editor on the AI path without planning", async () => {
  vi.mocked(setupCandidates).mockReturnValue([]);
  const { edits, container } = await mount(false);
  await planWithAi(container);
  expect(planSmartSetup).not.toHaveBeenCalled();
  expect(() => edits[0]!(start())).toThrow("No available provider models found");
  expect(toast.show).not.toHaveBeenCalled();
});

it("shows pending state while planning and drops the result after unmount", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  let finish!: (value: { candidates: SetupCandidate[]; plan: typeof plan }) => void;
  vi.mocked(planSmartSetup).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const { edits, container, root } = await mount();
  await planWithAi(container);
  expect(primary(container).getAttribute("aria-busy")).toBe("true");
  expect(primary(container).getAttribute("aria-label")).toBe("Planning…");
  const signal = vi.mocked(planSmartSetup).mock.calls[0]![2].signal!;
  await act(() => root.unmount());
  roots.length = 0;
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ candidates: [candidate], plan }));
  expect(edits).toHaveLength(0);
  expect(toast.show).not.toHaveBeenCalled();
});
