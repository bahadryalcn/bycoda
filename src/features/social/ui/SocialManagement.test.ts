import { chooseSocialValue } from "./socialTestControls";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Audience, Rules } from "./SocialManagement";
import { SocialBulkComposer } from "./SocialBulkComposer";
import { Campaigns as QueryCampaigns } from "./SocialCampaigns";
import { closeComposer } from "./socialShared";
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
    (item) => item.querySelector("h3")?.textContent === title,
  )!;
}
function outreach(): HTMLElement {
  return container.querySelector<HTMLElement>(".social-detail-header [data-social-composer]")!;
}
function control(
  label: string,
  scope: ParentNode = container,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement {
  const owner = Array.from(scope.querySelectorAll("label")).find((item) =>
    item.textContent?.trim().startsWith(label),
  );
  const element = owner?.htmlFor
    ? document.getElementById(owner.htmlFor)
    : owner?.querySelector('input,select,textarea,button[aria-haspopup="dialog"]');
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
      container.querySelector<HTMLButtonElement>('button[aria-label^="Project:"]')!,
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
    const create = form("New contact");
    const account = create.querySelector<HTMLSelectElement>('select[name="account"]')!;
    expect(account.required).toBe(true);
    expect(account.value).toBe("account");
    await chooseSocialValue(
      create.querySelector<HTMLButtonElement>('button[aria-label^="Account:"]')!,
      "second",
    );
    expect(new FormData(create).get("account")).toBe("second");
    await act(async () => create.reset());
    expect(account.value).toBe("account");
    expect(create.querySelector('button[aria-label^="Account:"]')?.textContent).toContain(
      "Test account",
    );
    await click("Test contact");
    const edit = form("Update contact");
    expect(edit.querySelector<HTMLSelectElement>('select[name="account"]')?.disabled).toBe(true);
    expect(edit.querySelector<HTMLButtonElement>('button[aria-label^="Account:"]')?.disabled).toBe(
      true,
    );
    expect(edit.querySelectorAll('input[type="hidden"][name="account"]')).toHaveLength(1);
    expect(new FormData(edit).get("account")).toBe("account");
  });
  it("keeps unsaved profile fields separate for each project and preserves failed fact edits", async () => {
    await render(Campaigns, snapshot());
    const profileDetails = Array.from(container.querySelectorAll("details")).find(
      (item) =>
        item.querySelector("summary")?.textContent ===
        "Product information and verified announcements",
    )!;
    await change(control("Product name", profileDetails), "Unsaved Alpha");
    await change(control("Project", profileDetails), "b");
    expect(control("Product name", profileDetails).value).toBe("Beta project");
    await change(control("Project", profileDetails), "a");
    expect(control("Product name", profileDetails).value).toBe("Unsaved Alpha");
    const factForm = form("Add verified fact");
    await change(control("Fact topic", factForm), "Saved topic");
    await change(control("Verified, announceable fact", factForm), "Saved text");
    await change(control("Verification source", factForm), "Saved source");
    request.mockRejectedValueOnce(new Error("Offline"));
    await submit(factForm);
    expect(control("Fact topic", factForm).value).toBe("Saved topic");
    expect(control("Verified, announceable fact", factForm).value).toBe("Saved text");
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
    await click("Filters");
    await change(control("Segment", document), "vip");
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
    expect(container.textContent).toContain("Contact with this person is stopped");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Save draft",
      )?.disabled,
    ).toBe(true);
  });
  it("checks the current account policy before drafting and keeps rejected content", async () => {
    await render(Audience, snapshot());
    await click("Test contact");
    const editor = outreach();
    expect(control("Project", editor).textContent).toContain("Alpha project");
    await change(control("Content", editor), "abc");
    request.mockResolvedValueOnce({ effective: { maxMessageCharacters: 2 } });
    await submit(editor.querySelector("form")!);
    expect(request).toHaveBeenCalledWith("policy.get", {
      accountId: "account",
    });
    expect(request.mock.calls.some((call) => call[0] === "messages.draft")).toBe(false);
    expect(editor.textContent).toContain("The text exceeds the 2 character limit");
    expect(editor.textContent).toContain("abc");
    await click("Edit content");
    expect(control("Content", editor).value).toBe("abc");
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
    expect(editor.textContent).toContain("Draft ready");
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
        (item) => item.textContent === "Schedule posts",
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
    await click("Check account and content");
    expect(schedule().disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Give publishing approval",
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
    await click("Give publishing approval");
    expect(request).toHaveBeenCalledWith("campaigns.approveReviewed", {
      id: campaign.id,
      expectedRevision: campaign.revision,
    });
    expect(request).not.toHaveBeenCalledWith("campaigns.approve", expect.anything());
    expect(request).not.toHaveBeenCalledWith("campaigns.schedule", expect.anything());
    expect(schedule().disabled).toBe(false);
    await click("Schedule posts");
    expect(request).toHaveBeenCalledWith("campaigns.schedule", { id: campaign.id });
    await render(Campaigns, {
      ...value,
      campaigns: [{ ...campaign, revision: 2 }],
    });
    expect(schedule().disabled).toBe(true);
  });
  it("submits the campaign revision opened for editing after a newer workspace snapshot arrives", async () => {
    const value = snapshot();
    const campaign = {
      id: "campaign",
      name: "Saved campaign",
      projectIds: ["a"],
      variants: [
        { accountId: "account", text: "hello", media: [], factIds: [], scheduledAt: Date.now() },
      ],
      revision: 1,
      paused: false,
      createdAt: 1,
    };
    value.campaigns = [campaign];
    await render(Campaigns, value);
    await click("Saved campaign");
    await click("Edit draft");
    await change(control("Campaign name", document.body), "Unsaved owner edit");
    await render(Campaigns, {
      ...value,
      campaigns: [{ ...campaign, name: "Newer owner edit", revision: 2 }],
    });
    request.mockImplementation(async (action: string) => {
      if (action === "policy.get") return { effective: { maxContentCharacters: 100 } };
      if (action === "campaigns.create") throw new Error("Campaign changed in another client");
      return {};
    });
    const editForm = document.body.querySelector<HTMLFormElement>("[data-social-composer] form")!;
    await act(async () =>
      editForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(request).toHaveBeenCalledWith(
      "campaigns.create",
      expect.objectContaining({ id: campaign.id, expectedRevision: 1, name: "Unsaved owner edit" }),
    );
    expect(control("Campaign name", document.body).value).toBe("Unsaved owner edit");
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
    await click("Edit draft");
    const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog()).toBeTruthy();
    expect(dialog()!.textContent).toContain("Edit campaign draft");
    await act(async () => closeComposer(control("Campaign name", document.body).closest("form")!));
    expect(dialog()).toBeNull();
    await click("Edit draft");
    expect(dialog()).toBeTruthy();
    expect(control("Campaign name", document.body).value).toBe("Saved campaign");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not crash when a campaign date is cleared and counts links against the content policy", async () => {
    await render(Campaigns, snapshot());
    await click("Social accounts");
    const account = document.body.querySelector<HTMLButtonElement>('[role="option"]')!;
    await act(async () => account.click());
    const done = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Done",
    )!;
    await act(async () => done.click());
    await change(control("Content for this account"), "abc");
    await change(control("Link"), "https://example.test");
    expect(container.textContent).toContain("The content exceeds the limit");
    await change(control("One-time schedule time"), "");
    expect(control("One-time schedule time").value).toBe("");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Save campaign draft",
      )?.disabled,
    ).toBe(true);
  });
  it("cannot save an automation with a fact removed from its project", async () => {
    const value = snapshot();
    await render(Rules, value);
    const factLabel = Array.from(container.querySelectorAll("label")).find((item) =>
      item.textContent?.trim().startsWith("Allowed reply fact"),
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
        (item) => item.textContent === "Save paused rule",
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
