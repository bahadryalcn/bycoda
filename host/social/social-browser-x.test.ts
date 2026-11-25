import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserSendLimiter } from "./browser/limiter";
import type { BrowserPage, BrowserSession } from "./social-browser";
import { publishX } from "./social-browser-x-compose";
import { pollX } from "./social-browser-x-inbox";
import {
  parseCreateTweet,
  xChatBlockReason,
  xIdentity,
  xScreenSummary,
  type XBrowserDeps,
} from "./social-browser-x-page";

/**
 * Browser checks use DOM fixtures that are hand-written to match the markup shapes the X recipe
 * reads. They are synthetic: no page was recorded from a live X session.
 */
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/x/${name}`, import.meta.url)), "utf8");

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), "x-browser-"));
  directories.push(dir);
  return dir;
};

type Cookie = { name: string; value: string };
const LOGGED_IN: Cookie[] = [
  { name: "auth_token", value: "session-value" },
  { name: "twid", value: "u%3D42" },
];

/** DOM-backed page. Detection and summaries only read the DOM; interactions are spies that must stay uncalled. */
function pageAt(url: string, body: string, cookies: Cookie[] = []) {
  const window = new Window({ url });
  window.document.body.innerHTML = body;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 100, height: 30 }];
    },
  });
  return {
    goto: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    insertText: vi.fn(async () => undefined),
    setFiles: vi.fn(async () => undefined),
    watchResponse: vi.fn((_path: RegExp) => ({
      body: async (): Promise<string | undefined> => undefined,
      stop: () => undefined,
    })),
    cookies: vi.fn(async () => cookies),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => window.eval(expression) as T),
  };
}

const account = (overrides: Partial<SocialAccount> = {}): SocialAccount =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    platform: "x",
    platformId: "42",
    name: "@owner",
    accountType: "member",
    connection: "browser",
    scopes: [],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
    ...overrides,
  }) as SocialAccount;

const job = (payload: Record<string, unknown> = {}, kind: SocialJob["kind"] = "publish") =>
  ({
    id: "job",
    kind,
    payload: { text: "hello", media: [], ...payload },
    attempts: 0,
    scheduledAt: 0,
    status: "running",
  }) as unknown as SocialJob;

function depsFor(directory: string, session?: BrowserSession): XBrowserDeps {
  return {
    directory,
    background: true,
    launcher: session ? vi.fn(async () => session) : undefined,
    limiter: {
      reserve: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    } as unknown as BrowserSendLimiter,
    now: () => 1_000,
    profile: (accountId: string) => join(directory, accountId),
    identity: vi.fn(async () => undefined),
    until: vi.fn(async () => undefined),
    readSession: vi.fn(async () => {
      throw new Error("not used");
    }),
    releaseRead: vi.fn(async () => undefined),
  } as XBrowserDeps;
}

const readCurrentPage: XBrowserDeps["until"] = async <T>(page: BrowserPage, expression: string) =>
  (await page.evaluate<T>(expression)) || undefined;

describe("X browser identity and challenge pages", () => {
  it("marks a captcha page NEEDS_HUMAN and never interacts with it", async () => {
    const page = pageAt("https://x.com/account/access", fixture("captcha-challenge.html"));
    const error = await xIdentity(page as unknown as BrowserPage, account(), await scratch()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SocialPlatformError);
    expect(error).toMatchObject({
      code: "needs_human",
      detail: { url: "https://x.com/account/access" },
    });
    expect(page.click).not.toHaveBeenCalled();
    expect(page.fill).not.toHaveBeenCalled();
    expect(page.insertText).not.toHaveBeenCalled();
    expect(page.setFiles).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("keeps a logged-out login page as expired so the owner signs in again", async () => {
    const page = pageAt("https://x.com/i/flow/login", fixture("logged-out-login.html"));
    await expect(
      xIdentity(page as unknown as BrowserPage, account(), await scratch()),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("accepts the verified session and refuses another logged-in user", async () => {
    const page = pageAt("https://x.com/home", "", LOGGED_IN);
    await expect(
      xIdentity(page as unknown as BrowserPage, account(), await scratch()),
    ).resolves.toBeUndefined();
    await expect(
      xIdentity(page as unknown as BrowserPage, account({ platformId: "43" }), await scratch()),
    ).rejects.toMatchObject({ code: "denied" });
  });
});

describe("X screen summary", () => {
  it("describes a missing composer from labels and text only", async () => {
    const page = pageAt(
      "https://x.com/compose/post?secret=abc",
      fixture("compose-missing-editor.html"),
    );
    const summary = await xScreenSummary(page as unknown as BrowserPage);
    expect(summary.url).toBe("https://x.com/compose/post");
    expect(summary.buttons).toEqual(["Try again", "Go home"]);
    expect(summary.headings).toEqual(["Your post could not be loaded"]);
    expect(summary.errors).toEqual(["Something went wrong. Try again."]);
    expect(summary.fields).toEqual(["Verification field"]);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("SECRET-VALUE");
    expect(serialized).not.toContain("secret=abc");
  });

  it("raises UnexpectedScreen for publishing when the composer is missing on an ordinary page", async () => {
    const directory = await scratch();
    const page = pageAt(
      "https://x.com/compose/post",
      fixture("compose-missing-editor.html"),
      LOGGED_IN,
    );
    const session = {
      page,
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    };
    const deps = depsFor(directory, session as unknown as BrowserSession);
    const error = await publishX(
      deps,
      account({ connection: "browser" }),
      job(),
      async () => new Uint8Array(),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      name: "UnexpectedScreen",
      snapshot: { url: "https://x.com/compose/post" },
    });
    expect(deps.limiter.record).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });
});

describe("X browser publishing gates", () => {
  it.each(["ready", "missing", "wrong route", "wrong account", "existing draft"] as const)(
    "uses only the exact home composer after an empty X post dialog (%s)",
    async (state) => {
      const directory = await scratch();
      const dialog = pageAt(
        "https://x.com/compose/post",
        '<a data-testid="AppTabBar_Profile_Link" href="/owner">Profile</a><div role="dialog" aria-modal="true" aria-labelledby="modal-header"></div>',
        LOGGED_IN,
      );
      const home = pageAt(
        state === "wrong route" ? "https://x.com/owner/status/123" : "https://x.com/home",
        state === "missing"
          ? '<div data-testid="tweetTextarea_0" contenteditable="true"></div>'
          : `<div data-testid="primaryColumn"><div data-testid="tweetTextarea_0" contenteditable="true">${state === "existing draft" ? "Owner draft" : ""}</div><button data-testid="tweetButtonInline">Post</button></div>`,
        state === "wrong account"
          ? [
              { name: "auth_token", value: "other-session" },
              { name: "twid", value: "u%3D43" },
            ]
          : LOGGED_IN,
      );
      const page = {
        ...dialog,
        watchResponse: vi.fn(() => ({
          body: async () => fixture("create-tweet-ok.json"),
          stop: vi.fn(),
        })),
      };
      page.goto.mockImplementation(async (url?: string) => {
        if (url === "https://x.com/home") {
          page.evaluate.mockImplementation(home.evaluate);
          page.cookies.mockImplementation(home.cookies);
        }
      });
      const deps = depsFor(directory, {
        page,
        closed: new Promise<void>(() => undefined),
        close: vi.fn(async () => undefined),
      } as unknown as BrowserSession);
      deps.until = readCurrentPage;
      const send = publishX(deps, account(), job(), async () => new Uint8Array());
      if (state === "ready") {
        await expect(send).resolves.toEqual({
          platformId: "1900000000000000001",
          url: "https://x.com/i/status/1900000000000000001",
        });
        expect(page.insertText).toHaveBeenCalledExactlyOnceWith("hello");
        expect(page.click).toHaveBeenLastCalledWith(
          '[data-testid="primaryColumn"] [data-testid="tweetButtonInline"]',
        );
        expect(deps.limiter.record).toHaveBeenCalledTimes(1);
      } else {
        await expect(send).rejects.toBeDefined();
        expect(page.insertText).not.toHaveBeenCalled();
        expect(page.click).not.toHaveBeenCalled();
        expect(deps.limiter.record).not.toHaveBeenCalled();
      }
      expect(page.goto.mock.calls).toEqual([
        ["https://x.com/compose/post"],
        ["https://x.com/home"],
      ]);
    },
  );

  const replyControls =
    '<div data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButtonInline">Reply</button>';

  async function replyAt(url: string, returnedParent?: string, returnedPost = "777") {
    const page = pageAt(url, replyControls, LOGGED_IN);
    const stop = vi.fn();
    page.watchResponse.mockReturnValue({
      body: async () =>
        JSON.stringify({
          data: {
            create_tweet: {
              tweet_results: {
                result: {
                  rest_id: returnedPost,
                  legacy: { in_reply_to_status_id_str: returnedParent },
                },
              },
            },
          },
        }),
      stop,
    });
    const session = { page, close: vi.fn(async () => undefined) } as unknown as BrowserSession;
    const deps = depsFor(await scratch(), session);
    deps.until = readCurrentPage;
    const send = (beforeSubmit = vi.fn<() => Promise<void>>()) =>
      publishX(
        deps,
        account(),
        job({ postId: "123" }, "comment"),
        async () => new Uint8Array(),
        beforeSubmit,
      );
    return { page, deps, send, stop };
  }

  it("accepts the canonical X permalink and confirms the same reply parent", async () => {
    const f = await replyAt("https://x.com/author/status/123", "123");
    await expect(f.send()).resolves.toEqual({
      platformId: "777",
      url: "https://x.com/i/status/777",
    });
    expect(f.page.click).toHaveBeenCalledWith('[data-testid="tweetButtonInline"]');
    expect(f.stop).toHaveBeenCalled();
  });

  it.each([
    "https://x.com/other/status/456",
    "https://x.com/home",
    "https://x.com/author/status/123/photo/1",
    "https://example.test/author/status/123",
  ])("leaves the composer untouched outside the exact X reply target: %s", async (url) => {
    const f = await replyAt(url, "123");
    const submit = vi.fn<() => Promise<void>>();
    await expect(f.send(submit)).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).not.toHaveBeenCalled();
    expect(f.page.insertText).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("never clicks Reply if the target changes during approval", async () => {
    const f = await replyAt("https://x.com/author/status/123", "123");
    await expect(
      f.send(
        vi.fn(async () => {
          await f.page.evaluate('history.replaceState(null, "", "/other/status/456")');
        }),
      ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(f.page.click).toHaveBeenCalledExactlyOnceWith('[data-testid="tweetTextarea_0"]');
    expect(f.page.watchResponse).not.toHaveBeenCalled();
  });

  it.each([
    ["456", "777"],
    [undefined, "777"],
    ["123", "123"],
  ])(
    "keeps an unconfirmed reply outcome under review for parent %s and id %s",
    async (parent, id) => {
      const f = await replyAt("https://x.com/author/status/123", parent, id);
      await expect(f.send()).rejects.toMatchObject({ code: "unknown" });
      expect(f.page.click).toHaveBeenCalledWith('[data-testid="tweetButtonInline"]');
      expect(f.stop).toHaveBeenCalled();
    },
  );

  it.each([
    ["publish", {}, "/compose/post"],
    ["reply", { postId: "123" }, "/i/status/123"],
    ["message", { recipientId: "77" }, "/messages/compose"],
  ] as const)(
    "asks to reconnect when the %s composer redirects to current X sign-in",
    async (kind, payload, redirect) => {
      const page = pageAt(
        `https://x.com/i/jf/onboarding/web?redirect_after_login=${encodeURIComponent(redirect)}&mode=login`,
        '<form><input name="username_or_email"></form>',
        LOGGED_IN,
      );
      const session = { page, close: vi.fn(async () => undefined) } as unknown as BrowserSession;
      const deps = depsFor(await scratch(), session);
      deps.until = readCurrentPage;
      const submit = vi.fn();
      await expect(
        publishX(deps, account(), job(payload, kind), async () => new Uint8Array(), submit),
      ).rejects.toMatchObject({ code: "expired" });
      expect(page.click).not.toHaveBeenCalled();
      expect(page.insertText).not.toHaveBeenCalled();
      expect(deps.limiter.record).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("reports verification on current X sign-in before telling the owner to reconnect", async () => {
    const page = pageAt(
      "https://x.com/i/jf/onboarding/web?mode=login",
      '<form><input autocomplete="one-time-code"></form>',
      LOGGED_IN,
    );
    const session = { page, close: vi.fn(async () => undefined) } as unknown as BrowserSession;
    const deps = depsFor(await scratch(), session);
    deps.until = readCurrentPage;
    await expect(
      publishX(deps, account(), job(), async () => new Uint8Array()),
    ).rejects.toMatchObject({
      code: "needs_human",
      detail: { url: "https://x.com/i/jf/onboarding/web" },
    });
    expect(page.click).not.toHaveBeenCalled();
  });

  it("refuses over-length text before pacing, upload or browser launch", async () => {
    const directory = await scratch();
    const session = {
      page: pageAt("https://x.com/home", "", LOGGED_IN),
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    };
    const deps = depsFor(directory, session as unknown as BrowserSession);
    await expect(
      publishX(deps, account(), job({ text: "a".repeat(281) }), async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "rejected" });
    expect(deps.limiter.reserve).not.toHaveBeenCalled();
    expect(deps.launcher).not.toHaveBeenCalled();
  });
});

describe("X encrypted chat gate", () => {
  const PIN_SHELL = '<div data-testid="xchatEmbedRoute"></div><div id="host"></div>';
  const withPrompt = (page: ReturnType<typeof pageAt>, prompt: boolean) => {
    if (!prompt) return;
    page.evaluate(`(() => {
      const shadow = document.getElementById("host").attachShadow({ mode: "open" });
      shadow.innerHTML = '<div data-testid="pin-title">x</div><div data-testid="pin-code-input-container"></div>';
    })()`);
  };
  const liveDeps = (directory: string, page: ReturnType<typeof pageAt>) => {
    const session = {
      page,
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BrowserSession;
    const deps = depsFor(directory, session);
    deps.readSession = vi.fn(async () => session);
    deps.until = (async (target: BrowserPage, expression: string) =>
      (await target.evaluate(expression)) || undefined) as XBrowserDeps["until"];
    return deps;
  };

  it("reports the passcode prompt inside the XChat shadow root as chat_setup_required", async () => {
    const page = pageAt("https://x.com/i/chat", PIN_SHELL, LOGGED_IN);
    withPrompt(page, true);
    const reason = await xChatBlockReason(
      liveDeps(await scratch(), page),
      page as unknown as BrowserPage,
    );
    expect(reason).toBe("chat_setup_required");
    expect(page.click).not.toHaveBeenCalled();
    expect(page.insertText).not.toHaveBeenCalled();
  });

  it("keeps the generic encrypted_chat_unsupported reason when no passcode prompt is mounted", async () => {
    const page = pageAt("https://x.com/i/chat", PIN_SHELL, LOGGED_IN);
    expect(
      await xChatBlockReason(liveDeps(await scratch(), page), page as unknown as BrowserPage),
    ).toBe("encrypted_chat_unsupported");
  });

  it("fails a DM send fast as unsupported when /messages/compose lands on XChat", async () => {
    const page = pageAt("https://x.com/i/chat", PIN_SHELL, LOGGED_IN);
    withPrompt(page, true);
    const deps = liveDeps(await scratch(), page);
    const beforeSubmit = vi.fn(async () => undefined);
    const error = await publishX(
      deps,
      account(),
      job({ recipientId: "77" }, "message"),
      async () => new Uint8Array(),
      beforeSubmit,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "unsupported",
      detail: { reasonCode: "chat_setup_required" },
    });
    expect(page.goto).toHaveBeenCalledWith("https://x.com/messages/compose?recipient_id=77");
    expect(beforeSubmit).not.toHaveBeenCalled();
    expect(deps.limiter.record).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(page.insertText).not.toHaveBeenCalled();
  });
});

describe("X browser monitoring", () => {
  it("reads the messages channel for a legacy browser account that has no DM scope", async () => {
    const directory = await scratch();
    const page = pageAt("https://x.com/home", "", LOGGED_IN);
    const session = {
      page,
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    };
    const deps = depsFor(directory, session as unknown as BrowserSession);
    deps.readSession = vi.fn(async () => session as unknown as BrowserSession);
    // Legacy accounts were stored before DM scopes existed. The recipe decides, not the stored list.
    await expect(
      pollX(deps, account({ scopes: ["tweet.read"] }), [], undefined),
    ).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(page.goto).toHaveBeenCalledWith("https://x.com/messages");
  });
  it("accepts a localized empty mentions page as a read channel", async () => {
    const directory = await scratch();
    const page = pageAt(
      "https://x.com/notifications/mentions",
      `<a role="tab" aria-selected="true" href="/notifications/mentions">Bahsetmeler</a><div data-testid="emptyState"><span data-testid="empty_state_header_text">Burada görecek bir şey yok — henüz</span><span data-testid="empty_state_body_text">Biri senden bahsettiğinde burada bulacaksın.</span></div>`,
      LOGGED_IN,
    );
    const session = {
      page,
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    };
    const deps = depsFor(directory, session as unknown as BrowserSession);
    deps.readSession = vi.fn(async () => session as unknown as BrowserSession);
    deps.until = vi.fn(async () => "/i/chat") as XBrowserDeps["until"];
    const result = await pollX(deps, account(), [], undefined);
    expect(result.coverage[0]).toEqual({ channel: "mentions", status: "read" });
  });
  it("waits for the delayed encrypted-chat redirect instead of timing out on the previous page", async () => {
    const directory = await scratch();
    const page = pageAt("https://x.com/notifications/mentions", "", LOGGED_IN);
    page.watchResponse = vi.fn((path: RegExp) => ({
      body: async (): Promise<string | undefined> =>
        path.test("/NotificationsTimeline")
          ? '{"data":{"timeline":{"instructions":[]}}}'
          : undefined,
      stop: () => undefined,
    }));
    const session = {
      page,
      closed: new Promise<void>(() => undefined),
      close: vi.fn(async () => undefined),
    };
    const deps = depsFor(directory, session as unknown as BrowserSession);
    deps.readSession = vi.fn(async () => session as unknown as BrowserSession);
    deps.until = vi.fn(async () => "/i/chat") as XBrowserDeps["until"];
    const result = await pollX(deps, account(), [], undefined);
    expect(result.coverage).toEqual([
      { channel: "mentions", status: "read" },
      { channel: "messages", status: "unavailable", reason: "encrypted_chat_unsupported" },
    ]);
  });
});

describe("X create-tweet responses", () => {
  it("reads the platform post ID from a recorded-shape success response", () => {
    expect(parseCreateTweet(fixture("create-tweet-ok.json"))).toEqual({
      platformId: "1900000000000000001",
      url: "https://x.com/i/status/1900000000000000001",
    });
  });

  it("maps the rate-limit error code to rate_limit with a retry time", () => {
    expect(() => parseCreateTweet(fixture("create-tweet-error-88.json"), 0)).toThrow(
      expect.objectContaining({ code: "rate_limit", retryAt: 60 * 60_000 }),
    );
  });
});
