// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../../tests/browser/queryTest";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { ConversationView } from "./ConversationView";
import type { InboxItem, PersonTimeline } from "./inboxTypes";

const Component = withQueryClient(ConversationView);
let element: HTMLDivElement, root: Root;

const WRITE_ACTIONS = ["replies.draft", "drafts.approve", "replies.send", "inbox.setStatus"];

const thread = (events: SocialThread["events"]): SocialThread => ({
  id: "t1",
  accountId: "a1",
  platformThreadId: "platform-thread-1",
  kind: "message",
  projectId: "p1",
  contactId: "c1",
  lastInboundAt: 1,
  events,
});

const event = (
  id: string,
  at: number,
  text: string,
  direction: "inbound" | "outbound" = "inbound",
) => ({
  id,
  at,
  text,
  direction,
  platformId: id,
});

const item = (overrides: Partial<InboxItem> = {}): InboxItem => ({
  threadId: "t1",
  accountId: "a1",
  platform: "x",
  kind: "message",
  title: "Ana's question",
  preview: "Hi",
  at: 1,
  status: "unread",
  tags: ["vip"],
  ...overrides,
});

type Handler = (input?: Record<string, unknown>) => unknown;

function fakeClient(handlers: Record<string, Handler> = {}) {
  const calls: { action: string; input?: Record<string, unknown> }[] = [];
  const all: Record<string, Handler> = {
    "thread.read": () => thread([]),
    "inbox.timeline": () => ({ personId: "pe1", events: [], truncated: false }),
    "inbox.replyOptions": () => ({ canReply: true }),
    "inbox.setStatus": () => ({}),
    ...handlers,
  };
  const request = vi.fn(async (action: string, input?: Record<string, unknown>) => {
    calls.push({ action, input });
    const handler = all[action];
    if (!handler) throw new Error(`Unexpected ${action}`);
    return handler(input);
  });
  const snapshot = vi.fn(async () => ({ accounts: [], pollingEnabled: false, profiles: [] }));
  const client = { request, snapshot } as unknown as SocialClient;
  return {
    client,
    calls,
    writes: () => calls.filter((call) => WRITE_ACTIONS.includes(call.action)),
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});

afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(
  client: SocialClient,
  props: { threadId?: string; item?: InboxItem } = { threadId: "t1", item: item() },
) {
  await act(async () => root.render(createElement(Component, { client, ...props })));
  await flush();
}

const button = (label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

const lineTexts = () =>
  Array.from(element.querySelectorAll(".inbox-line-text")).map((node) => node.textContent);

const tagInput = () => element.querySelector<HTMLInputElement>('input[placeholder="Add tag"]')!;

async function typeTag(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(tagInput(), value);
    tagInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter() {
  await act(async () => {
    tagInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await flush();
}

it("asks the owner to choose a conversation and reads nothing before one is chosen", async () => {
  const fake = fakeClient();
  await mount(fake.client, {});
  expect(element.textContent).toContain("Choose a conversation to read and reply.");
  expect(fake.calls.filter((call) => call.action === "thread.read")).toEqual([]);
});

it("shows the conversation oldest first as plain text and sends nothing on open", async () => {
  const fake = fakeClient({
    "thread.read": () =>
      thread([
        event("e2", 2000, "Second <b>bold</b> message", "outbound"),
        event("e1", 1000, "First message"),
      ]),
  });
  await mount(fake.client, { threadId: "t1", item: item({ person: undefined }) });
  expect(lineTexts()).toEqual(["First message", "Second <b>bold</b> message"]);
  expect(element.querySelector(".inbox-line-text b")).toBeNull();
  expect(element.querySelector('[data-direction="outbound"]')?.textContent).toContain("Second");
  expect(fake.writes()).toEqual([]);
  expect(fake.calls.some((call) => call.action === "inbox.timeline")).toBe(false);
});

it("shows the person's cross-channel timeline when the conversation belongs to a known person", async () => {
  const timeline: PersonTimeline = {
    personId: "pe1",
    truncated: true,
    events: [
      {
        id: "x1",
        at: 1000,
        direction: "inbound",
        platform: "email",
        accountId: "mail",
        kind: "message",
        text: "Email hello",
      },
      {
        id: "x2",
        at: 2000,
        direction: "outbound",
        platform: "x",
        accountId: "a1",
        threadId: "t1",
        kind: "message",
        text: "Reply on X",
      },
    ],
  };
  const fake = fakeClient({
    "thread.read": () => thread([event("e1", 1, "Only in thread")]),
    "inbox.timeline": () => timeline,
  });
  await mount(fake.client, {
    threadId: "t1",
    item: item({ person: { id: "pe1", name: "Ana" } }),
  });
  expect(lineTexts()).toEqual(["Email hello", "Reply on X"]);
  expect(fake.calls.find((call) => call.action === "inbox.timeline")?.input).toEqual({
    personId: "pe1",
  });
  expect(element.textContent).toContain("Ana");
  expect(element.textContent).toContain("Older messages are not shown.");
});

it("says so when the timeline cannot be loaded", async () => {
  const fake = fakeClient({
    "inbox.timeline": () => {
      throw new Error("Host unavailable");
    },
  });
  await mount(fake.client, {
    threadId: "t1",
    item: item({ person: { id: "pe1", name: "Ana" } }),
  });
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load the timeline.",
  );
});

it("explains an empty conversation instead of rendering a blank area", async () => {
  const fake = fakeClient();
  await mount(fake.client, { threadId: "t1", item: item() });
  expect(element.textContent).toContain("No messages in this conversation yet.");
});

it("shows an error when the conversation cannot be opened", async () => {
  const fake = fakeClient({
    "thread.read": () => {
      throw new Error("Not found");
    },
  });
  await mount(fake.client);
  expect(element.textContent).toContain("This conversation could not be opened.");
  expect(element.querySelector(".inbox-reply")).toBeNull();
});

const statusTrigger = () => button("Change status")!;

const statusItem = (label: string) =>
  document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${label}"]`);

async function openStatusMenu() {
  await act(async () => statusTrigger().click());
  await flush();
}

it("keeps status changes in one menu that offers every status except the current one", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  expect(button("Mark as Replied")).toBeUndefined();
  expect(statusTrigger().getAttribute("aria-haspopup")).toBe("menu");
  await openStatusMenu();
  expect(statusItem("Mark as Unread")).toBeNull();
  expect(statusItem("Mark as Replied")).not.toBeNull();
  expect(statusItem("Mark as Assigned")).not.toBeNull();
  await act(async () => statusItem("Mark as Done")!.click());
  await flush();
  expect(fake.writes()).toEqual([
    { action: "inbox.setStatus", input: { threadId: "t1", status: "done", tags: ["vip"] } },
  ]);
});

it("keeps the conversation and shows an error when a status change fails", async () => {
  const fake = fakeClient({
    "inbox.setStatus": () => {
      throw new Error("Conversation not found.");
    },
  });
  await mount(fake.client, { threadId: "t1", item: item({ person: undefined }) });
  await openStatusMenu();
  await act(async () => statusItem("Mark as Done")!.click());
  await flush();
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save this change. Try again.",
  );
  expect(statusTrigger().disabled).toBe(false);
});

it("adds a tag on Enter, keeping the current status and the existing tags", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await typeTag("  lead ");
  await pressEnter();
  expect(fake.writes()).toEqual([
    {
      action: "inbox.setStatus",
      input: { threadId: "t1", status: "unread", tags: ["vip", "lead"] },
    },
  ]);
  expect(tagInput().value).toBe("");
});

it("does not save a duplicate or blank tag", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await typeTag("vip");
  await pressEnter();
  expect(tagInput().value).toBe("");
  await typeTag("   ");
  await pressEnter();
  expect(fake.writes()).toEqual([]);
});

it("keeps the typed tag when saving it fails", async () => {
  const fake = fakeClient({
    "inbox.setStatus": () => {
      throw new Error("offline");
    },
  });
  await mount(fake.client);
  await typeTag("lead");
  await pressEnter();
  expect(tagInput().value).toBe("lead");
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not save this change. Try again.",
  );
});

it("renders the reply box but sends no reply action until the owner acts", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  expect(element.querySelector(".inbox-reply textarea")).not.toBeNull();
  expect(
    fake.calls.some((call) =>
      ["replies.draft", "drafts.approve", "replies.send"].includes(call.action),
    ),
  ).toBe(false);
});

it("starts an empty reply draft when the owner opens another conversation", async () => {
  const { client } = fakeClient({
    "thread.read": (input) => ({ ...thread([]), id: String(input?.id) }),
  });
  await mount(client, { threadId: "t1", item: item({ threadId: "t1" }) });
  const editor = element.querySelector<HTMLTextAreaElement>(".inbox-reply textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(editor, "Half written for Ana");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await mount(client, { threadId: "t2", item: item({ threadId: "t2" }) });
  expect(element.querySelector<HTMLTextAreaElement>(".inbox-reply textarea")?.value).toBe("");
});
