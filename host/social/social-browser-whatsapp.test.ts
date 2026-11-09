import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { UnexpectedScreen } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { isPersonalBulkJob, whatsappBrowserRecipe } from "./social-browser-whatsapp";
import { WHATSAPP_WEB, readCursor, writeCursor } from "./social-browser-whatsapp-poll";

// Fixture times are UTC; the poll clock is 12:00:05 UTC on the same day.
const NOW = Date.UTC(2026, 10, 7, 12, 0, 5);
const readFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/whatsapp/${name}`, import.meta.url), "utf8");
const APP = readFixture("web-app.html");
const LOGIN = readFixture("web-login.html");

const rowsHtml = (kinds: string[]) =>
  kinds.map((kind, index) => `<div role="row" data-chat="${kind}">Row ${index}</div>`).join("");
const appWith = (kinds: string[]) =>
  `<div id="app"><div id="pane-side">${rowsHtml(kinds)}</div><div id="main"></div></div>`;

/** Synthetic browser page: chat list in #pane-side, chat content swapped into #main on click. */
function harness(appHtml = APP) {
  const window = new Window({ url: WHATSAPP_WEB });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ width: 100, height: 30 }],
  });
  window.document.documentElement.lang = "en";
  const setApp = (html: string) => {
    window.location.href = WHATSAPP_WEB;
    window.document.body.innerHTML = html;
  };
  setApp(appHtml);
  const page = {
    goto: vi.fn(async (url: string) => {
      setApp(appHtml);
      window.location.href = url;
    }),
    evaluate: vi.fn(async (expression: string) => window.eval(expression)),
    click: vi.fn(async (selector: string) => {
      const row = window.document.querySelector(selector);
      if (!row) throw new Error("Missing chat row");
      const kind = row.getAttribute("data-chat");
      const name =
        kind === "group"
          ? "web-group.html"
          : kind === "direct"
            ? "web-chat.html"
            : "web-unknown.html";
      window.document.querySelector("#main")!.innerHTML = readFixture(name);
    }),
    fill: vi.fn(),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    watchResponse: vi.fn(),
    cookies: vi.fn(async () => {
      throw new Error("Credential access prohibited");
    }),
  } as unknown as BrowserPage;
  const account = {
    id: "synthetic",
    platform: "whatsapp",
    platformId: "web:whatsapp:+905551234567",
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
  } as SocialAccount;
  const context: BrowserRecipeContext = {
    page,
    account,
    files: [],
    now: () => NOW,
    verifyIdentity: vi.fn(async () => undefined),
    waitFor: async <T>(expression: string) => (window.eval(expression) as T) || undefined,
  };
  return { window, page, context, account, setApp };
}

const job = (overrides: Partial<SocialJob> = {}): SocialJob =>
  ({
    id: "job",
    operationId: "operation",
    dedupeKey: "dedupe",
    accountId: "synthetic",
    projectIds: ["project"],
    provider: "owner",
    kind: "message",
    payload: { text: "Hello", media: [], recipientId: "905559876543" },
    status: "running",
    scheduledAt: NOW,
    attempts: 1,
    createdAt: NOW,
    actorId: "owner",
    ...overrides,
  }) as SocialJob;

describe("WhatsApp Web personal poll", () => {
  it("skips group chats without failing and advances the cursor past every visited position", async () => {
    const { context } = harness(appWith(["group", "direct", "group", "direct", "group", "direct"]));
    const result = await whatsappBrowserRecipe.poll(context, []);
    expect(readCursor(result.cursor)).toBe(5);
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.text).toBe("Hello from a synthetic contact");
      expect(event.threadId).toBe("905559876543");
      expect(event.eventId).toBe("whatsapp:false_905559876543@c.us_3EB0A1");
    }
    expect(result.coverage).toEqual([{ channel: "messages", status: "read" }]);
  });

  it("skips one untimed message and keeps the timed incoming message", async () => {
    const { context } = harness(appWith(["direct"]));
    const result = await whatsappBrowserRecipe.poll(context, []);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      text: "Hello from a synthetic contact",
      at: Date.UTC(2026, 10, 7, 11, 0, 0),
    });
    // One chat in the list: the position wraps to 0.
    expect(readCursor(result.cursor)).toBe(0);
  });

  it("treats a single unknown direct chat as skipped, but an all-unknown visit set as a changed layout", async () => {
    const mixed = harness(appWith(["unknown", "direct"]));
    const partial = await whatsappBrowserRecipe.poll(mixed.context, []);
    expect(partial.events).toHaveLength(1);

    const allUnknown = harness(appWith(["unknown", "unknown"]));
    await expect(whatsappBrowserRecipe.poll(allUnknown.context, [])).rejects.toBeInstanceOf(
      UnexpectedScreen,
    );
  });

  it("hands an unrecognized chat list to the layered driver as UnexpectedScreen", async () => {
    const { context } = harness(
      `<div id="app"><div id="pane-side"><span>Synthetic</span></div><div id="main"></div></div>`,
    );
    await expect(whatsappBrowserRecipe.poll(context, [])).rejects.toBeInstanceOf(UnexpectedScreen);
  });

  it("rejects malformed cursors and accepts only the version 1 position shape", () => {
    expect(readCursor(undefined)).toBe(0);
    expect(readCursor(writeCursor(3))).toBe(3);
    expect(() => readCursor("not json")).toThrow(SocialPlatformError);
    expect(() => readCursor('{"v":1,"next":51}')).toThrow(SocialPlatformError);
    expect(() => readCursor('{"v":2,"next":1}')).toThrow(SocialPlatformError);
  });
});

describe("WhatsApp Web link-device screen", () => {
  it("reports a visible QR screen as needs_human from identity without reading or clicking it", async () => {
    const { context, page, setApp } = harness();
    setApp(LOGIN);
    const error = await whatsappBrowserRecipe
      .identity(page, context.account)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SocialPlatformError);
    expect(error).toMatchObject({
      code: "needs_human",
      detail: { url: "https://web.whatsapp.com/" },
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("returns no identity for an ordinary chat list without a profile drawer", async () => {
    const { context, page } = harness();
    await expect(whatsappBrowserRecipe.identity(page, context.account)).resolves.toBeUndefined();
  });
});

describe("WhatsApp Web personal bulk guard", () => {
  it.each([
    { campaignId: "campaign-1" },
    { programId: "program-1" },
    { publishingPlanId: "plan-1" },
    { occurrenceId: "occurrence-1" },
    { ruleId: "rule-1" },
  ])("refuses a bulk-marked message before any browser interaction: %j", async (marker) => {
    const { context, page } = harness();
    const bulk = job(marker);
    expect(isPersonalBulkJob(bulk)).toBe(true);
    await expect(whatsappBrowserRecipe.send(context, bulk)).rejects.toMatchObject({
      code: "rejected",
      detail: { reasonCode: "whatsapp.personal_bulk_blocked" },
    });
    expect(page.goto).not.toHaveBeenCalled();
    expect(context.verifyIdentity).not.toHaveBeenCalled();
  });

  it("does not mark a single owner-initiated message as bulk", () => {
    expect(isPersonalBulkJob(job())).toBe(false);
    expect(isPersonalBulkJob(job({ kind: "reply", draftId: "draft-1" }))).toBe(false);
  });
});
