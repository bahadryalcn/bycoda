// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelOrderPools } from "./ModelOrderPools";
import { orderDraft, type OrderDraft } from "../../model/modelRoutingDraft";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";

vi.mock("../../../sessions/public/ModelLabel", () => ({
  ModelLabel: ({ model }: { model: string }) => createElement("span", null, model),
}));
vi.mock("../../../sessions/public/models", () => ({
  resolveModel: (_harness: string, model: string) => ({ name: model }),
}));
vi.mock("../../../settings/public/settingsControls", () => ({
  Group: ({ children, action }: { children: ReactNode; action: ReactNode }) =>
    createElement("section", null, action, children),
}));
vi.mock("../../../providers/public/providerAccounts", () => ({
  subscribeProviderAccounts: () => () => {},
  providerAccounts: () => [{ id: "default", label: "Default account" }],
  defaultProviderAccountId: () => "default",
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string) => ({
  id,
  harness: "codex",
  model: id,
  modelSettings: {},
  unknownLimit: "use" as const,
});
const limits = { maxRunningTasks: 2, dailyAgentMinutes: 0 };
const draft = orderDraft(
  {
    ...EMPTY_MODEL_ROUTING,
    version: 1,
    updatedAt: 0,
    entries: [entry("a"), entry("b"), entry("c")],
    pools: [
      { id: "p1", name: "Main", entryIds: ["a", "b"] },
      { id: "p2", name: "Inner", entryIds: ["c"] },
    ],
  },
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

it("lists only a pool's members, in order, instead of every model", () => {
  expect(main().textContent).toContain("a");
  expect(main().textContent).toContain("b");
  expect(main().textContent).not.toMatch(/c/);
  expect(main().querySelector('input[type="checkbox"]')).toBeNull();
});

it("reorders and removes members through one setPoolMembers edit", async () => {
  await act(() => main().querySelector<HTMLElement>('[aria-label="Move a down"]')!.click());
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["b", "a"] });
  await act(() => main().querySelector<HTMLElement>('[aria-label="Remove b from pool"]')!.click());
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["a"] });
});

it("adds a model not yet in the pool and an includable pool", async () => {
  const add = [...main().querySelectorAll("button")].find((button) => button.textContent === "Add")!;
  await act(() => add.click());
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(items().map((item) => item.textContent)).toEqual(["c", "Inner"]);
  await act(() => items().find((item) => item.textContent === "Inner")!.click());
  expect(applied.routing.pools[0]).toMatchObject({ entryIds: ["a", "b"], poolIds: ["p2"] });
});

it("shows an included pool as a pool with its resolved model count", async () => {
  await render(
    orderDraft(
      {
        ...EMPTY_MODEL_ROUTING,
        version: 1,
        updatedAt: 0,
        entries: draft.routing.entries,
        pools: [
          { id: "p1", name: "Main", entryIds: ["a"], poolIds: ["p2"] },
          { id: "p2", name: "Inner", entryIds: ["b", "c"] },
        ],
      },
      limits,
    ),
  );
  const member = main().querySelector<HTMLElement>('[aria-label="Inner"]')!;
  expect(member.textContent).toContain("2 models");
});
