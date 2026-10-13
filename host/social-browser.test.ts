import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findBrowser,
  parseCreateTweet,
  XBrowserSessions,
  xUserId,
  type BrowserLauncher,
  type BrowserPage,
  type PlainBrowserLauncher,
} from "./social-browser";
import { SocialService } from "./social";
import { HostStore } from "./store";
import type { SocialCredential } from "./social-credentials";
import type { SocialAdapters } from "../src/integrations/social/adapter";
import { accountCapabilities } from "../src/integrations/social/capabilities";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));
const owner = { kind: "owner", actorId: "device", provider: "owner" } as const;
const loggedIn = (id = "42") => [
  { name: "auth_token", value: "synthetic" },
  { name: "twid", value: `u%3D${id}` },
];

function fakeBrowser(options: {
  cookies?: () => { name: string; value: string }[];
  path?: string;
  response?: string;
}) {
  const calls: string[] = [];
  let closed!: () => void;
  const page: BrowserPage = {
    goto: vi.fn(async (url: string) => {
      calls.push(`goto ${url}`);
    }),
    evaluate: vi.fn(async (expression: string) => {
      if (expression.includes("AppTabBar_Profile_Link")) return "/owner";
      if (expression.includes("location.pathname"))
        return options.path === "login" ? "login" : "ready";
      return true;
    }) as BrowserPage["evaluate"],
    click: vi.fn(async (selector: string) => {
      calls.push(`click ${selector}`);
    }),
    insertText: vi.fn(async (text: string) => {
      calls.push(`text ${text}`);
    }),
    setFiles: vi.fn(async (_selector: string, files: string[]) => {
      calls.push(`files ${files.length}`);
    }),
    watchResponse: () => ({
      body: async () => options.response,
      stop: () => undefined,
    }),
    cookies: async () => (options.cookies ?? (() => loggedIn()))(),
  };
  const launcher = vi.fn<BrowserLauncher>(async (_profile, background) => {
    calls.push(`launch ${background ? "background" : "window"}`);
    return {
      page,
      closed: new Promise<void>((resolve) => {
        closed = resolve;
      }),
      close: async () => {
        calls.push("close");
        closed();
      },
    };
  });
  let closeWindow!: () => void;
  const plain = vi.fn<PlainBrowserLauncher>(async (_profile, url) => {
    calls.push(`plain ${url}`);
    const closed = new Promise<void>((resolve) => {
      closeWindow = () => {
        calls.push("window closed");
        resolve();
      };
    });
    return { closed, close: async () => closeWindow() };
  });
  return { calls, launcher, page, plain, closeWindow: () => closeWindow() };
}

async function fixture(
  launcher: BrowserLauncher,
  now = () => 1_000_000,
  plain?: PlainBrowserLauncher,
) {
  const path = mkdtempSync(join(tmpdir(), "social-browser-"));
  const store = new HostStore(join(path, "host.db"));
  const project = store.addProject(path, "Project");
  const tokens = new Map<string, SocialCredential>();
  const vault = {
    get: async (id: string) => tokens.get(id),
    set: async (id: string, c: SocialCredential) => {
      tokens.set(id, c);
    },
    delete: async (id: string) => {
      tokens.delete(id);
    },
  };
  const browser = new XBrowserSessions(
    path,
    launcher,
    now,
    async () => {
      await new Promise((resolve) => setImmediate(resolve));
    },
    true,
    plain,
  );
  const social = new SocialService(
    store,
    vault,
    {} as SocialAdapters,
    path,
    undefined,
    undefined,
    undefined,
    browser.adapter(),
  );
  cleanup.push(() => {
    social.stop();
    store.close();
    rmSync(path, { recursive: true, force: true });
  });
  const account = (await social.call(owner, "accounts.create", {
    platform: "x",
    name: "Pending",
    accountType: "member",
    projectIds: [project.id],
  })) as SocialAccount;
  return { social, browser, account, tokens };
}
async function settle(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++)
    await new Promise((resolve) => setImmediate(resolve));
}
const job = (overrides: Partial<SocialJob["payload"]> = {}): SocialJob => ({
  id: "job",
  operationId: "operation",
  dedupeKey: "dedupe",
  accountId: "",
  projectIds: [],
  provider: "owner",
  kind: "publish",
  payload: { text: "Hello", media: [], ...overrides },
  status: "running",
  scheduledAt: 0,
  attempts: 0,
  createdAt: 0,
  actorId: "device",
});
const created = JSON.stringify({
  data: { create_tweet: { tweet_results: { result: { rest_id: "777" } } } },
});

describe("X tarayıcı oturumu", () => {
  it("logs in through a plain window and verifies the session after it closes", async () => {
    let cookies: { name: string; value: string }[] = [];
    const fake = fakeBrowser({ cookies: () => cookies });
    const s = await fixture(fake.launcher, undefined, fake.plain);
    expect(() => s.browser.begin(s.social, owner, s.account.id, undefined)).toThrow("unofficial");
    expect(s.browser.begin(s.social, owner, s.account.id, true).status).toBe("waiting");
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    // No debugger-controlled browser while the owner logs in (Google blocks those).
    expect(fake.launcher).not.toHaveBeenCalled();
    expect(s.browser.status(s.social, owner, s.account.id).status).toBe("waiting");
    cookies = loggedIn("42");
    fake.closeWindow();
    await settle(() => s.browser.status(s.social, owner, s.account.id).status !== "waiting");
    expect(s.browser.status(s.social, owner, s.account.id)).toEqual({
      status: "connected",
      error: undefined,
    });
    expect(fake.calls.slice(0, 4)).toEqual([
      "plain https://x.com/login",
      "window closed",
      "launch background",
      "goto https://x.com/home",
    ]);
    expect(fake.calls).toContain("close");
    const account = ((await s.social.call(owner, "accounts.list", {})) as SocialAccount[]).find(
      (item) => item.id === s.account.id,
    )!;
    expect(account).toMatchObject({
      connected: true,
      connection: "browser",
      platformId: "42",
      name: "@owner",
      accessApproved: true,
    });
    // The browser profile is the credential; the vault holds only a marker.
    expect(s.tokens.get(s.account.id)).toEqual({
      accessToken: "browser-session",
    });
    const capabilities = Object.fromEntries(
      accountCapabilities(account).map((item) => [item.operation, item.status]),
    );
    expect(capabilities).toMatchObject({
      publish: "available",
      media: "available",
      comment: "available",
      poll: "unsupported",
      "inbox.read": "unsupported",
      "message.start": "unsupported",
    });
  });
  it("fails when the window closes without an X login and removes the profile on disconnect", async () => {
    const fake = fakeBrowser({ cookies: () => [] });
    const s = await fixture(fake.launcher, undefined, fake.plain);
    s.browser.begin(s.social, owner, s.account.id, true);
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    fake.closeWindow();
    await settle(() => s.browser.status(s.social, owner, s.account.id).status === "failed");
    expect(s.browser.status(s.social, owner, s.account.id).error).toContain("not completed");
    const forget = vi.fn(async () => undefined);
    s.social.forgetBrowserSession = forget;
    await s.social.connectAccount(
      s.account.id,
      {
        platformId: "42",
        name: "@owner",
        scopes: [],
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
    );
    await s.social.call(owner, "accounts.disconnect", {
      accountId: s.account.id,
    });
    expect(forget).toHaveBeenCalledWith(s.account.id);
  });
  it("cancels an open login on disconnect and requires the executor host", async () => {
    const fake = fakeBrowser({ cookies: () => [] });
    const s = await fixture(fake.launcher, undefined, fake.plain);
    s.browser.begin(s.social, owner, s.account.id, true);
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    await s.browser.forget(s.account.id);
    expect(fake.calls).toContain("window closed");
    expect(fake.launcher).not.toHaveBeenCalled();
    expect(s.browser.status(s.social, owner, s.account.id).status).toBe("idle");
    await s.social.call(owner, "accounts.executor", {
      accountId: s.account.id,
      executorId: "other-host",
    });
    expect(() => s.browser.begin(s.social, owner, s.account.id, true)).toThrow("executor host");
  });
  it("publishes text, link and images from the matching logged-in account", async () => {
    const fake = fakeBrowser({ response: created });
    const s = await fixture(fake.launcher);
    const account = { ...s.account, platformId: "42" };
    const result = await s.browser.adapter().send(
      account,
      job({
        link: "https://example.test",
        media: [
          { kind: "image", uploadId: "a" },
          { kind: "image", uploadId: "b" },
        ],
      }),
      "browser-session",
      async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(result).toEqual({
      platformId: "777",
      url: "https://x.com/i/status/777",
    });
    expect(fake.calls).toEqual([
      "launch background",
      "goto https://x.com/compose/post",
      'click [data-testid="tweetTextarea_0"]',
      "text Hello\nhttps://example.test",
      "files 2",
      'click [data-testid="tweetButton"]',
      "close",
    ]);
  });
  it("replies inline on the target post and refuses DMs", async () => {
    const fake = fakeBrowser({ response: created });
    const s = await fixture(fake.launcher);
    const account = { ...s.account, platformId: "42" };
    await s.browser
      .adapter()
      .send(
        account,
        { ...job({ postId: "123" }), kind: "comment" },
        "",
        async () => new Uint8Array(),
      );
    expect(fake.calls).toContain("goto https://x.com/i/status/123");
    expect(fake.calls).toContain('click [data-testid="tweetButtonInline"]');
    await expect(
      s.browser
        .adapter()
        .send(account, { ...job(), kind: "message" }, "", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
  it("never posts from a different or logged-out profile", async () => {
    const other = fakeBrowser({
      cookies: () => loggedIn("99"),
      response: created,
    });
    const s = await fixture(other.launcher);
    const account = { ...s.account, platformId: "42" };
    await expect(
      s.browser.adapter().send(account, job(), "", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "denied" });
    expect(other.calls.some((call) => call.includes("tweetButton"))).toBe(false);
    const out = fakeBrowser({ path: "login" });
    const t = await fixture(out.launcher);
    await expect(
      t.browser
        .adapter()
        .send({ ...t.account, platformId: "42" }, job(), "", async () => new Uint8Array()),
    ).rejects.toMatchObject({ code: "expired" });
  });
  it("treats a missing post response as uncertain and spaces sends", async () => {
    let now = 1_000_000;
    const fake = fakeBrowser({ response: undefined });
    const s = await fixture(fake.launcher, () => now);
    const account = { ...s.account, platformId: "42" };
    const send = () => s.browser.adapter().send(account, job(), "", async () => new Uint8Array());
    await expect(send()).rejects.toMatchObject({ code: "unknown" });
    now += 1000;
    await expect(send()).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 1_030_000,
    });
  });
});

describe("X web yanıtları", () => {
  it("reads post IDs and maps explicit errors", () => {
    expect(
      parseCreateTweet(
        JSON.stringify({
          data: {
            notetweet_create: { tweet_results: { result: { rest_id: "9" } } },
          },
        }),
      ).platformId,
    ).toBe("9");
    expect(() => parseCreateTweet(JSON.stringify({ errors: [{ code: 187 }] }))).toThrow(
      expect.objectContaining({ code: "rejected" }),
    );
    expect(() => parseCreateTweet(JSON.stringify({ errors: [{ code: 326 }] }))).toThrow(
      expect.objectContaining({ code: "denied" }),
    );
    expect(() => parseCreateTweet(JSON.stringify({ errors: [{ code: 344 }] }), 0)).toThrow(
      expect.objectContaining({ code: "rate_limit" }),
    );
    expect(() => parseCreateTweet("{}")).toThrow(expect.objectContaining({ code: "unknown" }));
  });
  it("requires both auth cookies for the user ID", () => {
    expect(xUserId(loggedIn("42"))).toBe("42");
    expect(xUserId([{ name: "twid", value: "u%3D42" }])).toBeUndefined();
    expect(
      xUserId([
        { name: "auth_token", value: "x" },
        { name: "twid", value: "u%3Dabc" },
      ]),
    ).toBeUndefined();
  });
  it("prefers system Chrome over Edge on Windows and honors an override", () => {
    const env = {
      ProgramFiles: "C:\\PF",
      "ProgramFiles(x86)": "C:\\PF86",
    } as NodeJS.ProcessEnv;
    expect(findBrowser(env, "win32", () => true)).toBe(
      "C:\\PF\\Google\\Chrome\\Application\\chrome.exe",
    );
    expect(findBrowser(env, "win32", (path) => path.endsWith("msedge.exe"))).toBe(
      "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe",
    );
    expect(
      findBrowser({ BYCODA_SOCIAL_BROWSER: "/missing" }, "linux", () => false),
    ).toBeUndefined();
  });
});
