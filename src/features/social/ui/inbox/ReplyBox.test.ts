// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../../tests/browser/support/queryTest";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import type { InboxReplyOptions } from "./inboxTypes";
import { ReplyBox } from "./ReplyBox";

const invalidationFailure = vi.hoisted(() => ({ fail: false }));
vi.mock("./useInboxData", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useInboxData")>();
  return {
    ...actual,
    useInboxInvalidate: (client: SocialClient) => {
      const invalidate = actual.useInboxInvalidate(client);
      return async () => {
        await invalidate();
        if (invalidationFailure.fail) throw new Error("Refresh failed");
      };
    },
  };
});
const confirm = vi.fn(async () => true);
vi.mock("../../../../shared/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm, dialog: null }),
}));

const Component = withQueryClient(ReplyBox);
let element: HTMLDivElement, root: Root;

const WRITE_ACTIONS = ["replies.draft", "drafts.approve", "replies.send", "inbox.setStatus"];

const thread = {
  id: "t1",
  accountId: "a1",
  platformThreadId: "pt1",
  kind: "message",
  projectId: "p1",
  contactId: "c1",
  lastInboundAt: 1,
  events: [],
} as SocialThread;

const fact = (id: string) => ({
  id,
  topic: `Topic ${id}`,
  text: `Text ${id}`,
  source: "https://example.test",
  verifiedAt: 1,
});

type Handler = (input?: Record<string, unknown>) => unknown;

/** Fixture client: answers every Host action from `handlers` and records each call. */
function fakeClient(
  options: {
    replyOptions?: InboxReplyOptions;
    facts?: ReturnType<typeof fact>[];
    handlers?: Record<string, Handler>;
  } = {},
) {
  const draft = { id: "draft-1", threadId: "t1", text: "Hello", factIds: [] };
  const calls: { action: string; input?: Record<string, unknown> }[] = [];
  const handlers: Record<string, Handler> = {
    "inbox.replyOptions": () => options.replyOptions ?? { canReply: true },
    "replies.draft": () => draft,
    "drafts.approve": () => ({}),
    "replies.send": () => ({}),
    "inbox.setStatus": () => ({}),
    "replies.suggest": () => ({ text: "It is free.", factIds: ["f1"] }),
    ...options.handlers,
  };
  const request = vi.fn(async (action: string, input?: Record<string, unknown>) => {
    calls.push({ action, input });
    const handler = handlers[action];
    if (!handler) throw new Error(`Unexpected ${action}`);
    return handler(input);
  });
  const snapshot = vi.fn(async () => ({
    accounts: [],
    pollingEnabled: false,
    profiles: [
      {
        projectId: "p1",
        productName: "Demo",
        brandVoice: "Plain",
        facts: options.facts ?? [fact("f1"), fact("f2")],
      },
    ],
  }));
  const client = { request, snapshot } as unknown as SocialClient;
  const writes = () => calls.filter((call) => WRITE_ACTIONS.includes(call.action));
  return { client, calls, request, writes, draft };
}

beforeEach(() => {
  invalidationFailure.fail = false;
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

async function mount(client: SocialClient, override: Partial<SocialThread> = {}) {
  await act(async () =>
    root.render(createElement(Component, { client, thread: { ...thread, ...override } })),
  );
  await flush();
}

const button = (label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label,
  )!;

/** Buttons that explain why they are off stay focusable, so "off" is aria-disabled. */
const off = (target: HTMLButtonElement) => target.getAttribute("aria-disabled") === "true";

const editor = () => element.querySelector("textarea") as HTMLTextAreaElement;

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(editor(), value);
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: HTMLButtonElement) {
  await act(async () => target.click());
  await flush();
}

it("does not draft, approve or send anything just by opening a conversation", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  expect(fake.calls.map((call) => call.action)).toContain("inbox.replyOptions");
  expect(fake.writes()).toEqual([]);
  expect(fake.calls.some((call) => call.action === "replies.suggest")).toBe(false);
  expect(editor().value).toBe("");
});

it("keeps Send disabled with its reason until the owner writes a reply", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  expect(off(button("Send"))).toBe(true);
  expect(button("Send").getAttribute("aria-description")).toBe("Write a reply first.");
  expect(element.querySelector(".inbox-note")?.textContent).toContain("Write a reply first.");
  await type("   ");
  expect(off(button("Send"))).toBe(true);
  await type("Thanks, see you soon.");
  expect(off(button("Send"))).toBe(false);
  expect(fake.writes()).toEqual([]);
});

it("sends only after the owner presses Send: draft, approval of that exact draft, then queue", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await type("  Thanks, see you soon.  ");
  expect(fake.writes()).toEqual([]);
  await click(button("Send"));

  expect(fake.writes().map((call) => call.action)).toEqual([
    "replies.draft",
    "drafts.approve",
    "replies.send",
    "inbox.setStatus",
  ]);
  expect(fake.writes()[0].input).toEqual({
    threadId: "t1",
    text: "Thanks, see you soon.",
    factIds: [],
  });
  expect(fake.writes()[1].input).toEqual({ id: "draft-1", reviewedDraft: fake.draft });
  expect(fake.writes()[2].input).toEqual({ id: "draft-1" });
  expect(element.textContent).toContain("Reply queued.");
  expect(editor().value).toBe("");
});

it("blocks the reply box with the Host reason and never sends while a reply is not allowed", async () => {
  const fake = fakeClient({
    replyOptions: { canReply: false, templatesOnly: true, reasonCode: "window.expired" },
  });
  await mount(fake.client);
  expect(editor().disabled).toBe(true);
  expect(off(button("Send"))).toBe(true);
  expect(element.textContent).toContain(
    "This conversation requires a template. Template replies are unavailable here.",
  );
  await click(button("Send"));
  expect(fake.writes()).toEqual([]);
});

it("does not report success and keeps the text when the draft cannot be created", async () => {
  const fake = fakeClient({
    handlers: {
      "replies.draft": () => {
        throw new Error("The account changed.");
      },
    },
  });
  await mount(fake.client);
  await type("Hello there");
  await click(button("Send"));

  expect(fake.writes().map((call) => call.action)).toEqual(["replies.draft"]);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "The reply was not sent. Check the conversation and try again.",
  );
  expect(element.textContent).not.toContain("Reply queued.");
  expect(editor().value).toBe("Hello there");
});

it("never queues a reply whose draft was rejected as stale at approval", async () => {
  const fake = fakeClient({
    handlers: {
      "drafts.approve": () => {
        throw new Error("Draft preview changed.");
      },
    },
  });
  await mount(fake.client);
  await type("Hello there");
  await click(button("Send"));

  expect(fake.writes().map((call) => call.action)).toEqual(["replies.draft", "drafts.approve"]);
  expect(element.textContent).not.toContain("Reply queued.");
  expect(editor().value).toBe("Hello there");
});

it("ignores a second press while a send is in flight", async () => {
  let release: (value: unknown) => void = () => undefined;
  const fake = fakeClient({
    handlers: { "replies.draft": () => new Promise((resolve) => (release = resolve)) },
  });
  await mount(fake.client);
  await type("Hello there");
  await act(async () => button("Send").click());
  expect(off(button("Send"))).toBe(true);
  expect(button("Send").getAttribute("aria-description")).toBe("Sending…");
  await act(async () => button("Send").click());
  expect(fake.writes().filter((call) => call.action === "replies.draft")).toHaveLength(1);
  release(fake.draft);
  await flush();
  expect(fake.writes().filter((call) => call.action === "replies.draft")).toHaveLength(1);
});

it("puts an AI suggestion in the editor without sending it, then sends its fact ids on Send", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await click(button("Fill with AI"));

  expect(fake.calls.find((call) => call.action === "replies.suggest")?.input).toEqual({
    threadId: "t1",
    factIds: ["f1", "f2"],
  });
  expect(editor().value).toBe("It is free.");
  expect(fake.writes()).toEqual([]);

  await click(button("Send"));
  expect(fake.writes()[0]).toEqual({
    action: "replies.draft",
    input: { threadId: "t1", text: "It is free.", factIds: ["f1"] },
  });
});

it("drops the verified fact ids once the owner edits the AI text", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await click(button("Fill with AI"));
  await type("It is free. Really.");
  await click(button("Send"));
  expect(fake.writes()[0].input).toEqual({
    threadId: "t1",
    text: "It is free. Really.",
    factIds: [],
  });
});

it("offers at most 20 verified facts to one AI reply", async () => {
  const many = Array.from({ length: 25 }, (_, index) => fact(`f${index + 1}`));
  const fake = fakeClient({ facts: many });
  await mount(fake.client);
  await click(button("Fill with AI"));
  const input = fake.calls.find((call) => call.action === "replies.suggest")?.input;
  expect(input?.factIds).toEqual(many.slice(0, 20).map((item) => item.id));
});

it("keeps the unfinished text and shows an error when the suggestion fails", async () => {
  const fake = fakeClient({
    handlers: {
      "replies.suggest": () => {
        throw new Error("AI could not answer from the selected verified facts.");
      },
    },
  });
  await mount(fake.client);
  await type("My own words");
  await click(button("Fill with AI"));
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not prepare a suggestion. Try again.",
  );
  expect(editor().value).toBe("My own words");
  expect(fake.writes()).toEqual([]);
});

it("explains in place why AI is unavailable without a project or without verified facts", async () => {
  const noProject = fakeClient();
  await mount(noProject.client, { projectId: undefined });
  expect(off(button("Fill with AI"))).toBe(true);
  expect(element.textContent).toContain("Choose the conversation's project first.");

  const noFacts = fakeClient({ facts: [] });
  await mount(noFacts.client);
  expect(off(button("Fill with AI"))).toBe(true);
  expect(element.textContent).toContain("Add verified facts for this project first.");
  expect(noFacts.calls.some((call) => call.action === "replies.suggest")).toBe(false);
});

it("says why Send is off while the reply options are unknown or cannot be read", async () => {
  const pending = fakeClient({
    handlers: { "inbox.replyOptions": () => new Promise(() => undefined) },
  });
  await mount(pending.client);
  await type("Thanks");
  expect(off(button("Send"))).toBe(true);
  expect(element.textContent).toContain("Checking whether this conversation can take a reply.");

  const failing = fakeClient({
    handlers: {
      "inbox.replyOptions": () => {
        throw new Error("offline");
      },
    },
  });
  await mount(failing.client);
  await type("Thanks");
  expect(off(button("Send"))).toBe(true);
  expect(element.textContent).toContain(
    "The reply options could not be loaded. Reload the conversation.",
  );
  expect(failing.writes()).toEqual([]);
});

it("asks before an AI suggestion replaces the owner's draft, and keeps the draft when refused", async () => {
  confirm.mockResolvedValueOnce(false);
  const fake = fakeClient();
  await mount(fake.client);
  await type("My own words");
  await click(button("Fill with AI"));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(fake.calls.some((call) => call.action === "replies.suggest")).toBe(false);
  expect(editor().value).toBe("My own words");
});

it("replaces the draft with the AI suggestion once the owner agrees", async () => {
  confirm.mockResolvedValueOnce(true);
  const fake = fakeClient();
  await mount(fake.client);
  await type("My own words");
  await click(button("Fill with AI"));
  expect(fake.calls.some((call) => call.action === "replies.suggest")).toBe(true);
  expect(editor().value).toBe("It is free.");
});

it("restores the exact reply draft after leaving and reopening the conversation", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await type("Unsent owner draft");
  await act(async () => root.render(null));
  await mount(fake.client);
  expect(editor().value).toBe("Unsent owner draft");
  expect(fake.writes()).toEqual([]);
});

it("does not carry a reply draft to another Host client with the same thread id", async () => {
  const first = fakeClient();
  await mount(first.client);
  await type("Private draft on first Host");
  const second = fakeClient();
  await mount(second.client);
  expect(editor().value).toBe("");
  expect(second.writes()).toEqual([]);
});

it("keeps confirmed queue success distinct from a later refresh failure", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await type("Ready to queue");
  invalidationFailure.fail = true;
  await click(button("Send"));
  expect(element.textContent).toContain("Reply queued.");
  expect(element.textContent).toContain("Reply queued, but the conversation could not refresh.");
  expect(element.textContent).not.toContain("The reply was not sent.");
  expect(editor().value).toBe("");
  expect(fake.writes().filter((call) => call.action === "replies.send")).toHaveLength(1);
});

it("shows suggestion progress and protects the editor while AI text is pending", async () => {
  let finish!: (value: { text: string; factIds: string[] }) => void;
  const fake = fakeClient({
    handlers: {
      "replies.suggest": () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  await mount(fake.client);
  await act(async () => button("Fill with AI").click());
  expect(button("Fill with AI").getAttribute("aria-busy")).toBe("true");
  expect(editor().disabled).toBe(true);
  expect(element.querySelector(".inbox-note")?.textContent).not.toContain("Sending");
  await act(async () => finish({ text: "Prepared reply", factIds: ["f1"] }));
  await flush();
  expect(editor().disabled).toBe(false);
  expect(editor().value).toBe("Prepared reply");
  expect(fake.writes()).toEqual([]);
});
