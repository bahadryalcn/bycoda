// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialAccount, SocialCampaign } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import type { PlanSuggestion } from "../model/socialSuggestions";
import { PlanSuggestionPanel } from "./PlanSuggestion";

let element: HTMLDivElement, root: Root;
const request = vi.fn();
const onAccept = vi.fn();
const onClose = vi.fn();
const client = { request } as unknown as SocialClient;
const account = {
  id: "a1",
  name: "@Owner",
  platform: "x",
  grants: { p1: ["read", "draft", "publish"] },
} as unknown as SocialAccount;
const campaign = (id: string, name: string) =>
  ({
    id,
    name,
    projectIds: ["p1"],
    variants: [],
    revision: 1,
    paused: false,
  }) as unknown as SocialCampaign;
const eligible = [campaign("c1", "Launch"), campaign("c2", "Feature"), campaign("c3", "Tips")];
const suggestion: PlanSuggestion = {
  accountId: "a1",
  projectId: "p1",
  name: "Weekday posts",
  campaignIds: ["c1", "c2", "c3"],
  schedule: {
    timeZone: "Europe/Istanbul",
    startTime: "09:00",
    endTime: "18:00",
    minIntervalMinutes: 360,
    maxIntervalMinutes: 720,
  },
  rationale: "Oldest approved content first.",
  excluded: [],
  unapprovedCampaignIds: ["c3"],
  questions: ["Which days should be skipped?"],
  agent: { provider: "codex", model: "fixture-model" },
  requiresOwnerActivation: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request.mockReset().mockResolvedValue(suggestion);
  onAccept.mockClear();
  onClose.mockClear();
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

async function mount(props: Partial<Parameters<typeof PlanSuggestionPanel>[0]> = {}) {
  await act(async () =>
    root.render(
      createElement(PlanSuggestionPanel, {
        client,
        account,
        projectId: "p1",
        projectName: "Product",
        eligible,
        hostOnline: true,
        agent: { provider: "codex", model: "fixture-model" },
        agentState: "ready",
        replacesDraft: false,
        onAccept,
        onClose,
        ...props,
      }),
    ),
  );
}
const button = (label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  )!;
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const saveCalls = () =>
  request.mock.calls.filter(([action]) => !["plans.suggest", "policy.get"].includes(action));
async function ask() {
  await act(async () => button("Suggest a plan").click());
  await act(async () => undefined);
}

it("asks, reviews, edits and accepts the edited draft without calling any save operation", async () => {
  await mount();
  await type(element.querySelector("textarea")!, "  one post a day  ");
  await ask();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "plans.suggest",
    { accountId: "a1", projectId: "p1", instructions: "one post a day" },
    expect.any(String),
  );
  const review = element.querySelector('[role="group"]')!;
  expect(review.textContent).toContain("@Owner");
  expect(review.textContent).toContain("Product");
  expect(review.textContent).toContain("codex · fixture-model");
  expect(review.textContent).toContain("3 campaigns");
  expect(review.textContent).toContain("Oldest approved content first.");
  expect(review.textContent).toContain("Which days should be skipped?");
  // The unapproved pool entry is flagged and the plan-level warning names the count.
  expect(review.textContent).toContain("Approval needed");
  expect(review.textContent).toContain("1 of 3 campaigns are not approved");
  // Edit: rename, move the last campaign up, drop the first one.
  await type(element.querySelector<HTMLInputElement>("input")!, "Edited plan");
  await act(async () => button("Move campaign 3 up").click());
  await act(async () => button("Remove campaign 1").click());
  expect(
    Array.from(element.querySelectorAll(".social-plan-pool-name")).map((item) =>
      item.textContent?.replace(/^\d+\. /, ""),
    ),
  ).toEqual(["Tips", "Feature"]);
  // Edit the schedule through its fields.
  const hours = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  await type(hours[0], "1");
  expect(element.textContent).toContain("at least 1 and at most 12 hours apart");
  await act(async () => button("Use as plan draft").click());
  expect(onAccept).toHaveBeenCalledTimes(1);
  expect(onAccept).toHaveBeenCalledWith({
    name: "Edited plan",
    accountId: "a1",
    projectId: "p1",
    campaignIds: ["c3", "c2"],
    schedule: {
      timeZone: "Europe/Istanbul",
      startTime: "09:00",
      endTime: "18:00",
      minHours: "1",
      maxHours: "12",
    },
  });
  expect(saveCalls()).toEqual([]);
});

it("reject discards the suggestion and changes nothing", async () => {
  await mount();
  await ask();
  expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("Weekday posts");
  await act(async () => button("Discard suggestion").click());
  expect(onAccept).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(element.querySelector("input")).toBeNull();
  expect(button("Suggest a plan")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
});

it("retry reuses the request id and a new ask uses a new one", async () => {
  request.mockRejectedValueOnce(new Error("The model timed out."));
  await mount();
  await ask();
  expect(element.querySelector('[role="alert"], .social-notice')?.textContent).toContain(
    "The model timed out.",
  );
  const first = request.mock.calls[0];
  await act(async () => button("Try again").click());
  await act(async () => undefined);
  const retry = request.mock.calls[1];
  expect(retry[2]).toBe(first[2]);
  expect(retry[1]).toEqual(first[1]);
  expect(element.querySelector<HTMLInputElement>("input")?.value).toBe("Weekday posts");
  // A fresh ask after discarding is a new user-initiated request.
  await act(async () => button("Discard suggestion").click());
  await ask();
  expect(request.mock.calls[2][2]).not.toBe(first[2]);
});

it("stop waiting ignores a late answer", async () => {
  let resolve: (value: PlanSuggestion) => void = () => undefined;
  request.mockImplementationOnce(
    () =>
      new Promise<PlanSuggestion>((done) => {
        resolve = done;
      }),
  );
  await mount();
  await act(async () => button("Suggest a plan").click());
  expect(button("Stop waiting")).toBeTruthy();
  expect(element.textContent).toContain("nothing is saved yet");
  await act(async () => button("Stop waiting").click());
  await act(async () => resolve(suggestion));
  expect(element.querySelector("input")).toBeNull();
  expect(button("Suggest a plan").disabled).toBe(false);
  expect(onAccept).not.toHaveBeenCalled();
});

it("states why asking is unavailable and does not ask", async () => {
  const cases: [Partial<Parameters<typeof PlanSuggestionPanel>[0]>, string][] = [
    [{ hostOnline: false }, "The computer is offline."],
    [{ account: undefined }, "Choose a sharing account first."],
    [{ projectId: "" }, "Choose a project first."],
    [
      { account: { ...account, grants: { p1: ["read"] } } as unknown as SocialAccount },
      "Grant publishing permission for this project in Accounts first.",
    ],
    [{ agent: undefined, agentState: "missing" }, "Choose a text agent in Settings first."],
    [{ eligible: [] }, "Create an active campaign for this account and project first."],
  ];
  for (const [props, reason] of cases) {
    await mount(props);
    expect(element.textContent, reason).toContain(reason);
    expect(button("Suggest a plan").disabled, reason).toBe(true);
  }
  await mount({
    eligible: Array.from({ length: 51 }, (_, index) => campaign(`c${index}`, `Campaign ${index}`)),
  });
  expect(element.textContent).toContain("Choose at most 50 campaigns for the suggestion.");
  expect(button("Suggest a plan").disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("warns that accepting replaces an unfinished draft and blocks an invalid edited schedule", async () => {
  await mount({ replacesDraft: true });
  await ask();
  expect(element.textContent).toContain("It replaces the unfinished plan draft in the form.");
  const hours = Array.from(element.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  await type(hours[0], "20");
  expect(element.textContent).toContain(
    "The shortest interval cannot exceed the longest interval.",
  );
  expect(button("Use as plan draft").disabled).toBe(true);
});
