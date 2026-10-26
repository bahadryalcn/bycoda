import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
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
import { accountCapabilities, X_BROWSER_SCOPES } from "../src/integrations/social/capabilities";
import type { SocialAccount, SocialJob } from "../src/features/social/model/social";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const owner = { kind: "owner", actorId: "device", provider: "owner" } as const;
const loggedIn = (id = "42") => [
  { name: "auth_token", value: "synthetic" },
  { name: "twid", value: `u%3D${id}` },
];
function fakeBrowser(options: {
  cookies?: () => {
    name: string;
    value: string;
  }[];
  path?: string;
  emptyMentions?: boolean;
  response?: string;
  responses?: {
    mentions?: string;
    inbox?: string;
  };
}) {
  const calls: string[] = [];
  let closed!: () => void;
  const page: BrowserPage = {
    goto: vi.fn(async (url: string) => {
      calls.push(`goto ${url}`);
    }),
    evaluate: vi.fn(async (expression: string) => {
      if (expression.includes("empty_state_body_text")) return options.emptyMentions === true;
      if (expression === "location.pathname") return options.path ?? "/messages/42-7";
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
    fill: vi.fn(async (selector, text) => {
      calls.push(`fill ${selector} ${text}`);
    }),
    setFiles: vi.fn(async (_selector: string, files: string[]) => {
      calls.push(`files ${files.length}`);
    }),
    watchResponse: (path) => ({
      body: async () =>
        options.responses && path.test("/NotificationsTimeline")
          ? options.responses.mentions
          : options.responses && path.test("/inbox_initial_state.json")
            ? options.responses.inbox
            : options.response,
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
  now = () => 1000000,
  plain?: PlainBrowserLauncher,
) {
  const path = mkdtempSync(join(tmpdir(), "social-browser-"));
  const store = new HostStore(join(path, "host.db"));
  const project = await store.addProject(path, "Project");
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
    now,
    undefined,
    browser.adapter(),
  );
  cleanup.push(async () => {
    await social.dispose();
    await store.close();
    rmSync(path, { recursive: true, force: true });
  });
  const account = (await social.call(owner, "accounts.create", {
    platform: "x",
    name: "Pending",
    accountType: "member",
    projectIds: [project.id],
  })) as SocialAccount;
  return { social, browser, account, tokens, project };
}
async function settle(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 200 && !(await check()); attempt++)
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
async function linkedInProfileFixture(
  options: { accountType?: "organization" | "member"; connection?: "browser" | "api" } = {},
) {
  const fake = fakeBrowser({});
  const s = await fixture(fake.launcher);
  const accountType = options.accountType ?? "organization";
  const account = (await s.social.call(owner, "accounts.create", {
    platform: "linkedin",
    name: "Bycoda",
    accountType,
    projectIds: [s.project.id],
  })) as SocialAccount;
  await s.social.connectAccount(
    account.id,
    {
      platformId:
        accountType === "organization" ? "web:linkedin:company:145372363" : "web:linkedin:in:owner",
      name: "Bycoda",
      scopes: [],
      accessApproved: true,
      connection: options.connection ?? "browser",
    },
    { accessToken: "browser-session" },
  );
  let bio = "Old",
    uploaded = false,
    saved = false,
    correctActor = true;
  vi.mocked(fake.page.evaluate).mockImplementation(async <T>(expression: string): Promise<T> => {
    if (!correctActor) return undefined as T;
    if (expression.includes("const container=logo.closest"))
      return (
        saved
          ? "https://media.licdn.com/dms/image/v2/new/company-logo_100_100/bycoda_logo"
          : "https://media.licdn.com/dms/image/v2/old/company-logo_100_100/bycoda_logo"
      ) as T;
    if (expression.includes("return {name:name.value"))
      return { name: "Bycoda", bio, location: "", website: "" } as T;
    return true as T;
  });
  vi.mocked(fake.page.fill).mockImplementation(async (_selector, value) => {
    bio = value;
  });
  vi.mocked(fake.page.setFiles).mockImplementation(async () => {
    uploaded = true;
  });
  vi.mocked(fake.page.click).mockImplementation(async () => {
    saved = uploaded;
  });
  return {
    ...s,
    fake,
    account,
    switchActor: () => {
      correctActor = false;
    },
  };
}
async function facebookProfileFixture(
  options: { accountType?: "page" | "member"; connection?: "browser" | "api" } = {},
) {
  let selected = "61595536696896";
  const fake = fakeBrowser({
    cookies: () => [
      { name: "c_user", value: "42" },
      { name: "xs", value: "synthetic" },
      { name: "i_user", value: selected },
    ],
  });
  const s = await fixture(fake.launcher);
  const account = (await s.social.call(owner, "accounts.create", {
    platform: "facebook",
    name: "Bycoda",
    accountType: options.accountType ?? "page",
    projectIds: [s.project.id],
  })) as SocialAccount;
  await s.social.connectAccount(
    account.id,
    {
      platformId: selected,
      name: "Bycoda",
      scopes: [],
      accessApproved: true,
      connection: options.connection ?? "browser",
    },
    { accessToken: "browser-session" },
  );
  let saved = false;
  vi.mocked(fake.page.evaluate).mockImplementation(async <T>(expression: string): Promise<T> => {
    if (expression.includes("const instagram ="))
      return { origin: "https://www.facebook.com", path: "/profile.php", authenticated: true } as T;
    if (expression.includes("const raw=images[0]"))
      return `https://scontent.example.fbcdn.net/v/t39.30808-1/${saved ? "444_555_666" : "111_222_333"}_n.jpg` as T;
    if (expression.includes("const paths=images.map"))
      return "/v/t39.30808-6/444_555_666_n.jpg" as T;
    return true as T;
  });
  vi.mocked(fake.page.click).mockImplementation(async () => {
    if (vi.mocked(fake.page.click).mock.calls.length === 3) saved = true;
  });
  return {
    ...s,
    fake,
    account,
    switchActor: () => {
      selected = "99";
    },
  };
}
async function instagramProfileFixture(
  options: {
    accountType?: "member" | "professional";
    connection?: "browser" | "api";
    synced?: boolean;
  } = {},
) {
  let selected = "123456";
  const fake = fakeBrowser({
    cookies: () => [
      { name: "ds_user_id", value: selected },
      { name: "sessionid", value: "synthetic" },
    ],
  });
  const s = await fixture(fake.launcher);
  const account = (await s.social.call(owner, "accounts.create", {
    platform: "instagram",
    name: "Bycoda",
    accountType: options.accountType ?? "member",
    projectIds: [s.project.id],
  })) as SocialAccount;
  await s.social.connectAccount(
    account.id,
    {
      platformId: selected,
      name: "Bycoda",
      scopes: [],
      accessApproved: true,
      connection: options.connection ?? "browser",
    },
    { accessToken: "browser-session" },
  );
  let bio = "Old bio",
    uploaded = false;
  vi.mocked(fake.page.evaluate).mockImplementation(async <T>(expression: string): Promise<T> => {
    if (expression.includes("const instagram ="))
      return {
        origin: "https://www.instagram.com",
        path: "/accounts/edit/",
        authenticated: true,
      } as T;
    if (expression.includes("return bio.value;")) return bio as T;
    if (expression.includes("const url=new URL(images[0]"))
      return `https://instagram.example.fbcdn.net/v/t51.2885-19/${uploaded ? "new" : "old"}_n.jpg` as T;
    if (expression.includes("Synced profile photo"))
      return (options.synced ? "synced" : "ready") as T;
    return true as T;
  });
  vi.mocked(fake.page.fill).mockImplementation(async (_selector, value) => {
    bio = value;
  });
  vi.mocked(fake.page.setFiles).mockImplementation(async () => {
    uploaded = true;
  });
  return {
    ...s,
    fake,
    account,
    switchActor: () => {
      selected = "99";
    },
  };
}

describe("Instagram profile Host routing", () => {
  it("requires the owner and Instagram-specific approval before launching", async () => {
    const s = await instagramProfileFixture();
    await expect(
      s.browser.profileAction(
        s.social,
        {
          kind: "session",
          actorId: "agent",
          provider: "codex",
          sessionId: "untrusted",
          projectId: s.project.id,
        },
        s.account.id,
        "read",
        {},
      ),
    ).rejects.toThrow("owner");
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { bio: "New" },
        confirm: "UPDATE_FACEBOOK_PROFILE",
      }),
    ).rejects.toThrow("confirmation");
    expect(s.fake.launcher).not.toHaveBeenCalled();
  });
  it.each(["member", "professional"] as const)(
    "reads a connected %s through its separate browser profile",
    async (accountType) => {
      const s = await instagramProfileFixture({ accountType });
      await expect(
        s.browser.profileAction(s.social, owner, s.account.id, "read", {}),
      ).resolves.toMatchObject({ bio: "Old bio" });
      expect(s.fake.launcher.mock.calls[0][0]).toMatch(
        new RegExp(`[\\\\/]browser-profiles[\\\\/]${s.account.id}$`),
      );
      expect(s.fake.page.setFiles).not.toHaveBeenCalled();
      expect(s.fake.page.fill).not.toHaveBeenCalled();
    },
  );
  it("rejects an API connection, X follow and unobserved desktop fields", async () => {
    const s = await instagramProfileFixture();
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "follow", {
        handle: "bycoda",
        confirm: "FOLLOW_X_ACCOUNT",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { website: "https://example.com" },
        confirm: "UPDATE_INSTAGRAM_PROFILE",
      }),
    ).rejects.toThrow("Unsupported Instagram profile field");
    expect(s.fake.launcher).not.toHaveBeenCalled();
    const api = await instagramProfileFixture({ connection: "api" });
    await expect(
      api.browser.profileAction(api.social, owner, api.account.id, "read", {}),
    ).rejects.toMatchObject({ code: "denied" });
    expect(api.fake.launcher).not.toHaveBeenCalled();
  });
  it("stages only owner image bytes and removes them after one verified photo update", async () => {
    const s = await instagramProfileFixture();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    );
    const { uploadId } = await s.social.uploadImage(owner, png.toString("base64"));
    const upload = vi.mocked(s.fake.page.setFiles).getMockImplementation()!;
    let staged = "";
    vi.mocked(s.fake.page.setFiles).mockImplementation(async (selector, files) => {
      staged = files[0];
      expect(readFileSync(staged)).toEqual(png);
      await upload(selector, files);
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: uploadId },
        confirm: "UPDATE_INSTAGRAM_PROFILE",
      }),
    ).resolves.toMatchObject({ avatarUrl: expect.stringContaining("/new_n.jpg") });
    expect(s.fake.page.setFiles).toHaveBeenCalledTimes(1);
    expect(staged).toBeTruthy();
    expect(existsSync(staged)).toBe(false);
    expect(s.fake.calls.at(-1)).toBe("close");
  });
  it("rejects cross-account sync before either text edit or file upload", async () => {
    const s = await instagramProfileFixture({ synced: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    );
    const { uploadId } = await s.social.uploadImage(owner, png.toString("base64"));
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: uploadId, bio: "Must not apply" },
        confirm: "UPDATE_INSTAGRAM_PROFILE",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(s.fake.page.fill).not.toHaveBeenCalled();
    expect(s.fake.page.setFiles).not.toHaveBeenCalled();
  });
  it("rechecks the browser's numeric actor after editing and before Submit", async () => {
    const s = await instagramProfileFixture();
    const fill = vi.mocked(s.fake.page.fill).getMockImplementation()!;
    vi.mocked(s.fake.page.fill).mockImplementation(async (...args) => {
      await fill(...args);
      s.switchActor();
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { bio: "New" },
        confirm: "UPDATE_INSTAGRAM_PROFILE",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(s.fake.page.click).not.toHaveBeenCalled();
    expect(s.fake.calls.at(-1)).toBe("close");
  });
});

describe("Facebook Page logo Host routing", () => {
  it("requires owner authority and the Facebook-specific confirmation", async () => {
    const s = await facebookProfileFixture();
    await expect(
      s.browser.profileAction(
        s.social,
        {
          kind: "session",
          actorId: "agent",
          provider: "codex",
          sessionId: "untrusted",
          projectId: s.project.id,
        },
        s.account.id,
        "read",
        {},
      ),
    ).rejects.toThrow("owner");
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: "11111111-1111-4111-8111-111111111111" },
        confirm: "UPDATE_X_PROFILE",
      }),
    ).rejects.toThrow("confirmation");
    expect(s.fake.launcher).not.toHaveBeenCalled();
  });
  it.each([{ accountType: "member" as const }, { connection: "api" as const }])(
    "rejects unsupported identities/connections: %j",
    async (options) => {
      const s = await facebookProfileFixture(options);
      await expect(
        s.browser.profileAction(s.social, owner, s.account.id, "read", {}),
      ).rejects.toMatchObject({ code: "denied" });
      expect(s.fake.launcher).not.toHaveBeenCalled();
    },
  );
  it("rejects following and unverified profile fields", async () => {
    const s = await facebookProfileFixture();
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "follow", {
        handle: "github",
        confirm: "FOLLOW_X_ACCOUNT",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { name: "Different" },
        confirm: "UPDATE_FACEBOOK_PROFILE",
      }),
    ).rejects.toThrow("logo");
    expect(s.fake.launcher).not.toHaveBeenCalled();
  });
  it("stages exact owner logo bytes in the separate Page profile and cleans them after one Save", async () => {
    const s = await facebookProfileFixture();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    );
    const { uploadId } = await s.social.uploadImage(owner, png.toString("base64"));
    let staged = "";
    vi.mocked(s.fake.page.setFiles).mockImplementation(async (selector, files) => {
      expect(selector).toBe('[data-bycoda-fb-profile-file="true"]');
      staged = files[0];
      expect(readFileSync(staged)).toEqual(png);
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: uploadId },
        confirm: "UPDATE_FACEBOOK_PROFILE",
      }),
    ).resolves.toMatchObject({ avatarUrl: expect.stringContaining("444_555_666") });
    expect(s.fake.launcher.mock.calls[0][0]).toMatch(
      new RegExp(`[\\\\/]browser-profiles[\\\\/]${s.account.id}$`),
    );
    expect(s.fake.page.click).toHaveBeenCalledTimes(3);
    expect(staged).toBeTruthy();
    expect(existsSync(staged)).toBe(false);
    expect(s.fake.calls.at(-1)).toBe("close");
  });
  it("rechecks the selected Facebook actor after upload, before Save", async () => {
    const s = await facebookProfileFixture();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zll1sAAAAASUVORK5CYII=",
      "base64",
    );
    const { uploadId } = await s.social.uploadImage(owner, png.toString("base64"));
    vi.mocked(s.fake.page.setFiles).mockImplementation(async () => s.switchActor());
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: uploadId },
        confirm: "UPDATE_FACEBOOK_PROFILE",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(s.fake.page.click).toHaveBeenCalledTimes(2);
    expect(s.fake.calls.at(-1)).toBe("close");
  });
});

describe("LinkedIn Page profile Host routing", () => {
  it("requires owner authority and the LinkedIn-specific confirmation", async () => {
    const s = await linkedInProfileFixture();
    await expect(
      s.browser.profileAction(
        s.social,
        {
          kind: "session",
          actorId: "agent",
          provider: "codex",
          sessionId: "untrusted",
          projectId: s.project.id,
        },
        s.account.id,
        "update",
        { patch: { bio: "New" }, confirm: "UPDATE_LINKEDIN_PROFILE" },
      ),
    ).rejects.toThrow("owner");
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { bio: "New" },
        confirm: "UPDATE_X_PROFILE",
      }),
    ).rejects.toThrow("confirmation");
    expect(s.fake.launcher).not.toHaveBeenCalled();
  });
  it.each([{ accountType: "member" as const }, { connection: "api" as const }])(
    "rejects unsupported account identities/connections: %j",
    async (options) => {
      const s = await linkedInProfileFixture(options);
      await expect(
        s.browser.profileAction(s.social, owner, s.account.id, "read", {}),
      ).rejects.toMatchObject({ code: "denied" });
      expect(s.fake.launcher).not.toHaveBeenCalled();
    },
  );
  it("does not expose X follow on a LinkedIn Page", async () => {
    const s = await linkedInProfileFixture();
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "follow", {
        handle: "github",
        confirm: "FOLLOW_X_ACCOUNT",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(s.fake.launcher).not.toHaveBeenCalled();
  });
  it("routes owner image bytes into the Page's separate browser profile and removes staging after save", async () => {
    const s = await linkedInProfileFixture();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
      "base64",
    );
    const { uploadId } = await s.social.uploadImage(owner, png.toString("base64"));
    let staged = "";
    vi.mocked(s.fake.page.setFiles).mockImplementation(async (selector, files) => {
      expect(selector).toBe("#organization-logo-field");
      staged = files[0];
      expect(readFileSync(staged)).toEqual(png);
    });
    // The fake only models route dispatch; DOM persistence and receipt cases have their own driver tests.
    vi.mocked(s.fake.page.click).mockImplementation(async () => undefined);
    let logoReads = 0;
    vi.mocked(s.fake.page.evaluate).mockImplementation(
      async <T>(expression: string): Promise<T> => {
        if (expression.includes("const container=logo.closest"))
          return `https://media.licdn.com/dms/image/v2/${logoReads++ ? "new" : "old"}/company-logo_100_100/bycoda_logo` as T;
        if (expression.includes("return {name:name.value"))
          return { name: "Bycoda", bio: "Old", location: "", website: "" } as T;
        return true as T;
      },
    );
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { avatarUploadId: uploadId },
        confirm: "UPDATE_LINKEDIN_PROFILE",
      }),
    ).resolves.toMatchObject({ avatarUrl: expect.stringContaining("/new/") });
    expect(s.fake.launcher.mock.calls[0][0]).toMatch(
      new RegExp(`[\\\\/]browser-profiles[\\\\/]${s.account.id}$`),
    );
    expect(s.fake.page.click).toHaveBeenCalledExactlyOnceWith(
      "#org-page-edit-modal-banner__save-button",
    );
    expect(staged).toBeTruthy();
    expect(existsSync(staged)).toBe(false);
    expect(s.fake.calls.at(-1)).toBe("close");
  });
  it("holds a changed Page actor before final Save", async () => {
    const s = await linkedInProfileFixture();
    vi.mocked(s.fake.page.fill).mockImplementation(async () => {
      s.switchActor();
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { bio: "New" },
        confirm: "UPDATE_LINKEDIN_PROFILE",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(s.fake.page.click).not.toHaveBeenCalled();
    expect(s.fake.calls.at(-1)).toBe("close");
  });
  it("rechecks the connected Host actor after the form is edited", async () => {
    const s = await linkedInProfileFixture();
    const current = s.social.accountForBrowserManagement.bind(s.social);
    let switched = false;
    vi.spyOn(s.social, "accountForBrowserManagement").mockImplementation(async (...args) => {
      const account = await current(...args);
      return switched ? { ...account, platformId: "web:linkedin:company:99" } : account;
    });
    vi.mocked(s.fake.page.fill).mockImplementation(async () => {
      switched = true;
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", {
        patch: { bio: "New" },
        confirm: "UPDATE_LINKEDIN_PROFILE",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(s.fake.page.click).not.toHaveBeenCalled();
  });
  it("preserves the existing X profile directory and driver", async () => {
    const fake = fakeBrowser({});
    const s = await fixture(fake.launcher);
    await s.social.connectAccount(
      s.account.id,
      {
        platformId: "42",
        name: "owner",
        scopes: X_BROWSER_SCOPES,
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
    );
    const original = vi.mocked(fake.page.evaluate).getMockImplementation()!;
    vi.mocked(fake.page.evaluate).mockImplementation(async <T>(expression: string): Promise<T> =>
      expression.includes("const read = name")
        ? ({ name: "owner", bio: "", location: "", website: "" } as T)
        : (original(expression) as Promise<T>),
    );
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "read", {}),
    ).resolves.toMatchObject({ name: "owner" });
    expect(fake.launcher.mock.calls[0][0]).toMatch(
      new RegExp(`[\\\\/]x-browser[\\\\/]${s.account.id}$`),
    );
    expect(fake.page.goto).toHaveBeenCalledWith("https://x.com/settings/profile");
  });
});
describe("X tarayıcı oturumu", () => {
  it("keeps profile mutations owner-only, explicitly confirmed and on the executor", async () => {
    const fake = fakeBrowser({});
    const s = await fixture(fake.launcher);
    await s.social.connectAccount(
      s.account.id,
      {
        platformId: "42",
        name: "owner",
        scopes: X_BROWSER_SCOPES,
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
    );
    await expect(
      s.browser.profileAction(
        s.social,
        {
          kind: "session",
          actorId: "agent",
          provider: "codex",
          sessionId: "untrusted",
          projectId: s.project.id,
        },
        s.account.id,
        "follow",
        { handle: "github", confirm: "FOLLOW_X_ACCOUNT" },
      ),
    ).rejects.toThrow("owner");
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "update", { patch: { bio: "New" } }),
    ).rejects.toThrow("confirmation");
    await s.social.call(owner, "accounts.executor", {
      accountId: s.account.id,
      executorId: "other-host",
    });
    await expect(
      s.browser.profileAction(s.social, owner, s.account.id, "follow", {
        handle: "github",
        confirm: "FOLLOW_X_ACCOUNT",
      }),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fake.launcher).not.toHaveBeenCalled();
  });
  it("logs in through a plain window and verifies the session after it closes", async () => {
    let cookies: {
      name: string;
      value: string;
    }[] = [];
    const fake = fakeBrowser({ cookies: () => cookies });
    const s = await fixture(fake.launcher, undefined, fake.plain);
    await expect(
      (async () => await s.browser.begin(s.social, owner, s.account.id, undefined))(),
    ).rejects.toThrow("unofficial");
    expect((await s.browser.begin(s.social, owner, s.account.id, true)).status).toBe("waiting");
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    // No debugger-controlled browser while the owner logs in (Google blocks those).
    expect(fake.launcher).not.toHaveBeenCalled();
    expect((await s.browser.status(s.social, owner, s.account.id)).status).toBe("waiting");
    cookies = loggedIn("42");
    fake.closeWindow();
    await settle(
      async () => (await s.browser.status(s.social, owner, s.account.id)).status !== "waiting",
    );
    expect(await s.browser.status(s.social, owner, s.account.id)).toEqual({
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
      poll: "available",
      "inbox.read": "available",
      "message.start": "available",
    });
  });
  it("fails when the window closes without an X login and removes the profile on disconnect", async () => {
    const fake = fakeBrowser({ cookies: () => [] });
    const s = await fixture(fake.launcher, undefined, fake.plain);
    await s.browser.begin(s.social, owner, s.account.id, true);
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    fake.closeWindow();
    await settle(
      async () => (await s.browser.status(s.social, owner, s.account.id)).status === "failed",
    );
    expect((await s.browser.status(s.social, owner, s.account.id)).error).toContain(
      "not completed",
    );
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
    await s.browser.begin(s.social, owner, s.account.id, true);
    await settle(() => fake.calls.includes("plain https://x.com/login"));
    await s.browser.forget(s.account.id);
    expect(fake.calls).toContain("window closed");
    expect(fake.launcher).not.toHaveBeenCalled();
    expect((await s.browser.status(s.social, owner, s.account.id)).status).toBe("idle");
    await s.social.call(owner, "accounts.executor", {
      accountId: s.account.id,
      executorId: "other-host",
    });
    await expect(
      (async () => await s.browser.begin(s.social, owner, s.account.id, true))(),
    ).rejects.toThrow("executor host");
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
      async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
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
  it("stages an MP4 for a post reply, waits for video attachment readiness and cleans staging", async () => {
    const fake = fakeBrowser({ response: created });
    const s = await fixture(fake.launcher);
    let staged = "";
    fake.page.setFiles = vi.fn(async (_selector, paths) => {
      staged = paths[0];
      expect(staged.endsWith(".mp4")).toBe(true);
      expect(readFileSync(staged).subarray(4, 8).toString()).toBe("ftyp");
    });
    await s.browser.adapter().send(
      { ...s.account, platformId: "42" },
      {
        ...job({ postId: "123", media: [{ kind: "video", uploadId: "local" }] }),
        kind: "reply",
      },
      "browser-session",
      async () => new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]),
    );
    expect(fake.page.evaluate).toHaveBeenCalledWith(
      expect.stringContaining('[role="progressbar"]'),
    );
    expect(existsSync(staged)).toBe(false);
    expect(fake.calls).toContain('click [data-testid="tweetButtonInline"]');
  });
  it("replies inline on the target post and refuses DMs without recipient and write scope", async () => {
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
    let now = 1000000;
    const fake = fakeBrowser({ response: undefined });
    const s = await fixture(fake.launcher, () => now);
    const account = { ...s.account, platformId: "42" };
    const send = () => s.browser.adapter().send(account, job(), "", async () => new Uint8Array());
    await expect(send()).rejects.toMatchObject({ code: "unknown" });
    now += 1000;
    await expect(send()).rejects.toMatchObject({
      code: "rate_limit",
      retryAt: 1030000,
    });
  });
});
describe("X browser background monitoring and messaging", () => {
  it("rotates owned post comment reads and deduplicates mentions from the same poll", async () => {
    const fake = fakeBrowser({});
    const s = await fixture(fake.launcher);
    const body = JSON.stringify({
      global_objects: {
        tweets: {
          inbound: {
            id_str: "800",
            user_id_str: "7",
            full_text: "Reply",
            in_reply_to_status_id_str: "101",
            in_reply_to_user_id_str: "42",
            created_at: new Date(999000).toUTCString(),
          },
        },
      },
    });
    fake.page.watchResponse = (path) => ({
      body: async () => (path.test("/TweetDetail") ? body : undefined),
      stop: () => undefined,
    });
    const result = await s.browser
      .adapter()
      .poll({ ...s.account, platformId: "42", scopes: ["tweet.read"] }, "", ["101", "102", "103"]);
    expect(result.events.map((event) => event.eventId)).toEqual(["800"]);
    expect(result.coverage).toContainEqual({ channel: "comments", status: "read" });
    expect(result.cursor).toBe("2");
    expect(fake.calls).toContain("goto https://x.com/i/status/101");
    expect(fake.calls).toContain("goto https://x.com/i/status/102");
    expect(fake.calls).not.toContain("goto https://x.com/i/status/103");
  });
  it("accepts a confirmed empty mentions page while reporting required Chat setup", async () => {
    const fake = fakeBrowser({ emptyMentions: true, path: "/i/chat/pin/new" });
    const s = await fixture(fake.launcher);
    const body = vi.fn(async () => undefined);
    fake.page.watchResponse = () => ({ body, stop: () => undefined });
    await expect(
      s.browser
        .adapter()
        .poll({ ...s.account, platformId: "42", scopes: X_BROWSER_SCOPES }, "", []),
    ).resolves.toEqual({
      events: [],
      coverage: [
        { channel: "mentions", status: "read" },
        { channel: "messages", status: "unavailable", reason: "chat_setup_required" },
      ],
    });
    expect(body).toHaveBeenCalledTimes(1);
  });
  it("never treats an unknown empty-looking layout as a successful read", async () => {
    const fake = fakeBrowser({ path: "/i/chat" });
    const s = await fixture(fake.launcher);
    await expect(
      s.browser
        .adapter()
        .poll({ ...s.account, platformId: "42", scopes: X_BROWSER_SCOPES }, "", []),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
  const now = Date.parse("2026-10-19T00:00:00Z");
  const mentions = JSON.stringify({
    global_objects: {
      tweets: {
        inbound: {
          id_str: "800",
          user_id_str: "7",
          full_text: "@owner what is bycoda?",
          created_at: new Date(now - 1000).toUTCString(),
          entities: { user_mentions: [{ id_str: "42" }] },
        },
      },
    },
  });
  const inbox = JSON.stringify({
    inbox_initial_state: {
      entries: [
        {
          message: {
            conversation_id: "7-42",
            time: String(now - 1000),
            message_data: { id: "900", sender_id: "7", recipient_id: "42", text: "hello" },
          },
        },
      ],
    },
  });
  it("polls an authenticated browser account through the host scheduler, ingests once and reports partial channels", async () => {
    let clock = now;
    const fake = fakeBrowser({ responses: { mentions, inbox } });
    const s = await fixture(fake.launcher, () => clock);
    await s.social.connectAccount(
      s.account.id,
      {
        platformId: "42",
        name: "owner",
        scopes: X_BROWSER_SCOPES,
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
    );
    await s.social.call(owner, "inbox.polling", { enabled: true });
    await s.social.tick();
    expect(fake.calls).toContain("goto https://x.com/notifications/mentions");
    expect(fake.calls).toContain("goto https://x.com/messages");
    expect(await s.social.monitoringStatus(owner, s.account.id)).toMatchObject({
      status: "healthy",
      coverage: [
        { channel: "mentions", status: "read" },
        { channel: "messages", status: "read" },
      ],
    });
    const snapshot = (await s.social.call(owner, "snapshot", {})) as {
      threads: unknown[];
    };
    expect(snapshot.threads).toHaveLength(2);
    clock += 61000;
    expect(await s.social.pollAccount(s.account.id)).toEqual({ ingested: 0 });
    fake.page.watchResponse = (path) => ({
      body: async () => (path.test("/NotificationsTimeline") ? mentions : '{"encrypted":true}'),
      stop: () => undefined,
    });
    clock += 61000;
    await s.social.pollAccount(s.account.id);
    expect(await s.social.monitoringStatus(owner, s.account.id)).toMatchObject({
      status: "partial",
      coverage: [
        { channel: "mentions", status: "read" },
        { channel: "messages", status: "unavailable" },
      ],
    });
  });
  it("runs an owner-activated automatic reply from a browser mention through the existing queue exactly once", async () => {
    let clock = now;
    const responses = {
      mentions: '{"global_objects":{"tweets":{}}}',
      inbox: '{"inbox_initial_state":{"entries":[]}}',
    };
    const fake = fakeBrowser({ responses, response: created });
    const s = await fixture(fake.launcher, () => clock);
    await s.social.connectAccount(
      s.account.id,
      {
        platformId: "42",
        name: "owner",
        scopes: X_BROWSER_SCOPES,
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
    );
    await s.social.call(owner, "accounts.grants", {
      accountId: s.account.id,
      projectId: s.project.id,
      permissions: ["read", "draft", "reply"],
    });
    await s.social.call(owner, "profiles.save", {
      projectId: s.project.id,
      productName: "bycoda",
      brandVoice: "Helpful",
      facts: [
        {
          id: "fact",
          topic: "product",
          text: "bycoda helps develop software.",
          source: "Public product description",
        },
      ],
    });
    const rule = (await s.social.call(owner, "automations.create", {
      accountId: s.account.id,
      projectId: s.project.id,
      name: "Product help",
      mode: "automatic",
      trigger: "comment",
      topics: ["product"],
      dailyLimit: 1,
      answers: [{ keyword: "what is bycoda", factId: "fact" }],
    })) as {
      id: string;
    };
    await s.social.call(owner, "automations.activate", {
      id: rule.id,
      confirm: "ENABLE_AUTOMATIC_REPLIES",
    });
    await s.social.call(owner, "execution.enable", { confirm: "ENABLE_EXTERNAL_SENDS" });
    await s.social.call(owner, "inbox.polling", { enabled: true });
    clock += 2000;
    responses.mentions = JSON.stringify({
      global_objects: {
        tweets: {
          incoming: {
            id_str: "800",
            user_id_str: "7",
            full_text: "What is bycoda?",
            created_at: new Date(clock).toUTCString(),
            entities: { user_mentions: [{ id_str: "42" }] },
          },
        },
      },
    });
    await s.social.tick();
    // Inbound polling runs independently of dispatch; its authorized reply is
    // queued for the next dispatch tick rather than delaying existing jobs.
    expect((await s.social.snapshot(owner)).jobs).toMatchObject([
      { kind: "reply", status: "queued" },
    ]);
    await s.social.tick();
    const snapshot = await s.social.snapshot(owner);
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0]).toMatchObject({
      kind: "reply",
      status: "succeeded",
      platformId: "777",
    });
    expect(fake.calls).toContain("text bycoda helps develop software.");
    clock += 61000;
    await s.social.tick();
    expect((await s.social.snapshot(owner)).jobs).toHaveLength(1);
  });
  it("does not read another account's profile", async () => {
    const fake = fakeBrowser({ cookies: () => loggedIn("99"), responses: { mentions, inbox } });
    const s = await fixture(fake.launcher, () => now);
    await expect(
      s.browser
        .adapter()
        .poll({ ...s.account, platformId: "42", scopes: X_BROWSER_SCOPES }, "", []),
    ).rejects.toMatchObject({ code: "denied" });
    expect(fake.calls.some((call) => call.startsWith("goto"))).toBe(false);
  });
  it("sends a DM only to verified numeric conversation participants and confirms the returned message ID", async () => {
    const response = JSON.stringify({
      event: {
        id: "777",
        message_create: {
          sender_id: "42",
          target: { recipient_id: "7" },
          message_data: { text: "Hello" },
        },
      },
    });
    const fake = fakeBrowser({ response });
    const s = await fixture(fake.launcher, () => now);
    const result = await s.browser
      .adapter()
      .send(
        { ...s.account, platformId: "42", scopes: X_BROWSER_SCOPES },
        { ...job({ recipientId: "7" }), kind: "message" },
        "",
        async () => new Uint8Array(),
      );
    expect(result).toEqual({ platformId: "777" });
    expect(fake.calls).toContain('click [data-testid="dmComposerSendButton"]');
    const other = fakeBrowser({ path: "/messages/42-8", response });
    const t = await fixture(other.launcher, () => now);
    await expect(
      t.browser
        .adapter()
        .send(
          { ...t.account, platformId: "42", scopes: X_BROWSER_SCOPES },
          { ...job({ recipientId: "7" }), kind: "message" },
          "",
          async () => new Uint8Array(),
        ),
    ).rejects.toMatchObject({ code: "denied" });
    expect(other.calls).not.toContain('click [data-testid="dmComposerSendButton"]');
  });
  it("treats missing DM acknowledgement as uncertain instead of successful", async () => {
    const fake = fakeBrowser({ response: undefined });
    const s = await fixture(fake.launcher, () => now);
    await expect(
      s.browser
        .adapter()
        .send(
          { ...s.account, platformId: "42", scopes: X_BROWSER_SCOPES },
          { ...job({ recipientId: "7" }), kind: "message" },
          "",
          async () => new Uint8Array(),
        ),
    ).rejects.toMatchObject({ code: "unknown" });
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
