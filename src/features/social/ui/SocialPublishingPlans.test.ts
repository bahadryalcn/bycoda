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
          await work();
          return true;
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

it("requires owner review of the exact plan revision before activation", async () => {
  await render(snapshot());
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(true);
  const review = container.querySelector<HTMLInputElement>(".social-check input")!;
  await act(async () => review.click());
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(false);
  await act(async () => button("Otomatik yayını etkinleştir").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.activate", {
    id: "plan",
    revision: 1,
    confirm: "ACTIVATE_PUBLISHING_PLAN",
  });
  await render(snapshot({ publishingPlans: [{ ...plan, revision: 2 }] }));
  expect(container.querySelector<HTMLInputElement>(".social-check input")!.checked).toBe(false);
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(true);
});

it("explains missing campaign approval and preserves global sending restrictions", async () => {
  await render(snapshot({ approvedCampaignIds: [] }));
  await act(async () => container.querySelector<HTMLInputElement>(".social-check input")!.click());
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(true);
  expect(container.textContent).toContain("havuzdaki tüm içeriklere yayın onayı");
  await render(snapshot({ sendingEnabled: false }));
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(true);
  expect(container.textContent).toContain("Gönderim kapalı");
  expect(request).not.toHaveBeenCalled();
});

it("shows finite-pool completion and exposes a direct pause action for live plans", async () => {
  await render(
    snapshot({
      publishingPlans: [{ ...plan, enabled: true, nextRunAt: Date.UTC(2026, 9, 12, 6) }],
    }),
  );
  expect(container.textContent).toContain("09:00");
  await act(async () => button("Planı durdur").click());
  expect(request).toHaveBeenCalledWith("publishing-plans.pause", { id: "plan" });
  await render(snapshot({ publishingPlans: [{ ...plan, nextIndex: 1, completedAt: 2 }] }));
  expect(container.textContent).toContain("İçerik havuzu tamamlandı");
  expect(button("Otomatik yayını etkinleştir").disabled).toBe(true);
});

it("makes unsupported host versions a clear non-actionable state", async () => {
  await render(snapshot({ publishingPlans: undefined }));
  expect(container.textContent).toContain("Host güncellemesi gerekli");
  expect(container.querySelector("form")).toBeNull();
});

it("shows an owner pause as neutral and keeps unknown diagnostics behind an optional detail", async () => {
  await render(snapshot({ publishingPlans: [{ ...plan, pausedReason: "Paused by owner." }] }));
  expect(container.querySelector(".social-row [data-status]")?.getAttribute("data-status")).toBe(
    "paused",
  );
  expect(container.textContent).toContain("Plan sizin tarafınızdan durduruldu");
  expect(container.textContent).not.toContain("Paused by owner.");
  const diagnostic = "Provider returned an unexpected outcome: test-42.";
  await render(snapshot({ publishingPlans: [{ ...plan, pausedReason: diagnostic }] }));
  expect(container.querySelector(".social-row [data-status]")?.getAttribute("data-status")).toBe(
    "review",
  );
  expect(container.textContent).toContain("Hesap bağlantısını, yayın izinlerini");
  const detail = Array.from(container.querySelectorAll("details")).find(
    (item) => item.querySelector("summary")?.textContent === "Teknik ayrıntı",
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
  await act(async () => button("Planı düzenle").click());
  const form = container.querySelector("form")!;
  expect(Array.from(form.querySelectorAll("select")).every((control) => control.disabled)).toBe(
    true,
  );
  expect(
    form.querySelector<HTMLButtonElement>('button[aria-label^="Paylaşım hesabı:"]')?.disabled,
  ).toBe(true);
  expect(form.querySelector<HTMLButtonElement>('button[aria-label^="Proje:"]')?.disabled).toBe(
    true,
  );
  const moves = Array.from(form.querySelectorAll<HTMLButtonElement>(".social-pool-editor button"));
  expect(moves[0].disabled).toBe(true);
  expect(moves[1].disabled).toBe(true);
  expect(moves[2].disabled).toBe(true);
  expect(moves[3].disabled).toBe(false);
  expect(form.textContent).toContain("Gönderilen içeriklerin sırası, hesap ve proje korunur");
});

it("clears the selected campaign pool when its searchable account changes", async () => {
  const value = snapshot();
  value.accounts.push({ ...value.accounts[0], id: "second", name: "Other account" });
  await render(value);
  await act(async () => button("Planı düzenle").click());
  const form = container.querySelector("form")!;
  const account = form.querySelector<HTMLButtonElement>('button[aria-label^="Paylaşım hesabı:"]')!;
  expect(form.querySelectorAll("select[required]")).toHaveLength(2);
  expect(form.textContent).toContain("Yeni özellik");
  await chooseSocialValue(account, "second");
  expect(form.querySelector<HTMLSelectElement>("select")?.value).toBe("second");
  expect(form.querySelector('[aria-label="Seçilen değerler"]')).toBeNull();
  expect(form.textContent).not.toContain("Yeni özellik");
});

it("clears the selected campaign pool when its searchable project changes", async () => {
  await render(snapshot(), true);
  await act(async () => button("Planı düzenle").click());
  const form = container.querySelector("form")!;
  expect(form.textContent).toContain("Yeni özellik");
  await chooseSocialValue(
    form.querySelector<HTMLButtonElement>('button[aria-label^="Proje:"]')!,
    "other",
  );
  expect(Array.from(form.querySelectorAll("select")).at(1)?.value).toBe("other");
  expect(form.textContent).not.toContain("Yeni özellik");
});
