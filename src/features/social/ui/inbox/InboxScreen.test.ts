// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../../tests/browser/queryTest";
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
  const snapshot = vi.fn(async () => ({
    accounts: options.accounts ?? [account("a1", "Main X")],
    pollingEnabled: options.pollingEnabled ?? true,
    profiles: [],
  }));
  const client = { request, snapshot } as unknown as SocialClient;
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

const rows = () => Array.from(element.querySelectorAll<HTMLButtonElement>(".inbox-rows li button"));
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
  expect(element.textContent).toContain(
    "No conversations yet. New messages and comments appear here.",
  );
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

it("sends the search text to the Host and explains an empty filtered result without Check now", async () => {
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
  await flush();
  const last = fake.of("inbox.unified").at(-1)!;
  expect(last.input).toMatchObject({ filter: { query: "zzz" } });
  expect(element.textContent).toContain("No conversations match these filters.");
  expect(button("Check now")).toBeUndefined();
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
