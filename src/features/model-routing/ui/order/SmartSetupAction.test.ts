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
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import type { ModelRoutingTarget } from "../../../../shared/model/host-contracts/model-routing";

vi.mock("../../../sessions/public/modelSource", () => ({
  useModelSource: () => ({
    available: () => true,
    resolve: (_harness: string, model: string) => ({ id: model, name: `Name of ${model}` }),
  }),
}));
vi.mock("../../model/smartSetup", () => ({
  setupCandidates: vi.fn(),
  applySmartSetup: vi.fn(),
  rulePlan: vi.fn(),
}));
vi.mock("../../model/smartSetupAi", () => ({
  planSmartSetup: vi.fn(),
  resolveSetupPlanner: vi.fn(async () => ({
    harness: "codex",
    model: "gpt",
    providerAccountId: "work",
    modelSettings: {},
  })),
  setupPlannerLabel: (target: ModelRoutingTarget) => target.model,
}));
vi.mock("../../../../integrations/harness/core/registry", () => ({
  canRunHarnessTextPrompt: () => true,
}));
vi.mock("../../model/smartSetupCatalog", () => ({
  localSetupCatalog: vi.fn(async () => undefined),
}));
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
  light: "Low",
  work: "Work",
  personal: "Personal",
};
const start = () =>
  orderDraft(
    { ...EMPTY_MODEL_ROUTING, version: 1, updatedAt: 0 },
    { maxRunningTasks: 2, dailyAgentMinutes: 0 },
  );

/** `run` applies each edit to a draft at once, like the draft editor does; otherwise they are collected. */
async function mount(run = false, choice?: ModelRoutingTarget) {
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
          catalogChoices: [],
          choice,
          onChoice: () => {},
          onEdit: (operation) => {
            edits.push(operation);
            if (run) {
              try {
                operation(start());
              } catch {
                return false;
              }
            }
            return run;
          },
        }),
      ),
    ),
  );
  return { edits, container, root };
}
const primary = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Set up with rules" || button.textContent === "Planning…",
  )!;
const ai = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent === "Set up with AI" || button.textContent?.startsWith("Planning"),
  )!;
/** A disabled action with a reason stays focusable: it is `aria-disabled`, not `disabled`. */
const unavailable = (button: HTMLButtonElement) =>
  button.disabled || button.getAttribute("aria-disabled") === "true";
async function planWithAi(container: HTMLElement) {
  expect(ai(container)).toBeTruthy();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(unavailable(ai(container))).toBe(false);
  });
  await act(async () => ai(container).click());
}

it("fills the draft with the researched rules at once, without asking a model", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(rulePlan).mockReturnValue(plan);
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const catalog = { models: { codex: [{ id: "gpt", name: "GPT" }] } };
  vi.mocked(localSetupCatalog).mockResolvedValue(catalog);
  const { edits, container } = await mount(true);
  expect(container.textContent).toContain("Set up with rules");
  await act(async () => primary(container).click());
  expect(planSmartSetup).not.toHaveBeenCalled();
  expect(setupCandidates).toHaveBeenCalledWith(expect.anything(), catalog);
  expect(rulePlan).toHaveBeenCalledWith([candidate], names);
  expect(edits).toHaveLength(1);
  expect(applySmartSetup).toHaveBeenCalledWith(
    expect.anything(),
    [candidate],
    plan,
    expect.anything(),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Rules prepared the draft.",
  );
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
  expect(applySmartSetup).toHaveBeenCalledWith(base, [candidate], plan, expect.anything());
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
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("plans with localized names from the direct action, applies once and names the planner", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan, plannedBy: "Sol" });
  vi.mocked(applySmartSetup).mockReturnValue(start());
  const { edits, container } = await mount(true);
  await planWithAi(container);
  expect(rulePlan).not.toHaveBeenCalled();
  expect(planSmartSetup).toHaveBeenCalledWith([candidate], names, {
    signal: expect.any(AbortSignal),
    planner: { harness: "codex", model: "gpt", providerAccountId: "work", modelSettings: {} },
    onPlanner: expect.any(Function),
  });
  expect(edits).toHaveLength(1);
  expect(applySmartSetup).toHaveBeenCalledWith(
    expect.anything(),
    [candidate],
    plan,
    expect.anything(),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Draft planned by Sol");
});

it("names the chosen planning model on its control and runs the selected account and settings", async () => {
  const choice = {
    harness: "codex",
    model: "gpt-selected",
    providerAccountId: "personal",
    modelSettings: { reasoningEffort: "high", serviceTier: "fast" },
  } as const;
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan, plannedBy: "GPT" });
  const { container } = await mount(true, choice);
  const picker = container.querySelector('button[aria-haspopup="dialog"]');
  expect(picker?.textContent).toBe("Name of gpt-selected");
  expect(picker?.querySelector("img")).toBeTruthy();
  await planWithAi(container);
  expect(planSmartSetup).toHaveBeenCalledWith(
    [candidate],
    names,
    expect.objectContaining({ planner: choice }),
  );
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
  expect(container.querySelector('[role="status"]')?.getAttribute("data-tone")).toBe("warning");
  expect(container.textContent).toContain("Sol timed out. Rules prepared the draft.");
  vi.mocked(planSmartSetup).mockResolvedValue({ candidates: [candidate], plan });
  await planWithAi(container);
  expect(container.textContent).toContain("No planning model was available.");
});

it("surfaces a missing catalog through the draft editor on the AI path without planning", async () => {
  vi.mocked(setupCandidates).mockReturnValue([]);
  const { edits, container } = await mount(false);
  await planWithAi(container);
  expect(planSmartSetup).not.toHaveBeenCalled();
  expect(() => edits[0]!(start())).toThrow("No available provider models found");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("shows pending state while planning and drops the result after unmount", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  let finish!: (value: { candidates: SetupCandidate[]; plan: typeof plan }) => void;
  vi.mocked(planSmartSetup).mockImplementation((_candidates, _names, options) => {
    options.onPlanner?.("Sol · Codex · Work");
    return new Promise((resolve) => (finish = resolve));
  });
  const { edits, container, root } = await mount();
  await planWithAi(container);
  expect(ai(container).getAttribute("aria-busy")).toBe("true");
  // The pending action names the planner itself; no separate planning notice.
  expect(ai(container).textContent).toBe("Planning with Sol · Codex · Work");
  expect(unavailable(primary(container))).toBe(true);
  const signal = vi.mocked(planSmartSetup).mock.calls[0]![2].signal!;
  await act(() => root.unmount());
  roots.length = 0;
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ candidates: [candidate], plan }));
  expect(edits).toHaveLength(0);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("cancels planning without applying a late answer", async () => {
  vi.mocked(setupCandidates).mockReturnValue([candidate]);
  let finish!: (value: { candidates: SetupCandidate[]; plan: typeof plan }) => void;
  vi.mocked(planSmartSetup).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const { edits, container } = await mount(true);
  await planWithAi(container);
  const cancel = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Cancel",
  );
  await act(async () => cancel!.click());
  expect(vi.mocked(planSmartSetup).mock.calls[0]![2].signal?.aborted).toBe(true);
  await act(async () => finish({ candidates: [candidate], plan }));
  expect(edits).toHaveLength(0);
  expect(unavailable(primary(container))).toBe(false);
});
