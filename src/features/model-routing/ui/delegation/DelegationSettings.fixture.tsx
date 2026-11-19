import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_MODEL_ROUTING } from "../../../../shared/model/host-contracts/model-routing";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { DelegationSettings } from "./DelegationSettings";

vi.mock("../../../../shared/ui/settings", () => ({
  Group: ({
    title,
    action,
    children,
  }: {
    title: ReactNode;
    action?: ReactNode;
    children: ReactNode;
  }) => (
    <section aria-label={String(title)}>
      {action}
      {children}
    </section>
  ),
  Row: ({
    label,
    children,
    onReset,
  }: {
    label: ReactNode;
    children: ReactNode;
    onReset?: () => void;
  }) => (
    <div role="group" aria-label={String(label)}>
      {children}
      {onReset ? <button onClick={onReset}>Reset {String(label)}</button> : null}
    </div>
  ),
}));
vi.mock("../../../../shared/ui/DropdownMenu", () => ({
  DropdownMenu: ({
    items,
    onPick,
  }: {
    items: { id: string; label: string }[];
    onPick: (id: string) => void;
  }) => (
    <div role="menu">
      {items.map((item) => (
        <button key={item.id} onClick={() => onPick(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../../../../shared/ui/EffortScale", () => ({
  EffortScale: ({ onValueChange }: { onValueChange: (value: string) => void }) => (
    <button onClick={() => onValueChange("high")}>Effort high</button>
  ),
}));
vi.mock("../../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button onClick={() => onChange("")}>Advisor off</button>
  ),
}));
vi.mock("../../../providers/public/providerAccounts", () => ({
  providerAccounts: () => [{ id: "work", label: "Work" }],
  supportsProviderAccounts: () => true,
}));
vi.mock("../../../sessions/public/SubagentModeControl", () => ({
  SubagentSelectionControl: ({ onChange }: { onChange: (value: string) => void }) => (
    <button onClick={() => onChange("[]")}>Subagents off</button>
  ),
}));
vi.mock("../../../sessions/public/modelPickerData", () => ({
  delegationSelectChoice: () => ({}),
  DelegationOptionIcon: () => null,
  DelegationSubagentsControl: () => null,
  SubagentEffortSwitch: () => null,
  useDelegationSettings: () =>
    [
      ["crossAdvisor", "Advisor"],
      ["crossSubagents", "Subagents"],
      ["crossSubagentMaxEffort", "Subagent max effort"],
      ["imageModels", "Image models"],
    ].map(([id, label]) => ({
      id,
      label,
      kind: "select",
      value: "",
      options: [
        { value: "", label: "Automatic" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    })),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const entry = (harness: "claude" | "codex", providerAccountId?: string) => ({
  id: `${harness}-${providerAccountId ?? "default"}`,
  harness,
  model: "m",
  modelSettings: {},
  unknownLimit: "use" as const,
  ...(providerAccountId ? { providerAccountId } : {}),
});

function draftWith(routing: Partial<OrderDraft["routing"]>): OrderDraft {
  return { routing: { ...EMPTY_MODEL_ROUTING, ...routing } } as OrderDraft;
}

function render(draft: OrderDraft, disabled = false) {
  const onChange = vi.fn();
  act(() =>
    root.render(<DelegationSettings draft={draft} disabled={disabled} onChange={onChange} />),
  );
  return onChange;
}

const click = (text: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  );
  if (!button) throw new Error(`No button "${text}"`);
  act(() => button.click());
};

it("edits the global layer and keeps the rest of the draft", () => {
  const draft = draftWith({ entries: [entry("codex")] });
  const onChange = render(draft);
  expect(container.querySelectorAll("[role=group]")).toHaveLength(4);
  click("Subagents off");
  const next = onChange.mock.calls[0]![0] as OrderDraft;
  expect(next.routing.delegation.global).toEqual({ crossSubagents: "[]" });
  expect(next.routing.entries).toBe(draft.routing.entries);
});

it("adds a provider override, then stores Off explicitly in it", () => {
  const draft = draftWith({ entries: [entry("codex"), entry("claude", "work")] });
  const onChange = render(draft);
  click("Add override");
  expect([...container.querySelectorAll("[role=menu] button")].map((b) => b.textContent)).toEqual([
    "Codex",
    "Claude Code",
    "Claude Code · Work",
  ]);
  click("Codex");
  expect(onChange).not.toHaveBeenCalled();
  click("Add setting");
  click("Advisor");
  expect(onChange.mock.calls[0]![0].routing.delegation.providers.codex).toEqual({
    crossAdvisor: "null",
  });
});

it("lists only the keys an override sets and removes it", () => {
  const draft = draftWith({
    entries: [entry("claude", "work")],
    delegation: {
      global: { crossSubagentMaxEffort: "medium" },
      providers: {},
      accounts: { "claude\nwork": { crossSubagentMaxEffort: "high" } },
    },
  });
  const onChange = render(draft);
  const overrides = container.querySelector("section[aria-label=Overrides]")!;
  expect(overrides.textContent).toContain("Claude Code · Work");
  const group = overrides.querySelector("[role=group][aria-label='Claude Code · Work']");
  expect(group).not.toBeNull();
  const remove = overrides.querySelector(
    "button[aria-label='Remove all Claude Code · Work overrides']",
  ) as HTMLButtonElement;
  act(() => remove.click());
  expect(onChange.mock.calls[0]![0].routing.delegation.accounts).toEqual({});
  expect(onChange.mock.calls[0]![0].routing.delegation.global).toEqual({
    crossSubagentMaxEffort: "medium",
  });
});

it("removes one key of an override without removing the whole layer", () => {
  const draft = draftWith({
    entries: [entry("claude", "work")],
    delegation: {
      global: {},
      providers: {},
      accounts: { "claude\nwork": { crossSubagentMaxEffort: "high" } },
    },
  });
  const onChange = render(draft);
  const overrides = container.querySelector("section[aria-label=Overrides]")!;
  const group = overrides.querySelector("[role=group][aria-label='Claude Code · Work']")!;
  const reset = group.querySelector("button[aria-label$=' override']") as HTMLButtonElement;
  expect(reset.getAttribute("aria-label")).not.toBe("Remove all Claude Code · Work overrides");
  act(() => reset.click());
  expect(
    onChange.mock.calls[0]![0].routing.delegation.accounts["claude\nwork"]?.crossSubagentMaxEffort,
  ).toBeUndefined();
});
