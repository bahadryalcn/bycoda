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
  component: typeof Audience | typeof Campaigns | typeof QueryRules,
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
    // Product knowledge is managed in its own dialog; its drafts survive closing it.
    await click("Manage");
    const dialog = document.body;
    const profileForm = Array.from(dialog.querySelectorAll("form")).find(
      (item) => item.querySelector("h3")?.textContent === "Product profile",
    )!;
    await change(control("Product name", profileForm), "Unsaved Alpha");
    await change(control("Project", dialog), "b");
    expect(control("Product name", dialog).value).toBe("Beta project");
    await change(control("Project", dialog), "a");
    expect(control("Product name", dialog).value).toBe("Unsaved Alpha");
    await act(async () =>
      Array.from(dialog.querySelectorAll("button"))
        .find((item) => item.textContent === "Add verified fact")!
        .click(),
    );
    const factForm = Array.from(dialog.querySelectorAll("form")).find(
      (item) => item.querySelector("h3")?.textContent === "Add verified fact",
    )!;
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
  it("previews a contact file, skips invalid rows and imports only the valid mapped fields", async () => {
    await render(Audience, snapshot());
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(
      [
        JSON.stringify([
          { accountId: "account", platformId: "u1", name: "Ada", projectIds: ["a"], consent: { allowed: true } },
          { accountId: "nobody", platformId: "u2", name: "Bob", projectIds: ["a"] },
        ]),
      ],
      "contacts.json",
      { type: "application/json" },
    );
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => undefined);
    expect(request.mock.calls.some((call) => call[0] === "contacts.import")).toBe(false);
    expect(container.textContent).toContain("1 contacts ready");
    expect(container.textContent).toContain("Unknown account on this computer.");
    expect(container.textContent).toContain("Consent and eligibility are never taken from a file.");
    await click("Import 1 valid contacts");
    const call = request.mock.calls.find((item) => item[0] === "contacts.import")!;
    expect(call[1]).toEqual({
      contacts: [{ accountId: "account", platformId: "u1", name: "Ada", projectIds: ["a"] }],
    });
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
    // The content list's options popover is also a dialog; the composer is the modal.
    const dialog = () =>
      document.body.querySelector<HTMLElement>(
        '[role="dialog"]:not([aria-label="Loaded content options"])',
      );
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
    await act(async () => control("One-time schedule time").click());
    await act(async () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "Clear")!
        .click(),
    );
    expect(control("One-time schedule time").getAttribute("aria-label")).toContain(
      "Choose date and time",
    );
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Save campaign draft",
      )?.disabled,
    ).toBe(true);
  });
  it("cannot save an automation with a fact removed from its project", async () => {
    const value = snapshot();
    await render(QueryRules, value);
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
    await change(control("Name"), "Rule");
    await change(control("Incoming phrase"), "price");
    await click("Next");
    await click("Next");
    const save = () =>
      Array.from(container.querySelectorAll("button")).find(
        (item) => item.textContent === "Save paused rule",
      )!;
    expect(save().disabled).toBe(false);
    await render(QueryRules, {
      ...value,
      profiles: value.profiles.map((profile) => ({ ...profile, facts: [] })),
    });
    expect(save().disabled).toBe(true);
    expect(container.textContent).toContain("Add a verified fact for this project.");
  });
});

/** Reply-rule dialog (VIS-007.3): one state owner, three steps, same payload as the old single form. */
describe("Reply rule steps", () => {
  const onOpenContent = vi.fn();
  const stepButton = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const next = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (item) => item.textContent === "Next",
    )!;
  const reason = () =>
    container.querySelector(".social-rule-nav .social-rule-reason")?.textContent ?? "";
  async function renderRules(value: SocialSnapshot) {
    await act(async () =>
      root.render(createElement(QueryRules, { ...props(value), onOpenContent })),
    );
  }
  async function fillContent(name = "Rule A", phrase = "price?", scope: ParentNode = container) {
    await change(control("Name", scope), name);
    await change(control("Incoming phrase", scope), phrase);
    const label = Array.from(scope.querySelectorAll("label")).find((item) =>
      item.textContent?.trim().startsWith("Allowed reply fact"),
    )!;
    await chooseSocialValue(
      label.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!,
      "fact-a",
    );
  }
  beforeEach(() => onOpenContent.mockReset());

  it("keeps every value while moving back and forth and summarises it before saving", async () => {
    await renderRules(snapshot());
    await fillContent();
    await click("Next");
    expect(stepButton("2 Behaviour").closest("li")?.getAttribute("aria-current")).toBe("step");
    await change(control("Mode"), "approval");
    await change(control("Daily limit"), "7");
    await change(control("Stop phrases"), "a, b ,");
    await click("Back");
    expect(control("Name").value).toBe("Rule A");
    expect(control("Incoming phrase").value).toBe("price?");
    expect(container.querySelector<HTMLSelectElement>("select[required]")?.value).toBe("fact-a");
    await click("Next");
    expect(control("Mode").value).toBe("approval");
    expect(control("Daily limit").value).toBe("7");
    expect(control("Stop phrases").value).toBe("a, b ,");
    await click("Next");
    const summary = container.querySelector('dl[aria-label="Rule summary"]')!.textContent!;
    for (const part of [
      "Rule A",
      "Test account",
      "Alpha project",
      "Incoming comment",
      "Send with user approval",
      "Topic",
      "1 answer",
      "price?",
      "up to 7 a day",
      "a, b",
    ])
      expect(summary).toContain(part);
    expect(request.mock.calls.some((call) => call[0] === "automations.create")).toBe(false);
    // The step indicator returns to earlier steps without losing anything.
    await act(async () => stepButton("1 Account and content").click());
    expect(control("Name").value).toBe("Rule A");
  });

  it("shows blockers in their own step and disables Next with the reason", async () => {
    await renderRules(snapshot());
    expect(next().disabled).toBe(true);
    expect(reason()).toContain("Enter a rule name.");
    expect(reason()).toContain("Select the verified fact");
    expect(stepButton("2 Behaviour").getAttribute("aria-disabled")).toBe("true");
    await fillContent();
    expect(next().disabled).toBe(false);
    expect(reason()).toBe("");
    await click("Next");
    await change(control("Daily limit"), "0");
    expect(next().disabled).toBe(true);
    expect(reason()).toContain("whole daily limit from 1 to 100");
    expect(container.textContent).toContain("Enter a whole number from 1 to 100.");
    expect(stepButton("3 Review").getAttribute("aria-disabled")).toBe("true");
    await change(control("Daily limit"), "2.5");
    expect(next().disabled).toBe(true);
    await change(control("Daily limit"), "100");
    expect(next().disabled).toBe(false);
    // Automatic mode without a reply grant is a Behaviour blocker.
    await change(control("Mode"), "automatic");
    expect(next().disabled).toBe(false);
    const value = snapshot();
    value.accounts[0].grants.a = ["read", "draft"];
    await renderRules(value);
    expect(container.textContent).toContain(
      "Automatic sending needs a supported account and reply permission for this project.",
    );
    expect(next().disabled).toBe(true);
    expect(reason()).toContain("Automatic sending needs");
    // An account without draft access is a first-step blocker.
    const noDraft = snapshot();
    noDraft.accounts[0].grants.a = ["read"];
    await click("Back");
    await renderRules(noDraft);
    expect(reason()).toContain("No account with draft access for the selected project.");
    expect(next().disabled).toBe(true);
  });

  it("resolves a missing verified fact in the first step and keeps the draft through the detour", async () => {
    const empty = snapshot();
    empty.profiles = empty.profiles.map((profile) => ({ ...profile, facts: [] }));
    await renderRules(empty);
    await change(control("Name"), "Unfinished");
    await change(control("Incoming phrase"), "price?");
    expect(container.textContent).toContain("Add a verified fact before creating a rule");
    expect(reason()).toContain("Add a verified fact for this project.");
    expect(next().disabled).toBe(true);
    await click("Manage verified facts");
    expect(onOpenContent).toHaveBeenCalledWith("a");
    // The owner added a fact elsewhere; the parked draft is still here and complete.
    await renderRules(snapshot());
    expect(control("Name").value).toBe("Unfinished");
    expect(control("Incoming phrase").value).toBe("price?");
    expect(container.textContent).not.toContain("Add a verified fact before creating a rule");
    expect(request.mock.calls.some((call) => call[0] === "automations.create")).toBe(false);
  });

  it("keeps the draft and the current step when the dialog is closed and reopened", async () => {
    await renderRules(snapshot());
    await click("Create automation rule");
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    const press = async (text: string) =>
      act(async () =>
        Array.from(document.body.querySelectorAll("button"))
          .find((item) => item.textContent === text)!
          .click(),
      );
    await fillContent("Kept", "keep?", dialog);
    await press("Next");
    await change(control("Daily limit", dialog), "9");
    await act(async () => closeComposer(dialog.querySelector("form")!));
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy();
    await click("Create automation rule");
    const reopened = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(control("Daily limit", reopened).value).toBe("9");
    await press("Back");
    expect(control("Name", reopened).value).toBe("Kept");
    expect(control("Incoming phrase", reopened).value).toBe("keep?");
  });

  it("saves paused with exactly the payload of the former single form and then starts a clean draft", async () => {
    await renderRules(snapshot());
    await fillContent("Support rule", "price?");
    await change(control("Trigger"), "message");
    await click("Next");
    await change(control("Mode"), "approval");
    await change(control("Daily limit"), "7");
    await change(control("Stop phrases"), "refund, lawsuit ,, ");
    await click("Next");
    await click("Save paused rule");
    const calls = request.mock.calls.filter((call) => call[0] === "automations.create");
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0][1])).toBe(
      JSON.stringify({
        name: "Support rule",
        accountId: "account",
        projectId: "a",
        mode: "approval",
        trigger: "message",
        topics: ["Topic"],
        dailyLimit: 7,
        stopWords: ["refund", "lawsuit"],
        answers: [{ keyword: "price?", factId: "fact-a" }],
      }),
    );
    expect(request.mock.calls.some((call) => call[0] === "automations.activate")).toBe(false);
    expect(control("Name").value).toBe("");
  });

  it("keeps the draft when saving fails and advances with Enter without saving", async () => {
    await renderRules(snapshot());
    await fillContent();
    await submit(container.querySelector("form")!);
    expect(control("Daily limit").value).toBe("10");
    expect(request.mock.calls.some((call) => call[0] === "automations.create")).toBe(false);
    await submit(container.querySelector("form")!);
    request.mockImplementation(async (action: string) => {
      if (action === "automations.create") throw new Error("Offline");
      return action === "policy.get" ? { effective: {} } : {};
    });
    await click("Save paused rule");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (item) => item.textContent === "Save paused rule",
      ),
    ).toBe(true);
    await click("Back");
    await click("Back");
    expect(control("Name").value).toBe("Rule A");
  });

  it("keeps pausing existing rules available whatever the dialog step", async () => {
    const value = snapshot();
    value.rules = [
      {
        id: "r1",
        name: "Live rule",
        accountId: "account",
        projectId: "a",
        mode: "draft",
        trigger: "comment",
        topics: ["Topic"],
        dailyLimit: 5,
        enabled: true,
        stopWords: [],
        answers: [{ keyword: "x", factId: "fact-a" }],
      },
    ];
    await renderRules(value);
    await fillContent();
    await click("Next");
    const pause = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === "Pause rule",
    )!;
    expect(pause.disabled).toBe(false);
    await act(async () => pause.click());
    expect(request).toHaveBeenCalledWith("automations.pause", { id: "r1" });
  });

  it("states why the AI simplify entry is unavailable", async () => {
    const simplify = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (item) => item.textContent === "Simplify with AI",
      )!;
    const rule = {
      id: "r1",
      name: "Live rule",
      accountId: "account",
      projectId: "a",
      mode: "draft" as const,
      trigger: "comment" as const,
      topics: ["Topic"],
      dailyLimit: 5,
      enabled: false,
      stopWords: [],
      answers: [{ keyword: "x", factId: "fact-a" }],
    };
    await renderRules(snapshot());
    expect(simplify().disabled).toBe(true);
    expect(container.textContent).toContain("Create a reply rule first.");
    const offline = { ...snapshot(), rules: [rule], hostOnline: false };
    await renderRules(offline);
    expect(simplify().disabled).toBe(true);
    expect(container.textContent).toContain("The computer is offline.");
    request.mockImplementation(async (action: string) =>
      action === "policy.get" ? { effective: {} } : {},
    );
    await renderRules({ ...snapshot(), rules: [rule] });
    await act(async () => undefined);
    expect(simplify().disabled).toBe(true);
    expect(container.textContent).toContain("Choose a text agent in Settings first.");
    request.mockImplementation(async (action: string) =>
      action === "policy.get" ? { effective: { agent: { provider: "codex", model: "m" } } } : {},
    );
    await renderRules({ ...snapshot(), rules: [{ ...rule, id: "r2" }] });
    await act(async () => undefined);
    await act(async () => undefined);
    expect(simplify().disabled).toBe(false);
    expect(container.querySelector(".social-rule-list-reason")).toBeFalsy();
  });
});

const QueryRules = withQueryClient(Rules);

const Campaigns = withQueryClient(QueryCampaigns);
