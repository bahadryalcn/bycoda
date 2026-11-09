import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { SocialJob } from "../../src/features/social/model/social";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { UnexpectedScreen } from "./browser-layers/types";
import { telegramBrowserRecipe } from "./social-browser-telegram";
import { TELEGRAM_WEB, readCursor, writeCursor } from "./social-browser-telegram-poll";

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const readFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/telegram/${name}`, import.meta.url), "utf8");
const APP = readFixture("web-k-app.html");
const CHAT = readFixture("web-k-chat.html");
const UNKNOWN = readFixture("web-k-unknown.html");

type Bubble = { mid: number; text: string; outgoing?: boolean; at?: number };
type Thread = Bubble[] | "unknown";
type World = {
  chats: { peer: string; name: string }[];
  threads: Record<string, Thread>;
  chatListUnknown?: boolean;
  noComposer?: boolean;
};

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function bubbleHtml(peer: string, bubble: Bubble): string {
  const classes = bubble.outgoing ? "bubble is-out is-sent" : "bubble";
  const timestamp = bubble.at === undefined ? "" : ` data-timestamp="${bubble.at / 1000}"`;
  return `<div class="${classes}" data-mid="${bubble.mid}" data-peer-id="${peer}"${timestamp}><div class="message">${escape(bubble.text)}</div></div>`;
}

function renderPage(world: World, peer: string): string {
  const chats = world.chatListUnknown
    ? "<main>Unlock messages</main>"
    : world.chats
        .map(
          (chat) =>
            `<div class="chatlist-chat" data-peer-id="${chat.peer}">${escape(chat.name)}</div>`,
        )
        .join("");
  const thread = world.threads[peer];
  const center =
    thread === undefined || thread === "unknown"
      ? UNKNOWN
      : CHAT.replaceAll("{{peer}}", peer)
          .replaceAll(
            "{{name}}",
            escape(world.chats.find((chat) => chat.peer === peer)?.name ?? peer),
          )
          .replaceAll("{{bubbles}}", thread.map((bubble) => bubbleHtml(peer, bubble)).join(""))
          .replaceAll(
            "{{composer}}",
            world.noComposer
              ? ""
              : '<div class="input-message-input" contenteditable="true" role="textbox"></div>',
          );
  return APP.replaceAll("{{chats}}", chats).replaceAll("{{center}}", center);
}

function session(world: World) {
  const window = new Window({ url: TELEGRAM_WEB });
  const document = window.document;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: function () {
      return [{ width: 100, height: 30 }];
    },
  });
  document.documentElement.lang = "en";
  let current = world.chats[0]?.peer ?? "";
  const render = () => {
    document.body.innerHTML = renderPage(world, current);
  };
  render();
  const page = {
    goto: vi.fn(async (url: string) => {
      const hash = new URL(url).hash.slice(1);
      current = decodeURIComponent(hash) || current;
      window.location.href = url;
      render();
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression) as T),
    click: vi.fn(async () => {
      throw new Error("not used by poll");
    }),
    insertText: vi.fn(),
    fill: vi.fn(),
    setFiles: vi.fn(),
    watchResponse: vi.fn(),
    cookies: vi.fn(),
  } as unknown as BrowserPage & { goto: ReturnType<typeof vi.fn> };
  const verifyIdentity = vi.fn(async () => undefined);
  const context: BrowserRecipeContext = {
    page,
    account: {
      id: "synthetic",
      platform: "telegram",
      platformId: "web:telegram:+905550000000",
      name: "Synthetic",
      accountType: "member",
      connected: true,
      paused: false,
      connection: "browser",
      accessApproved: true,
      scopes: [],
      executorId: "host",
      grants: {},
      createdAt: 1,
    } as BrowserRecipeContext["account"],
    files: [],
    now: () => NOW,
    verifyIdentity,
    waitFor: async <T>(expression: string) => await page.evaluate<T>(expression),
  };
  const visited = () =>
    page.goto.mock.calls
      .map(([url]) => decodeURIComponent(new URL(url as string).hash.slice(1)))
      .filter((peer) => peer !== "");
  return { context, page, verifyIdentity, visited, document };
}

const incoming = (mid: number, text: string, at = NOW - 60_000): Bubble => ({ mid, text, at });
const userChats = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    peer: String(1001 + index),
    name: `Contact ${index + 1}`,
  }));

describe("Telegram Web personal inbox", () => {
  it("reads direct chats and never opens groups or channels", async () => {
    const world: World = {
      chats: [
        { peer: "1001", name: "Ana" },
        { peer: "-1001234567890", name: "News" },
        { peer: "-55", name: "Team" },
        { peer: "1002", name: "Bo" },
      ],
      threads: {
        "1001": [incoming(101, "Hello")],
        "1002": [incoming(201, "Hi there")],
      },
    };
    const f = session(world);
    const result = await telegramBrowserRecipe.poll(f.context, []);
    expect(f.visited()).toEqual(["1001", "1002"]);
    expect(result.events.map((event) => [event.threadId, event.text])).toEqual([
      ["1001", "Hello"],
      ["1002", "Hi there"],
    ]);
    expect(result.events[0]).toMatchObject({ eventId: "telegram:1001:101", kind: "message" });
  });

  it("returns only messages newer than the saved per-chat high-water mark", async () => {
    const world: World = {
      chats: [{ peer: "1001", name: "Ana" }],
      threads: { "1001": [incoming(101, "First")] },
    };
    const first = session(world);
    const one = await telegramBrowserRecipe.poll(first.context, []);
    expect(one.events).toHaveLength(1);

    world.threads["1001"] = [incoming(101, "First"), incoming(102, "Second")];
    const second = session(world);
    const two = await telegramBrowserRecipe.poll(second.context, [], one.cursor);
    expect(two.events.map((event) => event.text)).toEqual(["Second"]);

    const third = session(world);
    const none = await telegramBrowserRecipe.poll(third.context, [], two.cursor);
    expect(none.events).toEqual([]);
  });

  it("rotates from the last chat visited by identity, so a reordered list is not skipped or repeated", async () => {
    const chats = userChats(7);
    const threads = Object.fromEntries(chats.map((chat) => [chat.peer, [] as Bubble[]]));
    const first = session({ chats, threads });
    const one = await telegramBrowserRecipe.poll(first.context, []);
    expect(first.visited()).toEqual(["1001", "1002", "1003", "1004", "1005"]);

    const reordered = [...chats].reverse();
    const second = session({ chats: reordered, threads });
    await telegramBrowserRecipe.poll(second.context, [], one.cursor);
    expect(second.visited()).toEqual(["1004", "1003", "1002", "1001", "1007"]);
  });

  it("skips a chat that does not render as expected and keeps reading the others", async () => {
    const world: World = {
      chats: [
        { peer: "1001", name: "Ana" },
        { peer: "1002", name: "Bo" },
      ],
      threads: { "1001": "unknown", "1002": [incoming(301, "Still here")] },
    };
    const f = session(world);
    const result = await telegramBrowserRecipe.poll(f.context, []);
    expect(result.events.map((event) => [event.threadId, event.text])).toEqual([
      ["1002", "Still here"],
    ]);
  });

  it("skips one message without a timestamp instead of failing the whole poll", async () => {
    const world: World = {
      chats: [{ peer: "1001", name: "Ana" }],
      threads: {
        "1001": [{ mid: 401, text: "No time" }, incoming(402, "Timed")],
      },
    };
    const f = session(world);
    const result = await telegramBrowserRecipe.poll(f.context, []);
    expect(result.events.map((event) => event.text)).toEqual(["Timed"]);
  });

  it("raises UnexpectedScreen with a text-only summary when the chat list is not recognized", async () => {
    const f = session({ chats: [], threads: {}, chatListUnknown: true });
    const error = await telegramBrowserRecipe
      .poll(f.context, [])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnexpectedScreen);
    const summary = (error as UnexpectedScreen).snapshot;
    expect(summary.url).toBe("https://web.telegram.org/k/");
    expect(JSON.stringify(summary)).not.toContain("#");
  });

  it("refuses malformed cursors and accepts only the legacy positional shape as a restart", () => {
    expect(() => readCursor('{"v":2,"last":{"abc":1}}')).toThrow();
    expect(() => readCursor('{"v":2,"last":{"1001":-1}}')).toThrow();
    expect(() => readCursor('{"v":2,"after":"-55","last":{}}')).toThrow();
    expect(() => readCursor('{"v":1,"next":-1}')).toThrow();
    expect(() => readCursor("not json")).toThrow();
    expect(readCursor('{"v":1,"next":3}')).toEqual({ last: {} });
    expect(readCursor(undefined)).toEqual({ last: {} });
    const round = readCursor(writeCursor({ after: "1001", last: { "1001": 12 } }));
    expect(round).toEqual({ after: "1001", last: { "1001": 12 } });
  });

  it("does not compose a send for an absent composer and reports the screen to the decision layer", async () => {
    const world: World = {
      chats: [{ peer: "1001", name: "Ana" }],
      threads: { "1001": [incoming(501, "Hello")] },
      noComposer: true,
    };
    const f = session(world);
    const job = {
      id: "job",
      operationId: "op",
      dedupeKey: "key",
      accountId: "synthetic",
      projectIds: ["project"],
      provider: "owner",
      kind: "message",
      payload: { text: "Reply", media: [], recipientId: "1001" },
      status: "running",
      scheduledAt: NOW,
      attempts: 1,
    } as SocialJob;
    await expect(telegramBrowserRecipe.send(f.context, job)).rejects.toBeInstanceOf(
      UnexpectedScreen,
    );
    expect(f.page.evaluate).toHaveBeenCalled();
  });
});
