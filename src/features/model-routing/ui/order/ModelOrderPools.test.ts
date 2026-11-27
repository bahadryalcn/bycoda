// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelOrderPools } from "./ModelOrderPools";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

type PickerProps = {
  model: string;
  values: Record<string, string>;
  accountId?: string;
  settingsScope?: string;
  hideSettings?: boolean;
  externalTrigger?: unknown;
  onChange: (harness: string, model: string, accountId?: string) => void;
  onSettingsChange: (settings: Record<string, string>) => void;
};
const pickers: PickerProps[] = [];
vi.mock("../../../sessions/public/ModelPicker", () => ({
  ModelPicker: (props: PickerProps) => {
    pickers.push(props);
    return createElement("span", { "data-picker": props.model }, props.model);
  },
}));
vi.mock("../../../sessions/public/models", () => ({
  resolveModel: (_harness: string, model: string) => ({ id: model, name: model }),
  defaultModelSettings: () => ({ effort: "medium" }),
  modelEffortSetting: () => ({
    id: "effort",
    options: ["low", "medium", "high"].map((value) => ({ value, label: value })),
  }),
}));
vi.mock("../../../../shared/ui/settings", () => ({
  Group: ({ children, action }: { children: ReactNode; action: ReactNode }) =>
    createElement("section", null, action, children),
}));
vi.mock("../../../providers/public/providerAccounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeProviderAccounts: () => () => {},
  providerAccounts: () => [
    { id: "default", label: "Personal" },
    { id: "work", label: "Work" },
  ],
  defaultProviderAccountId: () => "default",
  supportsProviderAccounts: (harness: string) => ["claude", "codex", "grok"].includes(harness),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string) => ({
  id,
  harness: "codex" as const,
  model: id,
  modelSettings: { effort: "medium" },
  unknownLimit: "use" as const,
});
const limits = { maxRunningTasks: 2, dailyAgentMinutes: 0 };
const state = (pools: OrderDraft["routing"]["pools"]) => ({
  ...EMPTY_MODEL_ROUTING,
  version: 1,
  updatedAt: 0,
  entries: [entry("a"), entry("b"), entry("c")],
  pools,
});
const draft = orderDraft(
  state([
    { id: "p1", name: "Main", entryIds: ["a", "b"] },
    { id: "p2", name: "Inner", entryIds: ["c"] },
  ]),
  limits,
);

let root: Root;
let container: HTMLDivElement;
let applied: OrderDraft;
const render = (value: OrderDraft) =>
  act(() =>
    root.render(
      createElement(ModelOrderPools, {
        draft: value,
        onChange: vi.fn(),
        onEdit: (operation: (current: OrderDraft) => OrderDraft) => {
          applied = operation(value);
        },
      }),
    ),
  );
beforeEach(async () => {
  pickers.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  applied = draft;
  await render(draft);
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.replaceChildren();
});

const main = () => container.querySelector<HTMLElement>('[aria-label="Main"]')!;
const picker = (model: string) => pickers.findLast((props) => props.model === model)!;

it("shows every group open with its own models in shared model pickers", () => {
  expect(container.querySelectorAll("section[aria-label]")).toHaveLength(2);
  expect([...main().querySelectorAll("[data-picker]")].map((node) => node.textContent)).toEqual([
    "a",
    "b",
  ]);
  // The full picker, like the order rows: provider settings such as Fast stay available.
  expect(picker("a").settingsScope).toBeUndefined();
  expect(container.querySelector('[aria-expanded="false"][aria-controls]')).toBeNull();
});

it("sets effort and speed per model of a group without touching the order entry", async () => {
  await act(() => picker("a").onSettingsChange({ effort: "high", fast: "true" }));
  expect(applied.routing.pools[0]!.memberSettings).toEqual({ a: { effort: "high", fast: "true" } });
  expect(applied.routing.entries[0]!.modelSettings).toEqual({ effort: "medium" });
});

it("swaps a member for a picked model, adding it to the order when it is new", async () => {
  await act(() => picker("b").onChange("codex", "gpt-new", "work"));
  const added = applied.routing.entries.find((candidate) => candidate.model === "gpt-new")!;
  expect(added).toMatchObject({ providerAccountId: "work", modelSettings: { effort: "medium" } });
  expect(applied.routing.pools[0]!.entryIds).toEqual(["a", added.id]);
});

it("adds a picked model from the Add model picker and reuses an existing order entry", async () => {
  const add = [...main().querySelectorAll("button")].find(
    (button) => button.textContent === "Add model",
  )!;
  await act(() => add.click());
  const opened = pickers.findLast((props) => props.externalTrigger)!;
  await act(() => opened.onChange("codex", "c", "default"));
  expect(applied.routing.pools[0]!.entryIds).toEqual(["a", "b", "c"]);
  expect(applied.routing.entries).toHaveLength(3);
  // The picker stays open on the added model so its effort and speed can be set.
  await render(applied);
  const reopened = pickers.findLast((props) => props.externalTrigger)!;
  expect(reopened.model).toBe("c");
  await act(() => reopened.onSettingsChange({ fast: "true" }));
  expect(applied.routing.pools[0]!.memberSettings).toEqual({
    c: { fast: "true" },
  });
});

it("opens the full picker on Add model and applies settings chosen before the pick", async () => {
  const add = [...main().querySelectorAll("button")].find(
    (button) => button.textContent === "Add model",
  )!;
  await act(() => add.click());
  const opened = pickers.findLast((props) => props.externalTrigger)!;
  expect(opened.hideSettings).toBeFalsy();
  await act(() => opened.onSettingsChange({ effort: "high" }));
  expect(applied).toBe(draft);
  await act(() => pickers.findLast((props) => props.externalTrigger)!.onChange("codex", "c"));
  expect(applied.routing.pools[0]!.memberSettings).toEqual({ c: { effort: "high" } });
});

it("includes another group from the Include another group menu", async () => {
  const include = [...main().querySelectorAll("button")].find(
    (button) => button.textContent === "Include another group",
  )!;
  await act(() => include.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items.map((item) => item.getAttribute("data-menu-label"))).toEqual(["Inner"]);
  await act(() => items[0]!.click());
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["a", "b"], poolIds: ["p2"] });
});

it("reorders and removes members through one setPoolMembers edit", async () => {
  await act(() => {
    main()
      .querySelector<HTMLElement>('[aria-label="Reorder in A"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["b", "a"] });
  await act(() => main().querySelector<HTMLElement>('[aria-label="Remove B from group"]')!.click());
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["a"] });
});

it("moves a group-wide effort from an earlier save onto the group's models", () => {
  const loaded = orderDraft(
    state([{ id: "p1", name: "Main", entryIds: ["a", "b"], effort: "high" }]),
    limits,
  );
  expect(loaded.routing.pools[0]).toEqual({
    id: "p1",
    name: "Main",
    entryIds: ["a", "b"],
    memberSettings: { a: { effort: "high" }, b: { effort: "high" } },
  });
});

it("labels a cleared group's delete button with the same fallback name as its group", async () => {
  await render({
    ...draft,
    routing: {
      ...draft.routing,
      pools: [{ id: "p3", name: "", entryIds: ["a"] }, ...draft.routing.pools.slice(1)],
    },
  });
  expect(container.querySelector('[aria-label="Delete group Unnamed group"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Delete group "]')).toBeNull();
});

it("removes a group at once; the draft is reverted by Discard, so no confirmation", async () => {
  const inner = () => container.querySelector<HTMLElement>('[aria-label="Delete group Inner"]')!;
  await act(async () => inner().click());
  expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).toBeNull();
  expect(applied.routing.pools.map((pool) => pool.id)).toEqual(["p1"]);
});

it("shows an included pool with its resolved models by name", async () => {
  await render(
    orderDraft(
      state([
        { id: "p1", name: "Main", entryIds: ["a"], poolIds: ["p2"] },
        { id: "p2", name: "Inner", entryIds: ["b", "c"] },
      ]),
      limits,
    ),
  );
  const member = main().querySelector<HTMLElement>('[aria-label="Inner"]')!;
  expect(member.textContent).not.toContain("2 models");
  expect(member.textContent).toBe("InnerB, C");
});
