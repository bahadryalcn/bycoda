// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount, SocialProjectProfile, SocialRule } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { RuleSimplifyProposal, RuleSimplifySuggestion } from "../model/socialSuggestions";
import {
  RuleSimplifyReview,
  ruleDraftFromReview,
  simplifyProblems,
  useRuleSimplify,
} from "./RuleSimplifyReview";

let container: HTMLDivElement;
let root: Root;
const request = vi.fn();
const close = vi.fn();
// The query scope is keyed by client identity, so the client must be stable like in the app.
const client = { request } as unknown as SocialClient;
const projects = [{ id: "a", name: "Alpha project", cwd: "/a" }];
const accounts = [
  {
    id: "account",
    name: "Test account",
    platform: "x",
    grants: { a: ["read", "draft", "reply"] },
  },
] as unknown as SocialAccount[];
const profiles = [
  {
    projectId: "a",
    productName: "Alpha",
    brandVoice: "Clear",
    facts: [
      { id: "fact-a", topic: "Topic", text: "Verified", source: "Owner", verifiedAt: 1 },
      { id: "fact-o", topic: "Other", text: "Other fact", source: "Owner", verifiedAt: 1 },
    ],
  },
] as unknown as SocialProjectProfile[];
const rule = (id: string, extra: Partial<SocialRule> = {}): SocialRule => ({
  id,
  name: `Rule ${id}`,
  accountId: "account",
  projectId: "a",
  mode: "approval",
  trigger: "message",
  topics: ["Topic", "Other"],
  dailyLimit: 20,
  enabled: true,
  stopWords: ["refund", "Refund"],
  answers: [
    { keyword: "help", factId: "fact-a" },
    { keyword: "support", factId: "fact-o" },
  ],
  ...extra,
});
const rules = [rule("one"), rule("two"), rule("three", { topics: ["Topic"], answers: [] })];
const proposalFor = (original: SocialRule, name: string): RuleSimplifyProposal => ({
  ruleId: original.id,
  ruleName: original.name,
  proposed: {
    name,
    accountId: original.accountId,
    projectId: original.projectId,
    mode: original.mode,
    trigger: original.trigger,
    topics: ["Topic"],
    dailyLimit: 5,
    stopWords: ["refund"],
    answers: [original.answers[0]],
  },
  changes: [
    { field: "name", before: original.name, after: name },
    { field: "topics", before: original.topics, after: ["Topic"] },
    { field: "dailyLimit", before: 20, after: 5 },
    { field: "stopWords", before: original.stopWords, after: ["refund"] },
    { field: "answers", before: original.answers, after: [original.answers[0]] },
  ],
  reason: `Reason for ${original.id}`,
});
const suggestion = (): RuleSimplifySuggestion => ({
  accountId: "account",
  projectId: "a",
  proposals: [proposalFor(rules[0], "Simpler one"), proposalFor(rules[1], "Simpler two")],
  unchangedRuleIds: ["three"],
  notes: ["Kept the stop words."],
  agent: { provider: "codex", model: "fixture-model" },
  requiresOwnerActivation: true,
});

const calls = (action: string) => request.mock.calls.filter((call) => call[0] === action);
let created: Map<string, { id: string }>;
let createCount = 0;
function fakeHost(extra: Record<string, (input: any, id: string) => unknown> = {}) {
  request.mockReset().mockImplementation(async (action: string, input: any, id: string) => {
    if (extra[action]) return extra[action](input, id);
    if (action === "policy.get")
      return { effective: { agent: { provider: "codex", model: "fixture-model" } } };
    if (action === "rules.simplify") return suggestion();
    if (action === "automations.create") {
      // Idempotent by request id, like the Host: a repeat returns the first receipt.
      if (!created.has(id))
        created.set(id, { id: `new-${++createCount}`, ...input, enabled: false });
      return created.get(id);
    }
    return {};
  });
}

function Harness({ online = true, list = rules }: { online?: boolean; list?: SocialRule[] }) {
  const session = useRuleSimplify({
    client,
    rules: list,
    accounts,
    profiles,
    projects,
    hostOnline: online,
    preferred: list[0],
    run: async (work) => {
      try {
        await work();
        return true;
      } catch {
        return false;
      }
    },
  });
  return createElement(RuleSimplifyReview, { session, onClose: close });
}
const QueryHarness = withQueryClient(Harness);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  created = new Map();
  createCount = 0;
  close.mockReset();
  fakeHost();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const mount = async (props: { online?: boolean; list?: SocialRule[] } = {}) => {
  await act(async () => root.render(createElement(QueryHarness, props)));
  await act(async () => undefined);
};
const button = (text: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent === text,
  )!;
const press = async (text: string, scope: ParentNode = container) => {
  const target = button(text, scope);
  expect(target, `Missing button: ${text}`).toBeTruthy();
  await act(async () => target.click());
};
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const field = (scope: ParentNode, label: string) => {
  const owner = Array.from(scope.querySelectorAll("label")).find((item) =>
    item.textContent?.trim().startsWith(label),
  )!;
  expect(owner, `Missing field: ${label}`).toBeTruthy();
  return (
    owner.htmlFor ? document.getElementById(owner.htmlFor) : owner.querySelector("input,textarea")
  ) as HTMLInputElement;
};
const card = (name: string) =>
  container.querySelector<HTMLElement>(`article[aria-label="Proposal for ${name}"]`)!;
const check = async (scope: ParentNode, label: string) => {
  const owner = Array.from(scope.querySelectorAll("label")).find((item) =>
    item.textContent?.trim().startsWith(label),
  )!;
  expect(owner, `Missing checkbox: ${label}`).toBeTruthy();
  await act(async () => owner.querySelector("input")!.click());
};
async function askAndReview() {
  await mount();
  await press("Suggest simpler rules");
  await act(async () => undefined);
}

describe("Rule simplify review", () => {
  it("asks once per ask, scopes the request and shows the count, agent and plain semantics", async () => {
    await mount();
    expect(container.textContent).toContain("Test account");
    expect(container.textContent).toContain("Alpha project");
    await check(container, "Rule three");
    await type(container.querySelector<HTMLTextAreaElement>("textarea")!, "  keep only pricing  ");
    await press("Suggest simpler rules");
    await act(async () => undefined);
    const ask = calls("rules.simplify");
    expect(ask).toHaveLength(1);
    expect(ask[0][1]).toEqual({
      accountId: "account",
      projectId: "a",
      ruleIds: ["one", "two"],
      instructions: "keep only pricing",
    });
    expect(typeof ask[0][2]).toBe("string");
    const text = container.textContent!;
    expect(text).toContain("2 of 3 rules would change");
    expect(text).toContain("fixture-model");
    expect(text).toContain("Test account");
    expect(text).toContain("The original rule is not changed or deleted");
    expect(text).toContain("Rules that stay as they are · 1");
    expect(text).toContain("Kept the stop words.");
    // Only the changed fields are listed, with the model's reason.
    expect(card("Rule one").textContent).toContain("Reason for one");
    expect(card("Rule one").querySelectorAll("dl[aria-label='Changes'] > div")).toHaveLength(5);
    expect(card("Rule one").textContent).toContain("Daily limit20→ 5");
    expect(card("Rule one").textContent).toContain("Removed: Refund");
    expect(calls("automations.create")).toHaveLength(0);
  });

  it("creates a paused rule from the owner-edited proposal and pauses the original only when ticked", async () => {
    await askAndReview();
    const one = card("Rule one");
    await type(field(one, "Name"), "Support only");
    await type(field(one, "Daily limit"), "3");
    await type(field(one, "Add stop phrases"), "legal, Refund");
    await check(one, "Pause the original rule too");
    await press("Accept", one);
    await act(async () => undefined);
    const create = calls("automations.create");
    expect(create).toHaveLength(1);
    expect(JSON.stringify(create[0][1])).toBe(
      JSON.stringify({
        name: "Support only",
        accountId: "account",
        projectId: "a",
        mode: "approval",
        trigger: "message",
        topics: ["Topic"],
        dailyLimit: 3,
        stopWords: ["refund", "legal"],
        answers: [{ keyword: "help", factId: "fact-a" }],
      }),
    );
    expect(calls("automations.pause")).toEqual([["automations.pause", { id: "one" }]]);
    expect(request.mock.invocationCallOrder[request.mock.calls.indexOf(create[0])]).toBeLessThan(
      request.mock.invocationCallOrder[request.mock.calls.indexOf(calls("automations.pause")[0])],
    );
    expect(calls("automations.activate")).toHaveLength(0);
    expect(one.textContent).toContain("Created paused");
    expect(one.textContent).toContain("The original rule is paused.");
    // The second proposal, accepted untouched, creates its proposal verbatim and leaves the original alone.
    await press("Accept", card("Rule two"));
    await act(async () => undefined);
    expect(calls("automations.create")).toHaveLength(2);
    expect(calls("automations.create")[1][1]).toEqual(suggestion().proposals[1].proposed);
    expect(calls("automations.pause")).toHaveLength(1);
  });

  it("reuses the same request id when an unclear create is retried and never creates a duplicate", async () => {
    let first = true;
    fakeHost({
      "automations.create": (input, id) => {
        if (first) {
          first = false;
          // The Host stored the rule but the answer was lost.
          created.set(id, { id: `new-${++createCount}`, ...input });
          throw new Error("Connection lost");
        }
        return created.get(id);
      },
    });
    await askAndReview();
    const one = card("Rule one");
    await press("Accept", one);
    await act(async () => undefined);
    expect(one.textContent).toContain("Failed");
    expect(one.textContent).toContain("Connection lost");
    await press("Retry", one);
    await act(async () => undefined);
    const create = calls("automations.create");
    expect(create).toHaveLength(2);
    expect(create[1][2]).toBe(create[0][2]);
    expect(created.size).toBe(1);
    expect(one.textContent).toContain("Created paused");
    // A different proposal has its own request id.
    await press("Accept", card("Rule two"));
    await act(async () => undefined);
    expect(calls("automations.create")[2][2]).not.toBe(create[0][2]);
    // A created item cannot be created twice, not even by "accept all valid".
    expect(button("Accept all valid (0)").disabled).toBe(true);
  });

  it("keeps partial results: one failed item does not stop the others, and failed items can be retried", async () => {
    let fail = true;
    fakeHost({
      "automations.create": (input, id) => {
        if (input.name === "Simpler one" && fail) throw new Error("Rejected by the Host");
        if (!created.has(id)) created.set(id, { id: `new-${++createCount}`, ...input });
        return created.get(id);
      },
    });
    await askAndReview();
    await press("Accept all valid (2)");
    await act(async () => undefined);
    expect(card("Rule one").textContent).toContain("Rejected by the Host");
    expect(card("Rule two").textContent).toContain("Created paused");
    expect(calls("automations.create")).toHaveLength(2);
    fail = false;
    expect(button("Accept all valid (1)").disabled).toBe(false);
    await press("Accept all valid (1)");
    await act(async () => undefined);
    expect(card("Rule one").textContent).toContain("Created paused");
    expect(calls("automations.create")).toHaveLength(3);
    expect(created.size).toBe(2);
  });

  it("does not pause the original when the create failed, and retries a failed pause on its own", async () => {
    let pauseFails = true;
    fakeHost({
      "automations.create": () => {
        throw new Error("No");
      },
      "automations.pause": () => {
        if (pauseFails) throw new Error("Pause failed");
        return {};
      },
    });
    await askAndReview();
    const one = card("Rule one");
    await check(one, "Pause the original rule too");
    await press("Accept", one);
    await act(async () => undefined);
    expect(calls("automations.pause")).toHaveLength(0);

    fakeHost({
      "automations.pause": () => {
        if (pauseFails) throw new Error("Pause failed");
        return {};
      },
    });
    await press("Retry", one);
    await act(async () => undefined);
    expect(one.textContent).toContain("The original rule could not be paused: Pause failed");
    expect(one.textContent).toContain("Created paused");
    pauseFails = false;
    await press("Retry pausing the original rule", one);
    await act(async () => undefined);
    expect(one.textContent).toContain("The original rule is paused.");
    expect(calls("automations.create")).toHaveLength(1);
    expect(calls("automations.pause")).toHaveLength(2);
  });

  it("creates nothing for a rejected proposal and excludes it from accept all valid", async () => {
    await askAndReview();
    await press("Reject", card("Rule one"));
    expect(card("Rule one").textContent).toContain("Rejected");
    expect(card("Rule one").textContent).not.toContain("Accept");
    await press("Accept all valid (1)");
    await act(async () => undefined);
    expect(calls("automations.create")).toHaveLength(1);
    expect((calls("automations.create")[0][1] as { name: string }).name).toBe("Simpler two");
    await press("Undo reject", card("Rule one"));
    expect(button("Accept", card("Rule one")).disabled).toBe(false);
    expect(calls("automations.create")).toHaveLength(1);
  });

  it("limits every edit to the original rule and shows why a proposal is not valid", async () => {
    await askAndReview();
    const one = card("Rule one");
    // Controls only offer the original topics and answers; nothing can be added.
    expect(
      Array.from(one.querySelectorAll("fieldset legend")).map((item) => item.textContent),
    ).toEqual(["Topics to keep", "Answers to keep"]);
    expect(one.querySelectorAll("fieldset")[0].querySelectorAll("input")).toHaveLength(2);
    expect(one.querySelectorAll("fieldset")[1].querySelectorAll("input")).toHaveLength(2);
    expect(field(one, "Daily limit").max).toBe("20");
    await type(field(one, "Daily limit"), "25");
    expect(one.textContent).toContain("The daily limit must be a whole number from 1 to 20.");
    expect(button("Accept", one).disabled).toBe(true);
    await type(field(one, "Daily limit"), "5");
    // The answer "help" belongs to the topic "Topic": dropping it is not valid.
    await check(one, "Topic");
    expect(one.textContent).toContain("Keep at least one topic.");
    expect(button("Accept", one).disabled).toBe(true);
    await check(one, "Topic");
    // Re-adding another ORIGINAL topic and answer is allowed and sent as an ordered subset.
    await check(one, "Other");
    await check(one, "“support”");
    await press("Accept", one);
    await act(async () => undefined);
    const payload = calls("automations.create")[0][1] as Record<string, unknown>;
    expect(payload.topics).toEqual(["Topic", "Other"]);
    expect(payload.answers).toEqual(rules[0].answers);
    expect(payload.stopWords).toEqual(["refund"]);
  });

  it("stops waiting without using a late answer, and a new ask gets a new request id", async () => {
    let release: (value: RuleSimplifySuggestion) => void = () => undefined;
    fakeHost({
      "rules.simplify": () => new Promise((resolve) => (release = resolve as typeof release)),
    });
    await mount();
    await press("Suggest simpler rules");
    expect(container.textContent).toContain("Asking");
    await press("Stop waiting");
    await act(async () => release(suggestion()));
    await act(async () => undefined);
    expect(container.textContent).not.toContain("rules would change");
    expect(button("Suggest simpler rules")).toBeTruthy();
    fakeHost();
    await press("Suggest simpler rules");
    await act(async () => undefined);
    expect(container.textContent).toContain("2 of 3 rules would change");
    expect(calls("automations.create")).toHaveLength(0);
  });

  it("retries a failed ask with the same request id and uses a new one when the ask changes", async () => {
    let fail = true;
    fakeHost({
      "rules.simplify": () => {
        if (fail) throw new Error("The model did not answer");
        return suggestion();
      },
    });
    await mount();
    await press("Suggest simpler rules");
    await act(async () => undefined);
    expect(container.textContent).toContain("The model did not answer");
    await press("Try again");
    await act(async () => undefined);
    const asks = calls("rules.simplify");
    expect(asks).toHaveLength(2);
    expect(asks[1][2]).toBe(asks[0][2]);
    // Editing the ask makes it a different question.
    await type(container.querySelector<HTMLTextAreaElement>("textarea")!, "narrower please");
    await press("Try again");
    await act(async () => undefined);
    expect(calls("rules.simplify")[2][2]).not.toBe(asks[0][2]);
    fail = false;
    await press("Try again");
    await act(async () => undefined);
    expect(container.textContent).toContain("2 of 3 rules would change");
  });

  it("explains why asking is not possible", async () => {
    await mount({ online: false });
    expect(button("Suggest simpler rules").disabled).toBe(true);
    expect(container.textContent).toContain("The computer is offline.");
    fakeHost({ "policy.get": () => ({ effective: {} }) });
    await mount({ list: rules });
    await act(async () => undefined);
    expect(button("Suggest simpler rules").disabled).toBe(true);
    expect(container.textContent).toContain("Choose a text agent in Settings first.");
    fakeHost();
    await mount({ list: [] });
    expect(button("Suggest simpler rules").disabled).toBe(true);
    expect(container.textContent).toContain("Create a reply rule first.");
    expect(calls("rules.simplify")).toHaveLength(0);
  });
});

describe("Rule simplify helpers", () => {
  const original = rules[0];
  const proposal = proposalFor(original, "Simpler");
  const edit = {
    name: "Simpler",
    dailyLimit: "5",
    topics: ["Topic"],
    answerKeys: [JSON.stringify(["help", "fact-a"])],
    extraStops: "",
  };
  const topic = (id: string) => profiles[0].facts.find((fact) => fact.id === id)?.topic;
  it("returns the proposal verbatim when the owner edits nothing", () => {
    expect(ruleDraftFromReview(proposal, original, edit)).toEqual(proposal.proposed);
    expect(ruleDraftFromReview(proposal, original, edit).topics).toBe(proposal.proposed.topics);
    expect(simplifyProblems(proposal, original, edit, topic)).toEqual([]);
  });
  it("rejects a proposal whose original rule is gone", () => {
    expect(simplifyProblems(proposal, undefined, edit, topic)).toHaveLength(1);
  });
});
