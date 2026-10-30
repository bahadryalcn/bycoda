// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialAccount, SocialProjectProfile } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { FactSuggestResult } from "../model/socialSuggestions";
import { ProductKnowledge } from "./ProductKnowledge";
import { chooseSocialValue } from "./socialTestControls";

const Component = withQueryClient(ProductKnowledge);
let element: HTMLDivElement, root: Root;
const request = vi.fn();
const client = { request } as unknown as SocialClient;
const run = vi.fn(async (work: () => Promise<unknown>) => {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
});
const projects = [
  { id: "p", name: "Alpha project", cwd: "/a" },
  { id: "q", name: "Beta project", cwd: "/b" },
];
const profiles: SocialProjectProfile[] = [
  {
    projectId: "p",
    productName: "Demo",
    brandVoice: "Plain",
    facts: [{ id: "f1", topic: "Pricing", text: "Free tier", source: "https://example.test", verifiedAt: 1 }],
  },
  { projectId: "q", productName: "Other", brandVoice: "Plain", facts: [] },
];
const accounts = [
  { id: "a1", name: "Main account", grants: { p: ["draft"], q: ["draft"] } },
  { id: "a2", name: "Reader account", grants: { p: ["read"] } },
  { id: "a3", name: "Second drafter", grants: { p: ["draft"] } },
] as unknown as SocialAccount[];
const result = (over: Partial<FactSuggestResult> = {}): FactSuggestResult => ({
  accountId: "a1",
  projectId: "p",
  sourceLabel: "Pricing page",
  suggestions: [
    { id: "c1", topic: "Plans", text: "There is a free plan.", quote: "Start for free" },
    {
      id: "c2",
      topic: "Pricing again",
      text: "Free tier",
      quote: "free tier",
      duplicateOfFactId: "f1",
    },
    { id: "c3", topic: "Support", text: "Support is by email.", quote: "email us" },
  ],
  skipped: 2,
  agent: { provider: "codex", model: "fixture-model" },
  verified: false,
  ...over,
});
let suggestImpl: (input: Record<string, unknown>, id: string) => Promise<FactSuggestResult>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  suggestImpl = async () => result();
  run.mockClear();
  request.mockReset().mockImplementation(async (action: string, input: Record<string, unknown>, id: string) => {
    if (action === "policy.get")
      return { effective: { agent: { provider: "codex", model: "fixture-model" } } };
    if (action === "facts.suggest") return suggestImpl(input, id);
    if (action === "profiles.save") return {};
    throw new Error(`Unexpected ${action}`);
  });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mount(props: Partial<Parameters<typeof ProductKnowledge>[0]> = {}) {
  await act(async () =>
    root.render(
      createElement(Component, {
        client,
        profiles,
        projects,
        run,
        accounts,
        hostOnline: true,
        ...props,
      }),
    ),
  );
  await act(async () => undefined);
}
const button = (label: string, scope: ParentNode = document.body) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label,
  )!;
const click = async (label: string, scope: ParentNode = document.body) => {
  const target = button(label, scope);
  expect(target, `Missing button: ${label}`).toBeTruthy();
  await act(async () => target.click());
  await act(async () => undefined);
};
function control(label: string, scope: ParentNode = document.body) {
  const owner = Array.from(scope.querySelectorAll("label")).find((item) =>
    item.textContent?.trim().startsWith(label),
  );
  const found = owner?.htmlFor
    ? document.getElementById(owner.htmlFor)
    : owner?.querySelector("input,select,textarea,button[aria-haspopup]");
  expect(found, `Missing control: ${label}`).toBeTruthy();
  return found as HTMLInputElement & HTMLTextAreaElement & HTMLButtonElement;
}
async function type(label: string, value: string, scope: ParentNode = document.body) {
  const target = control(label, scope);
  const prototype =
    target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const section = (label: string) => document.body.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
const rows = () =>
  Array.from(section("Suggestions - not verified yet")?.querySelectorAll<HTMLElement>("li") ?? []);
const row = (topic: string) => rows().find((item) => item.getAttribute("aria-label") === topic)!;
const calls = (action: string) => request.mock.calls.filter((call) => call[0] === action);
const writes = () =>
  request.mock.calls.filter((call) => !["policy.get", "facts.suggest"].includes(call[0] as string));

async function openSuggest() {
  await click("Manage");
  await click("Suggest facts from text");
}
async function fillAndAsk(text = "Start for free. Please email us.", label = "Pricing page") {
  await type("Source text", text);
  await type("Source label", label);
  await click("Suggest facts");
}

describe("product knowledge fact suggestions", () => {
  it("asks, reviews, edits and accepts into the draft without writing anything", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    expect(calls("facts.suggest")).toHaveLength(1);
    const [, input, requestId] = calls("facts.suggest")[0];
    expect(input).toEqual({
      accountId: "a1",
      projectId: "p",
      sourceLabel: "Pricing page",
      sourceText: "Start for free. Please email us.",
    });
    expect(typeof requestId).toBe("string");
    const review = section("Suggestions - not verified yet")!;
    expect(review.textContent).toContain("3 suggestions from “Pricing page”");
    expect(review.textContent).toContain("Project: Alpha project");
    expect(review.textContent).toContain("Account: Main account");
    expect(review.textContent).toContain("codex · fixture-model");
    expect(review.textContent).toContain(
      "2 statements were dropped because the text does not support them.",
    );
    expect(review.textContent).toContain("becomes verified when you save it");
    // The supporting quote is quoted text, never an editable control.
    const plans = row("Plans");
    expect(plans.querySelector("blockquote")?.textContent).toBe("Start for free");
    expect(Array.from(plans.querySelectorAll<HTMLInputElement>("input,textarea")).map((item) => item.value)).not.toContain(
      "Start for free",
    );
    await type("Fact text", "There is a free plan for small teams.", plans);
    await click("Accept", plans);
    const added = section("Added - save to verify")!;
    expect(added.textContent).toContain("There is a free plan for small teams.");
    expect(added.textContent).toContain('Suggested from "Pricing page"; accepted by owner');
    expect(row("Plans").textContent).toContain("Added - save to verify");
    expect(row("Plans").querySelector("button")).toBeNull();
    // Accepting writes nothing: no profiles.save, no other operation.
    expect(writes()).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("saves accepted facts only through the existing profiles.save payload", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await click("Accept", row("Support"));
    await click("Save added facts");
    expect(run).toHaveBeenCalledTimes(1);
    const saves = calls("profiles.save");
    expect(saves).toHaveLength(1);
    const payload = saves[0][1] as {
      projectId: string;
      productName: string;
      brandVoice: string;
      facts: { id: string; topic: string; text: string; source: string; verifiedAt: number }[];
    };
    expect(payload).toMatchObject({ projectId: "p", productName: "Demo", brandVoice: "Plain" });
    expect(payload.facts).toHaveLength(2);
    expect(payload.facts[0]).toEqual(profiles[0].facts[0]);
    expect(payload.facts[1]).toMatchObject({
      topic: "Support",
      text: "Support is by email.",
      source: 'Suggested from "Pricing page"; accepted by owner',
    });
    expect(typeof payload.facts[1].id).toBe("string");
    expect(typeof payload.facts[1].verifiedAt).toBe("number");
    // The draft row is gone and the saved candidate no longer sits in the review.
    expect(section("Added - save to verify")).toBeNull();
    expect(row("Support")).toBeUndefined();
  });

  it("rejects a candidate for this result only", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await click("Reject", row("Plans"));
    expect(row("Plans")).toBeUndefined();
    expect(section("Suggestions - not verified yet")!.textContent).toContain(
      "2 suggestions from “Pricing page”",
    );
    expect(writes()).toEqual([]);
  });

  it("disables accepting a duplicate and states why, and accepts all valid ones only", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    const duplicate = row("Pricing again");
    expect(duplicate.textContent).toContain("Duplicate");
    expect(duplicate.textContent).toContain("Already a verified fact: Pricing");
    expect(button("Accept", duplicate).disabled).toBe(true);
    await click("Accept all valid");
    const added = section("Added - save to verify")!;
    expect(added.querySelectorAll("li")).toHaveLength(2);
    expect(added.textContent).toContain("Plans");
    expect(added.textContent).toContain("Support");
    expect(added.textContent).not.toContain("Pricing again");
    expect(button("Accept all valid")?.disabled).toBe(true);
    expect(button("Accept", row("Pricing again")).disabled).toBe(true);
  });

  it("blocks accepting an emptied candidate with a reason", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await type("Fact text", "  ", row("Plans"));
    expect(button("Accept", row("Plans")).disabled).toBe(true);
    expect(row("Plans").textContent).toContain("Fill in the topic and the fact text first.");
  });

  it("reuses the request id on retry after an error and uses a new one for a new ask", async () => {
    suggestImpl = async () => {
      throw new Error("Model unavailable");
    };
    await mount();
    await openSuggest();
    await fillAndAsk();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Model unavailable");
    suggestImpl = async () => result();
    await click("Try again");
    const [first, second] = calls("facts.suggest");
    expect(second[2]).toBe(first[2]);
    expect(section("Suggestions - not verified yet")).toBeTruthy();
    // A new ask after an answer is a new request.
    await click("Suggest facts");
    const third = calls("facts.suggest")[2];
    expect(third[2]).not.toBe(first[2]);
  });

  it("uses a new request id when the input changed after an error", async () => {
    suggestImpl = async () => {
      throw new Error("Offline");
    };
    await mount();
    await openSuggest();
    await fillAndAsk();
    await type("Source text", "Another pasted text");
    await click("Try again");
    const [first, second] = calls("facts.suggest");
    expect(second[2]).not.toBe(first[2]);
  });

  it("stops waiting and ignores a late answer", async () => {
    let finish!: (value: FactSuggestResult) => void;
    suggestImpl = () => new Promise((resolve) => (finish = resolve));
    await mount();
    await openSuggest();
    await fillAndAsk();
    expect(button("Stop waiting")).toBeTruthy();
    expect(document.body.textContent).toContain("nothing is saved yet");
    await click("Stop waiting");
    expect(button("Stop waiting")).toBeUndefined();
    await act(async () => finish(result()));
    expect(section("Suggestions - not verified yet")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("explains why asking is blocked", async () => {
    await mount({ hostOnline: false });
    await openSuggest();
    await type("Source text", "Some text");
    await type("Source label", "A label");
    expect(button("Suggest facts")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("The computer is offline.");
    expect(calls("facts.suggest")).toHaveLength(0);
    expect(calls("policy.get")).toHaveLength(0);
    await act(async () => root.unmount());
    root = createRoot(element);
    await mount({ accounts: [accounts[1]] });
    await openSuggest();
    expect(document.body.textContent).toContain("No account has draft access to this project.");
    expect(button("Suggest facts")?.disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(element);
    request.mockImplementation(async (action: string) => {
      if (action === "policy.get") return { effective: {} };
      throw new Error(`Unexpected ${action}`);
    });
    await mount();
    await openSuggest();
    await type("Source text", "Some text");
    await type("Source label", "A label");
    expect(document.body.textContent).toContain("Choose a text agent in Settings first.");
    expect(button("Suggest facts")?.disabled).toBe(true);
  });

  it("offers only accounts with draft access, defaulting to the first one", async () => {
    await mount();
    await openSuggest();
    const trigger = control("Account");
    expect(trigger.textContent).toContain("Main account");
    await act(async () => trigger.click());
    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).map(
      (item) => item.textContent?.trim(),
    );
    expect(options).toEqual(["Main account", "Second drafter"]);
  });

  it("keeps unaccepted suggestions, the source text and the label while the dialog is closed", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await click("Accept", row("Support"));
    await act(async () => document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain("2 suggestions to review");
    expect(element.textContent).toContain("Unsaved changes");
    await click("Manage");
    expect(row("Plans")).toBeTruthy();
    expect(row("Support").textContent).toContain("Added - save to verify");
    expect(section("Added - save to verify")!.textContent).toContain("Support is by email.");
    expect(control("Source text").value).toBe("Start for free. Please email us.");
    expect(control("Source label").value).toBe("Pricing page");
  });

  it("never mixes candidates into the verified facts list or count", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await click("Accept", row("Plans"));
    const verified = section("Verified facts")!;
    expect(verified.querySelectorAll("li")).toHaveLength(1);
    expect(verified.textContent).toContain("Pricing");
    expect(verified.textContent).not.toContain("Plans");
    expect(verified.textContent).not.toContain("Support");
    expect(verified.querySelector("h3")?.textContent).toBe("Verified facts · 1");
    expect(element.textContent).toContain("Verified facts: 1");
    expect(section("Suggestions - not verified yet")!.contains(verified)).toBe(false);
    expect(verified.contains(section("Suggestions - not verified yet"))).toBe(false);
  });

  it("clears suggestions on reject all, on a new ask and on a project change", async () => {
    await mount();
    await openSuggest();
    await fillAndAsk();
    await click("Reject all");
    expect(section("Suggestions - not verified yet")).toBeNull();
    expect(control("Source text").value).toBe("Start for free. Please email us.");
    await click("Suggest facts");
    expect(rows()).toHaveLength(3);
    suggestImpl = async () => result({ suggestions: [], skipped: 0 });
    await click("Suggest facts");
    expect(rows()).toHaveLength(0);
    expect(section("Suggestions - not verified yet")!.textContent).toContain(
      "The text did not support any fact.",
    );
    suggestImpl = async () => result();
    await click("Suggest facts");
    expect(rows()).toHaveLength(3);
    await chooseSocialValue(control("Project"), "q");
    expect(section("Suggestions - not verified yet")).toBeNull();
    expect(control("Source text").value).toBe("");
  });
});
