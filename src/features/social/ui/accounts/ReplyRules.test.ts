// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialRule } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ReplyRules } from "./ReplyRules";

const confirm = vi.fn(async () => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

let element: HTMLDivElement, root: Root;

beforeEach(() => {
  confirm.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  element.remove();
});

const account = { id: "a1", name: "Studio" } as unknown as SocialAccount;
const rule = (patch: Partial<SocialRule>): SocialRule =>
  ({
    id: "r1",
    name: "Pricing replies",
    accountId: "a1",
    projectId: "p1",
    mode: "automatic",
    trigger: "comment",
    topics: [],
    dailyLimit: 10,
    enabled: false,
    stopWords: [],
    answers: [],
    ...patch,
  }) as SocialRule;

it("asks before turning on an automatic rule, then activates it with the explicit confirmation", async () => {
  const request = vi.fn(async () => ({}));
  const client = {
    sectionSnapshot: vi.fn(async () => ({ snapshot: { rules: [rule({})] } })),
    request,
  } as unknown as SocialClient;
  act(() =>
    root.render(createElement(ReplyRules, { client, account, projects: [], disabled: false })),
  );
  await act(async () => undefined);
  const toggle = element.querySelector<HTMLButtonElement>('[role="switch"]');
  await act(async () => toggle?.click());
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("automations.activate", {
    id: "r1",
    confirm: "ENABLE_AUTOMATIC_REPLIES",
  });
});

it("lists only the rules of this account", async () => {
  const client = {
    sectionSnapshot: vi.fn(async () => ({
      snapshot: { rules: [rule({}), rule({ id: "r2", accountId: "other", name: "Other" })] },
    })),
    request: vi.fn(),
  } as unknown as SocialClient;
  act(() =>
    root.render(createElement(ReplyRules, { client, account, projects: [], disabled: false })),
  );
  await act(async () => undefined);
  expect(element.textContent).toContain("Pricing replies");
  expect(element.textContent).not.toContain("Other");
});

function mount(
  client: Record<string, unknown>,
  props: { disabled?: boolean; projects?: unknown[] } = {},
) {
  act(() =>
    root.render(
      createElement(ReplyRules, {
        client: client as unknown as SocialClient,
        account,
        projects: (props.projects ?? []) as never[],
        disabled: props.disabled ?? false,
      }),
    ),
  );
}

const snapshotOf = (rules: SocialRule[]) => vi.fn(async () => ({ snapshot: { rules } }));
const flush = () => act(async () => undefined);
const toggleOf = (name: string) =>
  element.querySelector<HTMLButtonElement>(`button[role="switch"][aria-label="${name}"]`);
const button = (text: string) =>
  [...element.querySelectorAll("button")].find((node) => node.textContent === text);

it("turns a draft or approval rule on without the automatic-reply confirmation and reloads the list", async () => {
  const request = vi.fn(async () => ({}));
  const sectionSnapshot = snapshotOf([rule({ mode: "approval" })]);
  mount({ sectionSnapshot, request });
  await flush();
  await act(async () => toggleOf("Pricing replies")?.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith("automations.activate", { id: "r1" });
  expect(sectionSnapshot).toHaveBeenCalledTimes(2);
});

it("does not activate an automatic rule when the owner declines the confirmation", async () => {
  confirm.mockResolvedValueOnce(false);
  const request = vi.fn(async () => ({}));
  mount({ sectionSnapshot: snapshotOf([rule({})]), request });
  await flush();
  await act(async () => toggleOf("Pricing replies")?.click());
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

it("pauses a running rule without asking", async () => {
  const request = vi.fn(async () => ({}));
  mount({ sectionSnapshot: snapshotOf([rule({ enabled: true })]), request });
  await flush();
  await act(async () => toggleOf("Pricing replies")?.click());
  expect(confirm).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith("automations.pause", { id: "r1" });
});

it("shows the failure and leaves the rule as it was when the Host refuses to activate it", async () => {
  const request = vi.fn(async () => {
    throw new Error("The account is not connected.");
  });
  const sectionSnapshot = snapshotOf([rule({ mode: "approval" })]);
  mount({ sectionSnapshot, request });
  await flush();
  await act(async () => toggleOf("Pricing replies")?.click());
  expect(element.textContent).toContain("The account is not connected.");
  expect(toggleOf("Pricing replies")?.getAttribute("aria-checked")).toBe("false");
  expect(sectionSnapshot).toHaveBeenCalledTimes(1);
});

it("keeps every switch locked while the Host is offline", async () => {
  mount({ sectionSnapshot: snapshotOf([rule({})]), request: vi.fn() }, { disabled: true });
  await flush();
  expect(toggleOf("Pricing replies")?.disabled).toBe(true);
  expect(button("Review rules with AI")?.disabled).toBe(true);
});

it("offers a retry when the rules cannot be read", async () => {
  const sectionSnapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ snapshot: { rules: [rule({})] } });
  mount({ sectionSnapshot, request: vi.fn() });
  await flush();
  expect(element.textContent).toContain("The reply rules could not be read. Try again.");
  await act(async () => button("Try again")?.click());
  expect(sectionSnapshot).toHaveBeenCalledTimes(2);
  expect(element.textContent).toContain("Pricing replies");
});

it("says plainly that this account has no reply rules and offers no AI review", async () => {
  mount(
    { sectionSnapshot: snapshotOf([]), request: vi.fn() },
    { projects: [{ id: "p1", name: "Alpha" }] },
  );
  await flush();
  expect(element.textContent).toContain("No reply rules for this account yet.");
  expect(button("Review rules with AI")?.disabled).toBe(true);
});

it("shows that a stopped rule is paused", async () => {
  mount({
    sectionSnapshot: snapshotOf([rule({ enabled: false, pausedReason: "owner" })]),
    request: vi.fn(),
  });
  await flush();
  expect(element.textContent).toContain("Paused");
});

it("asks AI to narrow only this account's rules and only proposes, never changing a rule", async () => {
  const request = vi.fn(async (action: string) =>
    action === "rules.simplify"
      ? {
          accountId: "a1",
          projectId: "p1",
          proposals: [
            {
              ruleId: "r1",
              ruleName: "Pricing replies",
              reason: "Too broad for pricing.",
              proposed: {},
              changes: [],
            },
          ],
          unchangedRuleIds: [],
          notes: ["Kept the stop words."],
          agent: { provider: "codex" },
          requiresOwnerActivation: true,
        }
      : {},
  );
  mount({
    sectionSnapshot: vi.fn(async () => ({
      snapshot: { rules: [rule({}), rule({ id: "r2", accountId: "other", name: "Other" })] },
    })),
    request,
  });
  await flush();
  await act(async () => button("Review rules with AI")?.click());
  expect(request).toHaveBeenCalledExactlyOnceWith("rules.simplify", {
    accountId: "a1",
    projectId: "p1",
    ruleIds: ["r1"],
  });
  expect(element.textContent).toContain(
    "AI suggests these narrower rules. Nothing changes until you edit a rule.",
  );
  expect(element.textContent).toContain("Pricing replies");
  expect(element.textContent).toContain("Too broad for pricing.");
  expect(element.textContent).toContain("Kept the stop words.");
  const actions = request.mock.calls.map((call) => call[0]);
  expect(actions).not.toContain("automations.create");
  expect(actions).not.toContain("automations.activate");
  expect(actions).not.toContain("automations.pause");
});

it("says when no rule needs narrowing", async () => {
  const request = vi.fn(async () => ({
    accountId: "a1",
    projectId: "p1",
    proposals: [],
    unchangedRuleIds: ["r1"],
    notes: [],
    agent: { provider: "codex" },
    requiresOwnerActivation: true,
  }));
  mount({ sectionSnapshot: snapshotOf([rule({})]), request });
  await flush();
  await act(async () => button("Review rules with AI")?.click());
  expect(element.textContent).toContain("No rule needs narrowing.");
});

it("shows the failure of the AI review without creating a proposal", async () => {
  const request = vi.fn(async () => {
    throw new Error("Choose a model first.");
  });
  mount({ sectionSnapshot: snapshotOf([rule({})]), request });
  await flush();
  await act(async () => button("Review rules with AI")?.click());
  expect(element.textContent).toContain("Choose a model first.");
  expect(element.textContent).not.toContain("AI suggests these narrower rules.");
});

it("says why Review rules with AI is off while the Host is offline", async () => {
  mount({ sectionSnapshot: snapshotOf([rule({})]), request: vi.fn() }, { disabled: true });
  await flush();
  expect(element.textContent).toContain("Connect to this computer to change this account.");
});

it("clears the read error once a retry succeeds", async () => {
  const sectionSnapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ snapshot: { rules: [rule({})] } });
  mount({ sectionSnapshot, request: vi.fn() });
  await flush();
  await act(async () => button("Try again")?.click());
  await flush();
  expect(element.textContent).not.toContain("The reply rules could not be read. Try again.");
  expect(element.textContent).toContain("Pricing replies");
});
