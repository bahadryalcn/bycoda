// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactSuggestResult } from "../model/socialSuggestions";
import {
  FactSuggestions,
  acceptableCandidates,
  candidateBlock,
  type FactReview,
} from "./FactSuggestions";

let element: HTMLDivElement, root: Root;
const handlers = {
  onEdit: vi.fn(),
  onAccept: vi.fn(),
  onAcceptAll: vi.fn(),
  onReject: vi.fn(),
  onRejectAll: vi.fn(),
};
const result: FactSuggestResult = {
  accountId: "a",
  projectId: "p",
  sourceLabel: "Pricing page",
  suggestions: [
    { id: "c1", topic: "Plans", text: "A free plan exists.", quote: "Start for free" },
    { id: "c2", topic: "Old", text: "Free tier", quote: "free tier", duplicateOfFactId: "f1" },
  ],
  skipped: 1,
  agent: { provider: "codex" },
  verified: false,
};
const review = (over: Partial<FactReview> = {}): FactReview => ({
  result,
  edits: {},
  hidden: [],
  accepted: [],
  ...over,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.values(handlers).forEach((handler) => handler.mockClear());
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});
async function mount(value: FactReview, slotsLeft = 10) {
  await act(async () =>
    root.render(
      createElement(FactSuggestions, {
        review: value,
        projectName: "Alpha",
        accountName: "Main",
        locked: false,
        slotsLeft,
        duplicateTopic: () => "Pricing",
        ...handlers,
      }),
    ),
  );
}
const button = (label: string, scope: ParentNode = element) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label,
  )!;

describe("FactSuggestions", () => {
  it("labels the list as unverified and states count, scope, agent and skipped statements", async () => {
    await mount(review());
    const section = element.querySelector("section")!;
    expect(section.getAttribute("aria-label")).toBe("Suggestions - not verified yet");
    expect(section.textContent).toContain("2 suggestions from “Pricing page”");
    expect(section.textContent).toContain("Project: Alpha · Account: Main · Agent: codex");
    expect(element.querySelector('[data-testid="fact-skipped"]')?.textContent).toBe(
      "1 statement was dropped because the text does not support it.",
    );
    expect(section.textContent).toContain("becomes verified when you save it");
  });

  it("shows the supporting quote read-only and marks a duplicate as not acceptable", async () => {
    await mount(review());
    const [plans, old] = Array.from(element.querySelectorAll("li"));
    expect(plans.querySelector("blockquote")?.textContent).toBe("Start for free");
    expect(plans.querySelectorAll("input,textarea")).toHaveLength(2);
    expect(button("Accept", plans).disabled).toBe(false);
    expect(old.textContent).toContain("Duplicate");
    expect(old.textContent).toContain("Already a verified fact: Pricing");
    expect(button("Accept", old).disabled).toBe(true);
  });

  it("accepts all valid candidates and reports per-candidate actions", async () => {
    await mount(review());
    await act(async () => button("Accept all valid").click());
    expect(handlers.onAcceptAll).toHaveBeenCalledWith(["c1"]);
    await act(async () => button("Accept", element.querySelectorAll("li")[0]).click());
    expect(handlers.onAccept).toHaveBeenCalledWith(["c1"]);
    await act(async () => button("Reject", element.querySelectorAll("li")[1]).click());
    expect(handlers.onReject).toHaveBeenCalledWith("c2");
    await act(async () => button("Reject all").click());
    expect(handlers.onRejectAll).toHaveBeenCalled();
  });

  it("hides rejected candidates, marks accepted ones and handles an empty answer", async () => {
    await mount(review({ hidden: ["c2"], accepted: ["c1"] }));
    const items = Array.from(element.querySelectorAll("li"));
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Added - save to verify");
    expect(items[0].querySelector("button")).toBeNull();
    expect(button("Accept all valid").disabled).toBe(true);
    await mount(review({ result: { ...result, suggestions: [], skipped: 0 } }));
    expect(element.textContent).toContain("The text did not support any fact.");
    expect(element.querySelector('[data-testid="fact-skipped"]')).toBeNull();
  });

  it("limits accepting by the room left in the profile", () => {
    const value = review();
    expect(candidateBlock(value, result.suggestions[0], 0)).toContain("most facts");
    expect(acceptableCandidates(value, 0)).toEqual([]);
    expect(
      acceptableCandidates(
        review({
          result: {
            ...result,
            suggestions: [
              { id: "x", topic: "A", text: "a", quote: "a" },
              { id: "y", topic: "B", text: "b", quote: "b" },
            ],
          },
        }),
        1,
      ).map((item) => item.id),
    ).toEqual(["x"]);
  });
});
