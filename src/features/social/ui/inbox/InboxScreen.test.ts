// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../../tests/browser/support/queryTest";
import type { SocialClient } from "../../model/socialClient";
import type { SocialScreenProps } from "../shell/screens";
import { InboxScreen } from "./InboxScreen";
import type { InboxItem, InboxUnifiedResult } from "./inboxTypes";

const Component = withQueryClient(InboxScreen);
let element: HTMLDivElement, root: Root;

const REPLY_WRITES = ["replies.draft", "drafts.approve", "replies.send"];

const item = (threadId: string, title: string, overrides: Partial<InboxItem> = {}): InboxItem => ({
  threadId,
  accountId: "a1",
  platform: "x",
  kind: "message",
  title,
  preview: `${title} preview`,
  at: 1,
  status: "unread",
  tags: [],
  ...overrides,
});

const account = (id: string, name: string, connected = true) => ({ id, name, connected });

type Handler = (input?: Record<string, unknown>) => unknown;

function fakeClient(
  options: {
    handlers?: Record<string, Handler>;
    pollingEnabled?: boolean;
    accounts?: ReturnType<typeof account>[];
  } = {},
) {
  const calls: { action: string; input?: Record<string, unknown> }[] = [];
  const handlers: Record<string, Handler> = {
    "inbox.unified": (): InboxUnifiedResult => ({
      items: [item("t1", "Ana"), item("t2", "Bo")],
      unreadable: [],
    }),
    "thread.read": (input) => ({
      id: input?.id,
      accountId: "a1",
      platformThreadId: `platform-${String(input?.id)}`,
      kind: "message",
      contactId: "c1",
      lastInboundAt: 1,
      events: [],
    }),
    "inbox.timeline": () => ({ personId: "pe1", events: [], truncated: false }),
    "inbox.replyOptions": () => ({ canReply: true }),
    "inbox.settings": (input) => ({ autoRefresh: input?.autoRefresh, intervals: {} }),
    "inbox.sync": () => ({}),
    "inbox.setStatus": () => ({}),
    ...options.handlers,
  };
  const request = vi.fn(async (action: string, input?: Record<string, unknown>) => {
    calls.push({ action, input });
    const handler = handlers[action];
    if (!handler) throw new Error(`Unexpected ${action}`);
    return handler(input);
  });
  // `snapshot` stays a failing stub: the Inbox must read the accounts section, never the full workspace.
  const snapshot = vi.fn(async () => {
    throw new Error("The Inbox must not read the full workspace snapshot.");
  });
  const sectionSnapshot = vi.fn(async (_input: Record<string, unknown>) => ({
    cursor: "c",
    unchanged: false,
    snapshot: {
      accounts: options.accounts ?? [account("a1", "Main X")],
      pollingEnabled: options.pollingEnabled ?? true,
      profiles: [],
    },
  }));
  const client = { request, snapshot, sectionSnapshot } as unknown as SocialClient;
  const of = (action: string) => calls.filter((call) => call.action === action);
  return { client, calls, of };
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
  for (let round = 0; round < 3; round += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function props(
  client: SocialClient,
  overrides: Partial<SocialScreenProps> = {},
): SocialScreenProps {
  return {
    client,
    machineId: "m1",
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate: vi.fn(),
    ...overrides,
  };
}

async function mount(client: SocialClient, overrides: Partial<SocialScreenProps> = {}) {
  await act(async () => root.render(createElement(Component, props(client, overrides))));
  await flush();
}

// #670 renders virtual rows with a separate tag overflow action.
const rows = () => Array.from(element.querySelectorAll<HTMLButtonElement>("button.inbox-row"));
const button = (label: string) =>
  Array.from(element.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
const toggle = () => element.querySelector<HTMLButtonElement>('[role="switch"]')!;

it("lists conversations from every account and opens the first one without sending anything", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  expect(rows().map((row) => row.textContent)).toEqual([
    expect.stringContaining("Ana"),
    expect.stringContaining("Bo"),
  ]);
  expect(rows()[0].getAttribute("aria-current")).toBe("true");
  expect(fake.of("inbox.unified")[0].input).toEqual({ filter: {}, limit: 50 });
  expect(fake.of("thread.read").map((call) => call.input)).toEqual([{ id: "t1" }]);
  expect(element.querySelector(".inbox-reply textarea")).not.toBeNull();
  expect(fake.calls.filter((call) => REPLY_WRITES.includes(call.action))).toEqual([]);
});

it("opens the conversation named by the navigation target", async () => {
  const fake = fakeClient();
  await mount(fake.client, { target: { threadId: "t2" } });
  expect(rows()[1].getAttribute("aria-current")).toBe("true");
  expect(fake.of("thread.read").map((call) => call.input)).toEqual([{ id: "t2" }]);
});

it("ignores a navigation target without a thread id", async () => {
  const fake = fakeClient();
  await mount(fake.client, { target: { personId: "pe1" } });
  expect(rows()[0].getAttribute("aria-current")).toBe("true");
});

it("opens another conversation on click and still sends nothing", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await act(async () => rows()[1].click());
  await flush();
  expect(rows()[1].getAttribute("aria-current")).toBe("true");
  expect(fake.of("thread.read").map((call) => call.input)).toEqual([{ id: "t1" }, { id: "t2" }]);
  expect(fake.calls.filter((call) => REPLY_WRITES.includes(call.action))).toEqual([]);
});

it("reads the accounts section once, never the full workspace, while conversations open", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await act(async () => rows()[1].click());
  await flush();
  expect(fake.client.snapshot).not.toHaveBeenCalled();
  expect(vi.mocked(fake.client.sectionSnapshot).mock.calls.map((call) => call[0])).toEqual([
    { section: "accounts", limit: 1 },
  ]);
});

it("applies the Host's saved tags without refetching the list, conversation or accounts", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.setStatus": () => ({
        threadId: "t1",
        status: "unread",
        tags: ["other-window", "lead"],
      }),
    },
  });
  await mount(fake.client);
  const sectionReads = () => vi.mocked(fake.client.sectionSnapshot).mock.calls.length;
  const listReads = fake.of("inbox.unified").length;
  const tagInput = element.querySelector<HTMLInputElement>('input[placeholder="Add tag"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      tagInput,
      "lead",
    );
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await flush();
  expect(fake.of("inbox.setStatus")).toHaveLength(1);
  expect(fake.of("inbox.unified")).toHaveLength(listReads);
  expect(fake.of("thread.read")).toHaveLength(1);
  expect(fake.of("inbox.replyOptions")).toHaveLength(1);
  expect(element.querySelector('[aria-label="Remove other-window"]')).not.toBeNull();
  expect(sectionReads()).toBe(1);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await flush();
  expect(sectionReads()).toBe(1);
});

it("reloads the accounts read after Check now because connection state can change", async () => {
  const fake = fakeClient();
  await mount(fake.client);
  await act(async () => button("Check now")!.click());
  await flush();
  expect(vi.mocked(fake.client.sectionSnapshot)).toHaveBeenCalledTimes(2);
});

it("rechecks a tag search when a saved change removes its last matching conversation", async () => {
  let tags = ["vip"];
  const fake = fakeClient({
    handlers: {
      "inbox.unified": (input) => ({
        items:
          (input?.filter as { query?: string } | undefined)?.query && !tags.length
            ? []
            : [item("t1", "Ana", { tags })],
        unreadable: [],
      }),
      "inbox.setStatus": () => {
        tags = [];
        return { threadId: "t1", status: "unread", tags };
      },
    },
  });
  await mount(fake.client);
  const search = element.querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "vip");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(fake.of("inbox.unified")).toHaveLength(2));
  await flush();
  await act(async () =>
    element.querySelector<HTMLButtonElement>('[aria-label="Remove vip"]')!.click(),
  );
  await flush();
  expect(fake.of("inbox.unified")).toHaveLength(3);
  expect(rows()).toHaveLength(0);
  expect(element.textContent).toContain("No conversations match these filters.");
  expect(element.querySelector(".inbox-detail")?.textContent).toContain("Ana");
  expect(element.querySelector(".inbox-detail textarea")).not.toBeNull();
});

it("reconciles a tag save with a pending list refresh without replaying the old response", async () => {
  const initial = item("t1", "Ana");
  const saved = { ...initial, tags: ["vip"] };
  let reads = 0;
  let finishOldRead!: (result: InboxUnifiedResult) => void;
  const fake = fakeClient({
    handlers: {
      "inbox.unified": () => {
        reads++;
        if (reads === 2)
          return new Promise((resolve) => {
            finishOldRead = resolve;
          });
        return { items: [reads === 1 ? initial : saved], unreadable: [] };
      },
      "inbox.setStatus": () => saved,
    },
  });
  await mount(fake.client);
  await act(async () => button("Check now")!.click());
  await vi.waitFor(() => expect(finishOldRead).toBeDefined());
  const input = element.querySelector<HTMLInputElement>('input[placeholder="Add tag"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "vip");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await flush();
  expect(reads).toBe(3);
  await act(async () => finishOldRead({ items: [initial], unreadable: [] }));
  await flush();
  expect(element.querySelector('[aria-label="Remove vip"]')).not.toBeNull();
});

it("does not load the list while the screen is retained but hidden", async () => {
  const fake = fakeClient();
  await mount(fake.client, { active: false });
  expect(fake.of("inbox.unified")).toEqual([]);
  await mount(fake.client, { active: true });
  expect(fake.of("inbox.unified")).toHaveLength(1);
  expect(rows()).toHaveLength(2);
});

it("shows the auto-refresh state and saves a change through the Host", async () => {
  const fake = fakeClient({ pollingEnabled: true });
  await mount(fake.client);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle().click());
  await flush();
  expect(fake.of("inbox.settings").map((call) => call.input)).toEqual([{ autoRefresh: false }]);
});

it("shows auto-refresh as off without a subtitle sentence", async () => {
  const fake = fakeClient({ pollingEnabled: false });
  await mount(fake.client);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(element.textContent).not.toContain("checked automatically");
});

it("reports a failed auto-refresh change instead of pretending it was saved", async () => {
  const fake = fakeClient({
    pollingEnabled: true,
    handlers: {
      "inbox.settings": () => {
        throw new Error("Host unavailable");
      },
    },
  });
  await mount(fake.client);
  await act(async () => toggle().click());
  await flush();
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not change auto-refresh. Try again.",
  );
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

it("asks only connected accounts for new activity when the owner presses Check now", async () => {
  const fake = fakeClient({
    accounts: [account("a1", "Main X"), account("a2", "Old page", false)],
    handlers: { "inbox.unified": () => ({ items: [], unreadable: [] }) },
  });
  await mount(fake.client);
  expect(element.textContent).toContain("No conversations yet");
  await act(async () => button("Check now")!.click());
  await flush();
  expect(fake.of("inbox.sync").map((call) => call.input)).toEqual([{ accountId: "a1" }]);
  expect(element.textContent).not.toContain("Some accounts could not be checked.");
});

it("counts failed account checks instead of hiding them", async () => {
  const fake = fakeClient({
    accounts: [account("a1", "Main X"), account("a2", "Second X")],
    handlers: {
      "inbox.unified": () => ({ items: [], unreadable: [] }),
      "inbox.sync": (input) => {
        if (input?.accountId === "a1") throw new Error("Rate limited");
        return {};
      },
    },
  });
  await mount(fake.client);
  await act(async () => button("Check now")!.click());
  await flush();
  expect(fake.of("inbox.sync")).toHaveLength(2);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Some accounts could not be checked. Open an account to see why.",
  );
});

it("sends the search text to the Host and explains an empty filtered result with reset and toolbar refresh", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.unified": (input) => {
        const filter = input?.filter as { query?: string } | undefined;
        return filter?.query
          ? { items: [], unreadable: [] }
          : { items: [item("t1", "Ana")], unreadable: [] };
      },
    },
  });
  await mount(fake.client);
  const search = element.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(search, " zzz ");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() =>
    expect(fake.of("inbox.unified").at(-1)?.input).toMatchObject({ filter: { query: "zzz" } }),
  );
  await flush();
  const last = fake.of("inbox.unified").at(-1)!;
  expect(last.input).toMatchObject({ filter: { query: "zzz" } });
  expect(element.textContent).toContain("No conversations match these filters.");
  expect(button("Clear filters")).toBeDefined();
  expect(button("Check now")!.closest(".inbox-toolbar")).not.toBeNull();
});

it("retains matching rows and the selected person's timeline while the latest query settles", async () => {
  const ana = item("t1", "Planning", { person: { id: "pe1", name: "Ana" } });
  let settle!: (result: InboxUnifiedResult) => void;
  const fake = fakeClient({
    handlers: {
      "inbox.unified": (input) =>
        (input?.filter as { query?: string } | undefined)?.query
          ? new Promise<InboxUnifiedResult>((resolve) => {
              settle = resolve;
            })
          : { items: [ana, item("t2", "News", { preview: "Daily news" })], unreadable: [] },
    },
  });
  await mount(fake.client);
  const original = rows()[0];
  const search = element.querySelector<HTMLInputElement>("input[type=search]")!;
  for (const text of ["p", "pl", "plan"]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, text);
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toBe(original);
    expect(element.querySelector(".inbox-conversation-title")?.textContent).toBe("Ana");
  }
  await vi.waitFor(() => expect(settle).toBeDefined());
  expect(fake.of("inbox.unified")).toHaveLength(2);
  expect(fake.of("inbox.unified").at(-1)?.input).toMatchObject({ filter: { query: "plan" } });
  await act(async () => settle({ items: [ana], unreadable: [] }));
  await flush();
  expect(fake.of("inbox.timeline")).toHaveLength(1);
});

it("names every account the Host cannot read while still listing the rest", async () => {
  const fake = fakeClient({
    accounts: [account("a1", "Main X"), account("a2", "Company page")],
    handlers: {
      "inbox.unified": () => ({
        items: [item("t1", "Ana")],
        unreadable: [
          {
            accountId: "a2",
            platform: "linkedin",
            reasonCode: "browser.no_recipe",
            reason: "No recipe",
          },
        ],
      }),
    },
  });
  await mount(fake.client);
  expect(element.textContent).toContain(
    "Can't read messages on Company page: Not available in the browser yet",
  );
  expect(rows()).toHaveLength(1);
});

it("shows an error when the inbox cannot be loaded", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.unified": () => {
        throw new Error("Host unavailable");
      },
    },
  });
  await mount(fake.client);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load the inbox. Try again.",
  );
});

it("loads the next page with the Host cursor and appends it", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.unified": (input) =>
        input?.cursor === "cursor-1"
          ? { items: [item("t3", "Cy")], unreadable: [] }
          : { items: [item("t1", "Ana")], unreadable: [], next: "cursor-1" },
    },
  });
  await mount(fake.client);
  expect(rows()).toHaveLength(1);
  await act(async () => button("Load more")!.click());
  await flush();
  expect(fake.of("inbox.unified").at(-1)!.input).toMatchObject({ cursor: "cursor-1" });
  expect(rows().map((row) => row.textContent)).toEqual([
    expect.stringContaining("Ana"),
    expect.stringContaining("Cy"),
  ]);
  expect(button("Load more")).toBeUndefined();
});

it("does not show an empty inbox when its list failed and offers retry", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.unified": () => {
        throw new Error("offline");
      },
    },
  });
  await mount(fake.client);
  expect(element.textContent).toContain("Could not load the inbox. Try again.");
  expect(element.textContent).not.toContain("No conversations yet.");
  expect(button("Try again")).toBeDefined();
});

it("routes an account-free inbox to account setup without syncing", async () => {
  const fake = fakeClient({
    accounts: [],
    handlers: { "inbox.unified": () => ({ items: [], unreadable: [] }) },
  });
  const onNavigate = vi.fn();
  await mount(fake.client, { onNavigate });
  expect(button("Add account")).toBeDefined();
  await act(async () => button("Add account")!.click());
  expect(onNavigate).toHaveBeenCalledWith("accounts");
  expect(fake.of("inbox.sync")).toEqual([]);
});

it("reloads Host auto-refresh settings after returning from account settings", async () => {
  const fake = fakeClient({ pollingEnabled: true });
  await mount(fake.client);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
  await mount(fake.client, { active: false });
  vi.mocked(fake.client.sectionSnapshot).mockResolvedValue({
    cursor: "c2",
    unchanged: false,
    snapshot: {
      accounts: [account("a1", "Main X")],
      profiles: [],
      pollingEnabled: false,
    },
  } as never);
  await mount(fake.client, { active: true });
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});

it("handles later navigation occurrences on a retained screen and preserves each reply draft", async () => {
  const fake = fakeClient();
  const firstTarget = { threadId: "t1" };
  await mount(fake.client, { target: firstTarget });
  const editor = () => element.querySelector<HTMLTextAreaElement>(".inbox-reply textarea")!;
  const type = async (text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        editor(),
        text,
      );
      editor().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await type("Draft for Ana");
  await mount(fake.client, { target: { threadId: "t2" } });
  expect(rows()[1].getAttribute("aria-current")).toBe("true");
  await type("Draft for Bo");
  await act(async () => rows()[0].click());
  await flush();
  expect(editor().value).toBe("Draft for Ana");
  await mount(fake.client, { target: { threadId: "t2" } });
  expect(rows()[1].getAttribute("aria-current")).toBe("true");
  expect(editor().value).toBe("Draft for Bo");
  expect(fake.calls.filter((call) => REPLY_WRITES.includes(call.action))).toEqual([]);
});

/** Serves a different list per round so a refresh can reorder, add or drop conversations. */
function listRounds(...rounds: InboxItem[][]) {
  let round = 0;
  return {
    next: () => {
      round += 1;
    },
    handler: (): InboxUnifiedResult => ({
      items: rounds[Math.min(round, rounds.length - 1)],
      unreadable: [],
    }),
  };
}

const refresh = async () => {
  await act(async () => button("Check now")!.click());
  await flush();
};
const current = () => rows().findIndex((row) => row.getAttribute("aria-current") === "true");
const readIds = (fake: ReturnType<typeof fakeClient>) =>
  new Set(fake.of("thread.read").map((call) => call.input?.id));

it("keeps the auto-opened conversation open when a refresh puts a new row first", async () => {
  const list = listRounds(
    [item("t1", "Ana"), item("t2", "Bo")],
    [item("t3", "Cy"), item("t1", "Ana"), item("t2", "Bo")],
  );
  const fake = fakeClient({ handlers: { "inbox.unified": list.handler } });
  await mount(fake.client);
  list.next();
  await refresh();
  expect(rows().map((row) => row.textContent)).toEqual([
    expect.stringContaining("Cy"),
    expect.stringContaining("Ana"),
    expect.stringContaining("Bo"),
  ]);
  expect(current()).toBe(1);
  expect(readIds(fake)).toEqual(new Set(["t1"]));
});

it("keeps an explicitly chosen conversation open across a reorder", async () => {
  const list = listRounds(
    [item("t1", "Ana"), item("t2", "Bo")],
    [item("t3", "Cy"), item("t1", "Ana"), item("t2", "Bo")],
  );
  const fake = fakeClient({ handlers: { "inbox.unified": list.handler } });
  await mount(fake.client);
  await act(async () => rows()[1].click());
  await flush();
  list.next();
  await refresh();
  expect(current()).toBe(2);
  expect(readIds(fake)).toEqual(new Set(["t1", "t2"]));
  expect(fake.of("thread.read").at(-1)!.input).toEqual({ id: "t2" });
});

it("moves to the first remaining row when the open conversation leaves the list", async () => {
  const list = listRounds([item("t1", "Ana"), item("t2", "Bo")], [item("t2", "Bo")]);
  const fake = fakeClient({ handlers: { "inbox.unified": list.handler } });
  await mount(fake.client);
  list.next();
  await refresh();
  expect(rows()).toHaveLength(1);
  expect(current()).toBe(0);
  expect(fake.of("thread.read").at(-1)!.input).toEqual({ id: "t2" });
});

it("shows the empty prompt instead of a stale conversation when the list empties", async () => {
  const list = listRounds([item("t1", "Ana")], []);
  const fake = fakeClient({ handlers: { "inbox.unified": list.handler } });
  await mount(fake.client);
  list.next();
  await refresh();
  expect(rows()).toHaveLength(0);
  expect(element.querySelector(".inbox-reply textarea")).toBeNull();
  expect(element.textContent).toContain("Choose a conversation to read and reply.");
});

it("keeps a navigation target the first page has not listed yet", async () => {
  const fake = fakeClient({
    handlers: {
      "inbox.unified": () => ({ items: [item("t1", "Ana")], unreadable: [], next: "cursor-1" }),
    },
  });
  await mount(fake.client, { target: { threadId: "t9" } });
  expect(current()).toBe(-1);
  expect(readIds(fake)).toEqual(new Set(["t9"]));
});
