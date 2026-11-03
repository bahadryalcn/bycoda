// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SocialBusyContext } from "./socialContext";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import { PublishingPlans as Plans } from "./SocialPublishingPlans";
import type { SocialPublishingPlan, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { chooseSocialValue } from "./socialTestControls";

const PublishingPlans = withQueryClient(Plans);
let container: HTMLDivElement, root: Root;
const request = vi.fn();
const plan: SocialPublishingPlan = {
  id: "plan",
  name: "Günlük X",
  accountId: "account",
  projectId: "project",
  campaigns: [{ campaignId: "campaign", revision: 1 }],
  schedule: {
    timeZone: "Europe/Istanbul",
    startTime: "09:00",
    endTime: "18:00",
    minIntervalMinutes: 120,
    maxIntervalMinutes: 300,
  },
  enabled: false,
  nextIndex: 0,
  revision: 1,
  createdAt: 1,
};
function snapshot(change: Partial<SocialSnapshot> = {}): SocialSnapshot {
  return {
    executorId: "host",
    hostOnline: true,
    sendingEnabled: true,
    stopped: false,
    pollingEnabled: false,
    accounts: [
      {
        id: "account",
        name: "@Owner",
        platform: "x",
        platformId: "owner",
        accountType: "member",
        scopes: [],
        accessApproved: true,
        connected: true,
        paused: false,
        executorId: "host",
        grants: { project: ["read", "draft", "publish"] },
        createdAt: 1,
      },
    ],
    campaigns: [
      {
        id: "campaign",
        name: "Yeni özellik",
        projectIds: ["project"],
        revision: 1,
        paused: false,
        createdAt: 1,
        variants: [
          {
            accountId: "account",
            text: "Sahibinin onayladığı içerik",
            media: [],
            scheduledAt: 1,
            factIds: [],
          },
        ],
      },
    ],
    threads: [],
    contacts: [],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: {},
    publishingPlans: [{ ...plan }],
    approvedCampaignIds: ["campaign"],
    ...change,
  };
}
const onOpenContent = vi.fn();
const onOpenAccounts = vi.fn();
async function render(value: SocialSnapshot, extraProject = false, busy = false) {
  await act(async () =>
    root.render(
      createElement(
        SocialBusyContext.Provider,
        { value: busy },
        createElement(PublishingPlans, {
          snapshot: value,
          client: { request } as unknown as SocialClient,
          projects: [
            { id: "project", name: "Product", cwd: "/product" },
            ...(extraProject ? [{ id: "other", name: "Other project", cwd: "/other" }] : []),
          ],
          initialProject: "project",
          onOpenContent,
          onOpenAccounts,
          run: async (work) => {
            try {
              await work();
              return true;
            } catch {
              return false;
            }
          },
        }),
      ),
    ),
  );
}
function buttonName(button: HTMLButtonElement) {
  const copy = button.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim();
}
/** Dialog controls live in the shared Modal (document.body), the plan list in the container. */
function dialogButton(text: string) {
  const target = Array.from(document.body.querySelectorAll("button")).find(
    (item) => buttonName(item) === text || item.getAttribute("aria-label") === text,
  );
  expect(target, text).toBeTruthy();
  return target!;
}
async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const dialogForm = () => document.body.querySelector<HTMLFormElement>("form.social-plan-form")!;
const stepButton = (label: string) =>
  document.body.querySelector<HTMLButtonElement>(
    `nav[aria-label="Plan steps"] button[aria-label="${label}"]`,
  )!;
const currentStep = () =>
  document.body.querySelector('nav[aria-label="Plan steps"] [aria-current="step"]')?.textContent ??
  "";
const nameInput = () => dialogForm().querySelector<HTMLInputElement>("input")!;
const mutatingCalls = () =>
  request.mock.calls.filter(([action]) => String(action).startsWith("publishing-plans."));
function button(text: string) {
  const target = Array.from(container.querySelectorAll("button")).find(
    (item) => buttonName(item) === text,
  );
  expect(target, text).toBeTruthy();
  return target!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onOpenContent.mockReset();
  onOpenAccounts.mockReset();
  request.mockReset().mockResolvedValue({});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("preserves an open plan draft and its original revision when another owner saves newer settings", async () => {
  await render(snapshot());
  await act(async () => button("Edit plan").click());
  await setInput(nameInput(), "Unsaved plan");
  await render(snapshot({ publishingPlans: [{ ...plan, revision: 2, name: "Newer plan" }] }));
  // Saving happens on the last step only.
  await act(async () => dialogButton("Next").click());
  await act(async () => dialogButton("Review plan").click());
  expect(mutatingCalls()).toEqual([]);
  request.mockRejectedValue(new Error("Publishing plan changed in another client"));
  await act(async () => dialogButton("Save changes as paused").click());
  expect(request).toHaveBeenCalledWith(
    "publishing-plans.update",
    expect.objectContaining({ id: plan.id, expectedRevision: 1, name: "Unsaved plan" }),
  );
  await act(async () => dialogButton("Back").click());
  await act(async () => dialogButton("Back").click());
  expect(nameInput().value).toBe("Unsaved plan");
});

it("requires owner review of the exact plan revision before activation", async () => {
  await render(snapshot());
  expect(button("Enable automatic publishing").disabled).toBe(true);
  const review = container.querySelector<HTMLInputElement>(".social-check input")!;
  await act(async () => review.click());
  expect(button("Enable automatic publishing").disabled).toBe(false);
  await act(async () => button("Enable automatic publishing").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.activate", {
    id: "plan",
    revision: 1,
    confirm: "ACTIVATE_PUBLISHING_PLAN",
  });
  await render(snapshot({ publishingPlans: [{ ...plan, revision: 2 }] }));
  expect(container.querySelector<HTMLInputElement>(".social-check input")!.checked).toBe(false);
  expect(button("Enable automatic publishing").disabled).toBe(true);
});

it("explains missing campaign approval and preserves global sending restrictions", async () => {
  await render(snapshot({ approvedCampaignIds: [] }));
  await act(async () => container.querySelector<HTMLInputElement>(".social-check input")!.click());
  expect(button("Enable automatic publishing").disabled).toBe(true);
  expect(container.textContent).toContain("approve every pool item for publishing");
  await render(snapshot({ sendingEnabled: false }));
  expect(button("Enable automatic publishing").disabled).toBe(true);
  expect(container.textContent).toContain("Sending is off");
  expect(request).not.toHaveBeenCalled();
});

it("shows finite-pool completion and exposes a direct pause action for live plans", async () => {
  await render(
    snapshot({
      publishingPlans: [{ ...plan, enabled: true, nextRunAt: Date.UTC(2026, 9, 12, 6) }],
    }),
  );
  expect(container.textContent).toContain("09:00");
  await act(async () => button("Pause plan").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.pause", { id: "plan" });
  await render(snapshot({ publishingPlans: [{ ...plan, nextIndex: 1, completedAt: 2 }] }));
  expect(container.textContent).toContain("Content pool completed");
  expect(button("Enable automatic publishing").disabled).toBe(true);
});

it("makes unsupported host versions a clear non-actionable state", async () => {
  await render(snapshot({ publishingPlans: undefined }));
  expect(container.textContent).toContain("Host update required");
  expect(container.querySelector("form")).toBeNull();
});

it("shows an owner pause as neutral and keeps unknown diagnostics behind an optional detail", async () => {
  await render(snapshot({ publishingPlans: [{ ...plan, pausedReason: "Paused by owner." }] }));
  expect(container.querySelector(".social-row [data-status]")?.getAttribute("data-status")).toBe(
    "paused",
  );
  expect(container.textContent).toContain("Plan paused by you");
  expect(container.textContent).not.toContain("Paused by owner.");
  const diagnostic = "Provider returned an unexpected outcome: test-42.";
  await render(snapshot({ publishingPlans: [{ ...plan, pausedReason: diagnostic }] }));
  expect(container.querySelector(".social-row [data-status]")?.getAttribute("data-status")).toBe(
    "review",
  );
  expect(container.textContent).toContain("Check the account connection, publishing permissions");
  const detail = Array.from(container.querySelectorAll("details")).find(
    (item) => item.querySelector("summary")?.textContent === "Technical detail",
  );
  expect(detail?.open).toBe(false);
  expect(detail?.querySelector("p")?.textContent).toBe(diagnostic);
});

it("keeps the published prefix fixed while an owner edits the remaining pool", async () => {
  const value = snapshot();
  value.campaigns = ["campaign", "next", "last"].map((id) => ({
    ...value.campaigns[0],
    id,
    name: id,
  }));
  value.publishingPlans = [
    {
      ...plan,
      nextIndex: 1,
      campaigns: value.campaigns.map((campaign) => ({
        campaignId: campaign.id,
        revision: campaign.revision,
      })),
    },
  ];
  await render(value);
  await act(async () => button("Edit plan").click());
  const form = document.body.querySelector("form")!;
  expect(Array.from(form.querySelectorAll("select")).every((control) => control.disabled)).toBe(
    true,
  );
  expect(
    form.querySelector<HTMLButtonElement>('button[aria-label^="Sharing account:"]')?.disabled,
  ).toBe(true);
  expect(form.querySelector<HTMLButtonElement>('button[aria-label^="Project:"]')?.disabled).toBe(
    true,
  );
  const moves = Array.from(form.querySelectorAll<HTMLButtonElement>(".social-pool-editor button"));
  expect(moves[0].disabled).toBe(true);
  expect(moves[1].disabled).toBe(true);
  expect(moves[2].disabled).toBe(true);
  expect(moves[3].disabled).toBe(false);
  expect(form.textContent).toContain(
    "The order of sent content, the account and the project are kept",
  );
});

it("clears the selected campaign pool when its searchable account changes", async () => {
  const value = snapshot();
  value.accounts.push({ ...value.accounts[0], id: "second", name: "Other account" });
  await render(value);
  await act(async () => button("Edit plan").click());
  const form = document.body.querySelector("form")!;
  const account = form.querySelector<HTMLButtonElement>('button[aria-label^="Sharing account:"]')!;
  expect(form.querySelectorAll("select[required]")).toHaveLength(2);
  expect(form.textContent).toContain("Yeni özellik");
  await chooseSocialValue(account, "second");
  expect(form.querySelector<HTMLSelectElement>("select")?.value).toBe("second");
  expect(form.querySelector('[aria-label="Seçilen değerler"]')).toBeNull();
  expect(form.textContent).not.toContain("Yeni özellik");
});

it("clears the selected campaign pool when its searchable project changes", async () => {
  await render(snapshot(), true);
  await act(async () => button("Edit plan").click());
  const form = document.body.querySelector("form")!;
  expect(form.textContent).toContain("Yeni özellik");
  await chooseSocialValue(
    form.querySelector<HTMLButtonElement>('button[aria-label^="Project:"]')!,
    "other",
  );
  expect(Array.from(form.querySelectorAll("select")).at(1)?.value).toBe("other");
  expect(form.textContent).not.toContain("Yeni özellik");
});

it("locks searchable plan scope while preserving the open draft during another operation", async () => {
  const value = snapshot();
  await render(value, true);
  await act(async () => button("Edit plan").click());
  const selected = () =>
    ["Sharing account", "Project"].map((name) =>
      [...document.body.querySelectorAll("label")]
        .find((label) => label.textContent?.trim().startsWith(name))
        ?.querySelector("button"),
    );
  await render(value, true, true);
  const locked = selected();
  expect(locked).toHaveLength(2);
  locked.forEach((item) => expect(item?.disabled).toBe(true));
  await render(value, true, false);
  selected().forEach((item) => expect(item?.disabled).toBe(false));
  expect(document.body.querySelector("form")).toBeTruthy();
  expect(mutatingCalls()).toEqual([]);
});

const formButton = (text: string) => {
  const target = Array.from(dialogForm().querySelectorAll("button")).find(
    (item) => buttonName(item) === text,
  );
  expect(target, text).toBeTruthy();
  return target!;
};
const fixtureAgent = { provider: "codex", model: "fixture-model" };
const suggestion = {
  accountId: "account",
  projectId: "project",
  name: "AI weekday plan",
  campaignIds: ["campaign"],
  schedule: {
    timeZone: "Europe/Istanbul",
    startTime: "10:00",
    endTime: "16:00",
    minIntervalMinutes: 180,
    maxIntervalMinutes: 360,
  },
  rationale: "Fixture rationale.",
  excluded: [],
  unapprovedCampaignIds: [],
  questions: [],
  agent: fixtureAgent,
  requiresOwnerActivation: true,
};
function answer(action: string) {
  if (action === "policy.get") return { effective: { agent: fixtureAgent } };
  if (action === "plans.suggest") return suggestion;
  return {};
}

it("splits the dialog into three steps and keeps every value across Back, Next and step jumps", async () => {
  await render(snapshot());
  await act(async () => button("Edit plan").click());
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  expect(stepButton("1 Account and content")).toBeTruthy();
  expect(stepButton("2 Schedule")).toBeTruthy();
  expect(stepButton("3 Review")).toBeTruthy();
  expect(currentStep()).toContain("Account and content");
  await setInput(nameInput(), "Renamed");
  await act(async () => dialogButton("Next").click());
  expect(currentStep()).toContain("Schedule");
  await setInput(
    dialogForm().querySelector<HTMLInputElement>("input.date-time-time-input")!,
    "10:00",
  );
  await act(async () => dialogButton("Review plan").click());
  expect(currentStep()).toContain("Review");
  const text = dialogForm().textContent!;
  expect(text).toContain("Renamed");
  expect(text).toContain("@Owner");
  expect(text).toContain("Product");
  expect(text).toContain("1 campaigns");
  expect(text).toContain("Yeni özellik");
  expect(text).toContain("Approved");
  expect(text).toContain("between 10:00 and 18:00");
  expect(text).toContain("saving does not publish");
  await act(async () => stepButton("1 Account and content").click());
  expect(nameInput().value).toBe("Renamed");
  await act(async () => dialogButton("Next").click());
  expect(dialogForm().querySelector<HTMLInputElement>("input.date-time-time-input")!.value).toBe(
    "10:00",
  );
  expect(mutatingCalls()).toEqual([]);
});

it("resolves blockers in the step that owns them and disables Next with a stated reason", async () => {
  const value = snapshot({ approvedCampaignIds: [] });
  value.accounts[0].grants = { project: ["read", "draft"] };
  await render(value);
  await act(async () => button("Edit plan").click());
  // Activation blockers are fixed here but do not stop a paused plan from being saved.
  expect(dialogForm().textContent).toContain("no publishing permission");
  expect(dialogForm().textContent).toContain("1 of 1 campaigns are not approved");
  expect(dialogButton("Next").disabled).toBe(false);
  await act(async () => formButton("Open Campaigns").click());
  expect(onOpenContent).toHaveBeenCalledWith("project");
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("Edit publishing plan").click());
  await act(async () => formButton("Open Accounts").click());
  expect(onOpenAccounts).toHaveBeenCalledOnce();
  await act(async () => button("Edit publishing plan").click());
  // A hard blocker disables Next, says why, and keeps later steps unreachable.
  await setInput(nameInput(), "");
  expect(dialogButton("Next").disabled).toBe(true);
  expect(document.body.querySelector("footer")?.textContent).toContain("Enter a plan name.");
  expect(stepButton("2 Schedule").getAttribute("aria-disabled")).toBe("true");
  expect(stepButton("3 Review").getAttribute("aria-disabled")).toBe("true");
  await setInput(nameInput(), "Named");
  await act(async () => dialogButton("Next").click());
  // An invalid schedule is explained in the schedule step, not on the last one.
  const hours = Array.from(dialogForm().querySelectorAll<HTMLInputElement>('input[type="number"]'));
  await setInput(hours[0], "9");
  expect(dialogButton("Review plan").disabled).toBe(true);
  expect(document.body.querySelector("footer")?.textContent).toContain(
    "The shortest interval cannot exceed the longest interval.",
  );
  expect(stepButton("3 Review").getAttribute("aria-disabled")).toBe("true");
  await setInput(hours[0], "2");
  expect(dialogButton("Review plan").disabled).toBe(false);
});

it("states that no campaign is available and points to Campaigns", async () => {
  await render(snapshot({ campaigns: [], approvedCampaignIds: [] }));
  await act(async () => button("Edit plan").click());
  expect(dialogForm().textContent).toContain("There are no campaigns for this account and project");
  expect(dialogButton("Next").disabled).toBe(true);
  await act(async () => formButton("Open Campaigns").click());
  expect(onOpenContent).toHaveBeenCalledWith("project");
});

it("keeps the unsaved draft and the current step when the dialog is closed and reopened", async () => {
  await render(snapshot());
  await act(async () => button("Edit plan").click());
  await setInput(nameInput(), "Kept draft");
  await act(async () => dialogButton("Next").click());
  await setInput(
    dialogForm().querySelector<HTMLInputElement>("input.date-time-time-input")!,
    "11:00",
  );
  await act(async () => dialogButton("Close").click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  // Another snapshot (for example after visiting another section) must not reset it either.
  await render(snapshot());
  await act(async () => button("Edit publishing plan").click());
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  expect(currentStep()).toContain("Schedule");
  expect(dialogForm().querySelector<HTMLInputElement>("input.date-time-time-input")!.value).toBe(
    "11:00",
  );
  await act(async () => dialogButton("Back").click());
  expect(nameInput().value).toBe("Kept draft");
  expect(mutatingCalls()).toEqual([]);
});

it("advances on Enter only when the step is valid and ignores the second click of a double-click on the last step", async () => {
  await render(snapshot());
  await act(async () => button("Edit plan").click());
  const submit = () =>
    act(async () =>
      dialogForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await setInput(nameInput(), "");
  await submit();
  expect(currentStep()).toContain("Account and content");
  await setInput(nameInput(), "Enter plan");
  await submit();
  expect(currentStep()).toContain("Schedule");
  await submit();
  expect(currentStep()).toContain("Review");
  // The second click of a double-click on Next lands on the Save button: it is not a save.
  await act(async () =>
    dialogButton("Save changes as paused").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }),
    ),
  );
  expect(mutatingCalls()).toEqual([]);
  await act(async () => dialogButton("Save changes as paused").click());
  expect(request).toHaveBeenCalledWith(
    "publishing-plans.update",
    expect.objectContaining({ id: "plan", expectedRevision: 1, name: "Enter plan" }),
  );
});

it("keeps pausing the plan and stopping all sending reachable while an active plan is edited", async () => {
  await render(
    snapshot({
      publishingPlans: [{ ...plan, enabled: true, nextRunAt: Date.UTC(2026, 9, 12, 6) }],
    }),
  );
  await act(async () => button("Edit plan").click());
  await act(async () => dialogButton("Pause plan").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.pause", { id: "plan" });
  await act(async () => dialogButton("Stop all sending").click());
  expect(request).toHaveBeenCalledWith("execution.stop", { stopped: true });
  await act(async () => dialogButton("Next").click());
  expect(dialogButton("Pause plan")).toBeTruthy();
  expect(dialogButton("Stop all sending")).toBeTruthy();
});

it("loads an accepted AI suggestion as an unsaved draft on the Review step and saves nothing itself", async () => {
  request.mockReset().mockImplementation(async (action: string) => answer(action));
  await render(snapshot({ publishingPlans: [] }));
  expect(container.textContent).toContain("No publishing plans yet");
  const entry = container.querySelector<HTMLButtonElement>(".social-plan-empty-actions button")!;
  expect(entry.disabled).toBe(false);
  await act(async () => entry.click());
  await act(async () => undefined);
  const panel = document.body.querySelector<HTMLElement>("form.social-plan-suggest")!;
  expect(panel.textContent).toContain("codex · fixture-model");
  await act(async () => dialogButton("Suggest a plan").click());
  await act(async () => undefined);
  const review = document.body.querySelector<HTMLElement>(".social-plan-suggest[role=group]")!;
  expect(review.textContent).toContain("Fixture rationale.");
  expect(mutatingCalls()).toEqual([]);
  // The actions live in the fixed dialog footer, outside the scrolling review.
  expect(review.querySelector("footer")).toBeNull();
  await act(async () => dialogButton("Use as plan draft").click());
  expect(currentStep()).toContain("Review");
  expect(dialogForm().textContent).toContain("AI weekday plan");
  expect(dialogForm().textContent).toContain("between 10:00 and 16:00");
  expect(mutatingCalls()).toEqual([]);
  expect(request.mock.calls.filter(([action]) => action === "plans.suggest")).toHaveLength(1);
  await act(async () => dialogButton("Save plan as paused").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.create", {
    name: "AI weekday plan",
    accountId: "account",
    projectId: "project",
    campaignIds: ["campaign"],
    schedule: suggestion.schedule,
  });
  expect(mutatingCalls()).toHaveLength(1);
});

it("rejecting an AI suggestion leaves the plan draft untouched", async () => {
  request.mockReset().mockImplementation(async (action: string) => answer(action));
  await render(snapshot());
  await act(async () => button("Edit plan").click());
  await setInput(nameInput(), "My draft");
  await act(async () => formButton("Ask AI to suggest a plan").click());
  await act(async () => undefined);
  await act(async () =>
    Array.from(document.body.querySelectorAll("button"))
      .find((item) => buttonName(item) === "Suggest a plan")!
      .click(),
  );
  await act(async () => undefined);
  expect(document.body.textContent).toContain("It replaces the unfinished plan draft");
  await act(async () => dialogButton("Discard suggestion").click());
  await act(async () => dialogButton("Back to the plan").click());
  expect(nameInput().value).toBe("My draft");
  expect(mutatingCalls()).toEqual([]);
});

it("disables the AI entry with a stated reason while the Host is offline or no text agent is chosen", async () => {
  request.mockReset().mockImplementation(async (action: string) => answer(action));
  await render(snapshot({ hostOnline: false }));
  await act(async () => button("Edit plan").click());
  await act(async () => undefined);
  expect(formButton("Ask AI to suggest a plan").disabled).toBe(true);
  expect(dialogForm().textContent).toContain("The computer is offline.");
  request
    .mockReset()
    .mockImplementation(async (action: string) =>
      action === "policy.get" ? { effective: {} } : answer(action),
    );
  await render(snapshot({ hostOnline: true }));
  await act(async () => undefined);
  await act(async () => undefined);
  expect(formButton("Ask AI to suggest a plan").disabled).toBe(true);
  expect(dialogForm().textContent).toContain("Choose a text agent in Settings first.");
  expect(request.mock.calls.some(([action]) => action === "plans.suggest")).toBe(false);
});
