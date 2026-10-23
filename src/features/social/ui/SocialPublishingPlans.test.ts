// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublishingPlans } from "./SocialPublishingPlans";
import type { SocialPublishingPlan, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { chooseSocialValue } from "./socialTestControls";

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
async function render(value: SocialSnapshot, extraProject = false) {
  await act(async () =>
    root.render(
      createElement(PublishingPlans, {
        snapshot: value,
        client: { request } as unknown as SocialClient,
        projects: [
          { id: "project", name: "Product", cwd: "/product" },
          ...(extraProject ? [{ id: "other", name: "Other project", cwd: "/other" }] : []),
        ],
        initialProject: "project",
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
  );
}
function buttonName(button: HTMLButtonElement) {
  const copy = button.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim();
}
function button(text: string) {
  const target = Array.from(container.querySelectorAll("button")).find(
    (item) => buttonName(item) === text,
  );
  expect(target, text).toBeTruthy();
  return target!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  const form = document.body.querySelector<HTMLFormElement>("form")!;
  const name = form.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      name,
      "Unsaved plan",
    );
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await render(snapshot({ publishingPlans: [{ ...plan, revision: 2, name: "Newer plan" }] }));
  request.mockRejectedValue(new Error("Publishing plan changed in another client"));
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(request).toHaveBeenCalledWith(
    "publishing-plans.update",
    expect.objectContaining({ id: plan.id, expectedRevision: 1, name: "Unsaved plan" }),
  );
  expect(name.value).toBe("Unsaved plan");
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
  expect(form.textContent).toContain("The order of sent content, the account and the project are kept");
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
