import { chooseSocialValue } from "./socialTestControls";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Audience, Rules } from "./SocialManagement";
import { SocialBulkComposer } from "./SocialBulkComposer";
import { Campaigns as QueryCampaigns } from "./SocialCampaigns";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { SocialClient } from "../model/socialClient";
import type { SocialSnapshot } from "../model/social";
import type { Props } from "./socialShared";

let container: HTMLDivElement;
let root: Root;
const request = vi.fn();
const projects = [
  { id: "a", name: "Alpha project", cwd: "/a" },
  { id: "b", name: "Beta project", cwd: "/b" },
];
function snapshot(): SocialSnapshot {
  return {
    executorId: "host",
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    accounts: [
      {
        id: "account",
        name: "Test account",
        platform: "x",
        platformId: "owner",
        accountType: "member",
        scopes: [],
        accessApproved: true,
        connected: true,
        paused: false,
        executorId: "host",
        grants: {
          a: ["read", "draft", "publish", "reply"],
          b: ["read", "draft"],
        },
        createdAt: 1,
      },
    ],
    campaigns: [],
    jobs: [],
    drafts: [],
    threads: [],
    rules: [],
    profiles: projects.map((project) => ({
      projectId: project.id,
      productName: project.name,
      brandVoice: "Clear",
      facts: [
        {
          id: `fact-${project.id}`,
          topic: "Topic",
          text: "Verified fact",
          source: "Owner",
          verifiedAt: 1,
        },
      ],
    })),
    contacts: [
      {
        id: "contact",
        accountId: "account",
        platformId: "recipient-1",
        name: "Test contact",
        source: "manual",
        tags: ["vip"],
        projectIds: ["a"],
        replyEligible: true,
        commentEligible: true,
        optedOut: false,
        consent: { allowed: true, source: "Owner consent", at: 1 },
        history: [],
      },
    ],
    segments: [{ id: "vip", name: "VIP", projectIds: ["a"], tags: ["vip"] }],
    capabilities: {
      account: ["publish", "poll", "reply", "message.start", "comment"].map((operation) => ({
        operation: operation as "publish",
        status: "available",
        reason: "Available",
        scopes: [],
        source: "api",
      })),
    },
    policies: {
      global: { maxContentCharacters: 10, maxMessageCharacters: 5 },
      platforms: {},
    },
  };
}
function props(value: SocialSnapshot): Props {
  return {
    snapshot: value,
    projects,
    initialProject: "a",
    client: { request } as unknown as SocialClient,
    run: async (work) => {
      try {
        await work();
        return true;
      } catch {
        return false;
      }
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  request
    .mockReset()
    .mockImplementation(async (action: string) =>
      action === "policy.get"
        ? { effective: { maxContentCharacters: 10, maxMessageCharacters: 5 } }
        : {},
    );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  component: typeof Audience | typeof Campaigns | typeof Rules,
  value: SocialSnapshot,
) {
  await act(async () => root.render(createElement(component, props(value))));
}
function form(title: string): HTMLFormElement {
  return Array.from(container.querySelectorAll("form")).find(
    (item) =>
      item.querySelector("h3")?.textContent === title ||
      item.closest(".social-editor")?.getAttribute("aria-label") === title,
  )!;
}
function outreach(): HTMLElement {
  return container.querySelector<HTMLElement>(
    '.social-editor[aria-label="Mesaj veya yorum hazırla"]',
  )!;
}
function control(
  label: string,
  scope: ParentNode = container,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement {
  const element = Array.from(scope.querySelectorAll("label"))
    .find((item) => item.textContent?.trim().startsWith(label))
    ?.querySelector('input,select,textarea,button[aria-haspopup="dialog"]');
  expect(element, `Missing control: ${label}`).toBeTruthy();
  return element as HTMLInputElement;
}
async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement,
  value: string,
) {
  if (element instanceof HTMLButtonElement) return chooseSocialValue(element, value);
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) =>
      item.textContent === text ||
      item.getAttribute("aria-label") === text ||
      item.querySelector("strong")?.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function submit(element: HTMLFormElement) {
  await act(async () => {
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("Social management workflows", () => {
  it("uses the searchable required bulk project while retaining the empty-target preparation gate", async () => {
    const value = snapshot();
    await act(async () =>
      root.render(createElement(SocialBulkComposer, { ...props(value), targets: [] })),
    );
    const project = container.querySelector<HTMLSelectElement>("select[required]")!;
    expect(project.value).toBe("a");
    await chooseSocialValue(
      container.querySelector<HTMLButtonElement>('button[aria-label^="Proje:"]')!,
      "b",
    );
    expect(project.value).toBe("b");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    expect(request.mock.calls.some((call) => call[0] !== "policy.get")).toBe(false);
  });
  it("keeps the searchable contact account uncontrolled, named and resettable, including the disabled edit payload", async () => {
    const value = snapshot();
    value.accounts.push({ ...value.accounts[0], id: "second", name: "Second account" });
    await render(Audience, value);
    const create = form("Yeni kişi");
    const account = create.querySelector<HTMLSelectElement>('select[name="account"]')!;
    expect(account.required).toBe(true);
    expect(account.value).toBe("account");
    await chooseSocialValue(
      create.querySelector<HTMLButtonElement>('button[aria-label^="Hesap:"]')!,
      "second",
    );
    expect(new FormData(create).get("account")).toBe("second");
    await act(async () => create.reset());
    expect(account.value).toBe("account");
    expect(create.querySelector('button[aria-label^="Hesap:"]')?.textContent).toContain(
      "Test account",
    );
    await click("Test contact");
    const edit = form("Kişiyi güncelle");
    expect(edit.querySelector<HTMLSelectElement>('select[name="account"]')?.disabled).toBe(true);
    expect(edit.querySelector<HTMLButtonElement>('button[aria-label^="Hesap:"]')?.disabled).toBe(
      true,
    );
    expect(edit.querySelectorAll('input[type="hidden"][name="account"]')).toHaveLength(1);
    expect(new FormData(edit).get("account")).toBe("account");
  });
  it("keeps unsaved profile fields separate for each project and preserves failed fact edits", async () => {
    await render(Campaigns, snapshot());
    const profileDetails = Array.from(container.querySelectorAll("details")).find(
      (item) =>
        item.querySelector("summary")?.textContent === "Ürün bilgisi ve doğrulanmış duyurular",
    )!;
    await change(control("Ürün adı", profileDetails), "Unsaved Alpha");
    await change(control("Proje", profileDetails), "b");
    expect(control("Ürün adı", profileDetails).value).toBe("Beta project");
    await change(control("Proje", profileDetails), "a");
    expect(control("Ürün adı", profileDetails).value).toBe("Unsaved Alpha");
    const factForm = form("Doğrulanmış bilgi ekle");
    await change(control("Bilgi konusu", factForm), "Saved topic");
    await change(control("Doğrulanmış, duyurulabilir bilgi", factForm), "Saved text");
    await change(control("Doğrulama kaynağı", factForm), "Saved source");
    request.mockRejectedValueOnce(new Error("Offline"));
    await submit(factForm);
    expect(control("Bilgi konusu", factForm).value).toBe("Saved topic");
    expect(control("Doğrulanmış, duyurulabilir bilgi", factForm).value).toBe("Saved text");
  });
  it("uses current contact state after opt-out and filters segments without stale async results", async () => {
    const value = snapshot();
    value.contacts.push({
      ...value.contacts[0],
      id: "other",
      name: "Other contact",
      platformId: "recipient-2",
      tags: [],
    });
    await render(Audience, value);
    await change(control("Segment"), "vip");
    expect(container.textContent).not.toContain("Other contact");
    expect(request.mock.calls.some((call) => call[0] !== "policy.get")).toBe(false);
    await click("Test contact");
    const updated = {
      ...value,
      contacts: value.contacts.map((contact) =>
        contact.id === "contact" ? { ...contact, optedOut: true } : contact,
      ),
    };
    await render(Audience, updated);
    expect(container.textContent).toContain("Bu kişiyle iletişim durduruldu");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Taslak kaydet",
      )?.disabled,
    ).toBe(true);
  });
  it("checks the current account policy before drafting and keeps rejected content", async () => {
    await render(Audience, snapshot());
    await click("Test contact");
    const editor = outreach();
    expect(control("Proje", editor).textContent).toContain("Alpha project");
    await change(control("İçerik", editor), "abc");
    request.mockResolvedValueOnce({ effective: { maxMessageCharacters: 2 } });
    await submit(editor.querySelector("form")!);
    expect(request).toHaveBeenCalledWith("policy.get", {
      accountId: "account",
    });
    expect(request.mock.calls.some((call) => call[0] === "messages.draft")).toBe(false);
    expect(editor.textContent).toContain("Metin 2 karakter sınırını aşıyor");
    expect(editor.textContent).toContain("abc");
    await click("İçeriği düzenle");
    expect(control("İçerik", editor).value).toBe("abc");
    request.mockImplementation(async (action, input) =>
      action === "policy.get"
        ? { effective: { maxMessageCharacters: 5 } }
        : {
            id: "draft",
            kind: "message",
            accountId: "account",
            contactId: "contact",
            projectId: "a",
            text: input.text,
            factIds: [],
            createdAt: 1,
          },
    );
    await submit(editor.querySelector("form")!);
    expect(request).toHaveBeenCalledWith(
      "messages.draft",
      expect.objectContaining({
        projectId: "a",
        text: "abc",
        contactId: "contact",
      }),
      expect.any(String),
    );
    expect(editor.textContent).toContain("Taslak hazır");
    expect(
      request.mock.calls.some(
        (call) => call[0] === "messages.send" || call[0] === "drafts.approve",
      ),
    ).toBe(false);
  });
  it("requires exact campaign preview and a separate owner approval before scheduling", async () => {
    const value = snapshot();
    value.sendingEnabled = true;
    const campaign = {
      id: "campaign",
      name: "Test campaign",
      projectIds: ["a"],
      variants: [
        {
          accountId: "account",
          text: "hello",
          media: [],
          factIds: [],
          scheduledAt: Date.now(),
        },
      ],
      revision: 1,
      paused: false,
      createdAt: 1,
    };
    value.campaigns = [campaign];
    await render(Campaigns, value);
    await click("Test campaign");
    const schedule = () =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "3. Tek seferlik yayınları planla",
      )!;
    expect(schedule().disabled).toBe(true);
    request.mockResolvedValueOnce({
      campaign,
      targets: [
        {
          accountId: "account",
          capability: { status: "available", reason: "Available" },
          approved: false,
        },
      ],
    });
    await click("1. Hesap ve içeriği kontrol et");
    expect(schedule().disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "2. İçeriğe yayın onayı ver",
      )?.disabled,
    ).toBe(true);
    await act(async () =>
      container.querySelector<HTMLInputElement>(".social-check input")!.click(),
    );
    request.mockResolvedValueOnce(campaign).mockResolvedValueOnce({
      campaign,
      targets: [
        {
          accountId: "account",
          capability: { status: "available", reason: "Available" },
          approved: true,
        },
      ],
    });
    await click("2. İçeriğe yayın onayı ver");
    expect(request).toHaveBeenCalledWith("campaigns.approve", { id: campaign.id });
    expect(request).not.toHaveBeenCalledWith("campaigns.schedule", expect.anything());
    expect(schedule().disabled).toBe(false);
    await click("3. Tek seferlik yayınları planla");
    expect(request).toHaveBeenCalledWith("campaigns.schedule", { id: campaign.id });
    await render(Campaigns, {
      ...value,
      campaigns: [{ ...campaign, revision: 2 }],
    });
    expect(schedule().disabled).toBe(true);
  });
  it("can reopen editing for the same saved campaign after closing its form", async () => {
    const value = snapshot();
    value.campaigns = [
      {
        id: "campaign",
        name: "Saved campaign",
        projectIds: ["a"],
        variants: [
          { accountId: "account", text: "hello", media: [], factIds: [], scheduledAt: Date.now() },
        ],
        revision: 1,
        paused: false,
        createdAt: 1,
      },
    ];
    await render(Campaigns, value);
    await click("Saved campaign");
    await click("Taslağı düzenle");
    const details = container.querySelector<HTMLDetailsElement>(".social-composer")!;
    expect(details.open).toBe(true);
    expect(details.querySelector("summary")?.textContent).toContain("Kampanya taslağını düzenle");
    await click("Kampanya taslağını düzenle formunu kapat");
    expect(details.open).toBe(false);
    await click("Taslağı düzenle");
    expect(details.open).toBe(true);
    expect(control("Kampanya adı", details).value).toBe("Saved campaign");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not crash when a campaign date is cleared and counts links against the content policy", async () => {
    await render(Campaigns, snapshot());
    await click("Sosyal hesaplar");
    const account = document.body.querySelector<HTMLButtonElement>('[role="option"]')!;
    await act(async () => account.click());
    const done = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Bitti",
    )!;
    await act(async () => done.click());
    await change(control("Bu hesaba özel içerik"), "abc");
    await change(control("Bağlantı"), "https://example.test");
    expect(container.textContent).toContain("İçerik sınırını aşıyor");
    await change(control("Tek seferlik planlama zamanı"), "");
    expect(control("Tek seferlik planlama zamanı").value).toBe("");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Kampanya taslağını kaydet",
      )?.disabled,
    ).toBe(true);
  });
  it("cannot save an automation with a fact removed from its project", async () => {
    const value = snapshot();
    await render(Rules, value);
    const factLabel = Array.from(container.querySelectorAll("label")).find((item) =>
      item.textContent?.trim().startsWith("İzin verilen yanıt bilgisi"),
    )!;
    const factSelect = factLabel.querySelector("select")!;
    expect(factSelect.required).toBe(true);
    expect(factSelect.value).toBe("");
    await chooseSocialValue(
      factLabel.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!,
      "fact-a",
    );
    expect(factSelect.value).toBe("fact-a");
    const save = () =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Durdurulmuş kuralı kaydet",
      )!;
    expect(save().disabled).toBe(false);
    await render(Rules, {
      ...value,
      profiles: value.profiles.map((profile) => ({ ...profile, facts: [] })),
    });
    expect(save().disabled).toBe(true);
  });
});

const Campaigns = withQueryClient(QueryCampaigns);
