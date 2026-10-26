import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { SocialService } from "./social";
import { SocialTransport } from "./social-transport";
import { SocialBrowserWorkflows } from "./social-browser-workflows";
import {
  XBrowserSessions,
  type PlainBrowserLauncher,
  type BrowserLauncher,
  type BrowserPage,
} from "./social-browser";
import { Window } from "happy-dom";
import {
  SOCIAL_ACCOUNT_TYPES,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../src/features/social/model/social";
import {
  socialBrowserUrl,
  type SocialBrowserWorkflow,
} from "../src/features/social/model/socialBrowser";
import type { SocialAdapters } from "../src/integrations/social/adapter";
const owner = { kind: "owner", actorId: "owner", provider: "owner" } as const;
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanups.splice(0).reverse()) await action();
});
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 500 && !(await check()); i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(await check()).toBe(true);
}
async function fixture(
  platform: SocialPlatform = "x",
  automated?: BrowserLauncher,
  waitForLock?: Promise<void>,
  accountType?: SocialAccount["accountType"],
) {
  const directory = mkdtempSync(join(tmpdir(), "social-workflows-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Fixture");
  const service = new SocialService(
    store,
    { get: async () => undefined, set: async () => undefined, delete: async () => undefined },
    {} as SocialAdapters,
    directory,
  );
  const account = (await service.call(owner, "accounts.create", {
    platform,
    name: "Fixture",
    accountType: accountType ?? SOCIAL_ACCOUNT_TYPES[platform][0],
    projectIds: [project.id],
  })) as SocialAccount;
  let now = 1000;
  const windows: {
    close: ReturnType<typeof vi.fn>;
    closed: Promise<void>;
  }[] = [];
  const plain = vi.fn<PlainBrowserLauncher>(async () => {
    let resolve!: () => void;
    const closed = new Promise<void>((done) => {
      resolve = done;
    });
    const window = { closed, close: vi.fn(async () => resolve()) };
    windows.push(window);
    return window;
  });
  let locks = 0;
  const manager = new SocialBrowserWorkflows(
    plain,
    (a) => join(directory, a.id),
    async (_id, action) => {
      locks++;
      await waitForLock;
      return action();
    },
    () => now,
    async () => new Promise((resolve) => setTimeout(resolve, 1)),
    automated,
  );
  cleanups.push(async () => {
    await manager.stop(service);
    await service.dispose();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const status = async () => await manager.status(service, owner, account.id);
  const begin = async (intent: "login" | "signup" | "inbox" = "login") =>
    await manager.begin(service, owner, { accountId: account.id, intent, acknowledgeRisk: true });
  return {
    directory,
    store,
    service,
    account,
    manager,
    plain,
    windows,
    status,
    begin,
    advance: () => {
      now += 21 * 60000;
    },
    get locks() {
      return locks;
    },
  };
}
const registrationProfile = {
  email: "automation-owner@example.invalid",
  givenName: "FixtureGiven",
  familyName: "FixtureFamily",
  accountKind: "person" as const,
};
async function registrationFixture(waitForLock?: Promise<void>) {
  const window = new Window({ url: "https://www.linkedin.com/signup" });
  window.document.body.innerHTML = `<form class="join-form" action="/signup/api/cors/createAccount" method="post">
    <input id="email-address" name="email-address" type="email">
    <input id="password" name="password" type="password" autocomplete="new-password">
    <input id="first-name" name="first-name" type="text">
    <input id="last-name" name="last-name" type="text">
    <button id="join-form-submit" type="submit">Agree &amp; Join</button>
  </form>`;
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.hidden ? [] : [{ width: 100, height: 30 }];
    },
  });
  const hooks: { beforeFill?: () => Promise<void>; afterEvaluate?: (expression: string) => void } =
    {};
  const fill = vi.fn(async (selector: string, text: string) => {
    await hooks.beforeFill?.();
    const input = window.document.querySelector(selector);
    if (!input || input.tagName !== "INPUT") throw new Error("The fixture field changed.");
    (input as unknown as { value: string }).value = text;
  });
  const page: BrowserPage = {
    goto: vi.fn(async (url) => {
      window.happyDOM.setURL(url);
    }),
    evaluate: vi.fn(async <T>(expression: string): Promise<T> => {
      const value = window.eval(expression) as T;
      hooks.afterEvaluate?.(expression);
      return value;
    }),
    fill,
    click: vi.fn(async () => {
      throw new Error("No registration submit is authorized in this fixture.");
    }),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    cookies: vi.fn(async () => []),
    watchResponse: vi.fn(() => ({ body: async () => undefined, stop() {} })),
  };
  let closed!: () => void;
  const session = {
    page,
    closed: new Promise<void>((resolve) => {
      closed = resolve;
    }),
    close: vi.fn(async () => {
      closed();
    }),
  };
  const automated = vi.fn<BrowserLauncher>(async () => session);
  const f = await fixture("linkedin", automated, waitForLock);
  cleanups.push(async () => {
    await window.happyDOM.abort();
  });
  const begin = (profile: unknown = registrationProfile) =>
    f.manager.begin(f.service, owner, {
      accountId: f.account.id,
      intent: "signup",
      acknowledgeRisk: true,
      registration: profile,
    });
  const ready = async () => {
    await until(async () => !!(await f.status()).workflows[0]?.registration);
    return (await f.status()).workflows[0];
  };
  return { f, window, hooks, page, fill, session, automated, begin, ready };
}

describe("owner registration preparation lifecycle", () => {
  it("prepares only supplied nonsecret fields in one headed isolated profile and records no values", async () => {
    const s = await registrationFixture();
    await s.begin();
    const flow = await s.ready();
    expect(s.automated).toHaveBeenCalledExactlyOnceWith(join(s.f.directory, s.f.account.id), false);
    expect(s.f.plain).not.toHaveBeenCalled();
    expect(s.fill.mock.calls.map(([, value]) => value)).toEqual([
      registrationProfile.email,
      registrationProfile.givenName,
      registrationProfile.familyName,
    ]);
    expect(s.page.click).not.toHaveBeenCalled();
    expect(flow).toMatchObject({
      status: "awaiting_owner",
      outcome: "unverified",
      registration: {
        blockers: ["password", "terms"],
        canAdvance: false,
        filledFields: ["email", "givenName", "familyName"],
      },
    });
    expect((await s.begin()).id).toBe(flow.id);
    expect(s.automated).toHaveBeenCalledOnce();
    const persisted = JSON.stringify(
      await s.f.store.db
        .prepare("SELECT value FROM social_records WHERE kind='browser-workflow'")
        .all(),
    );
    for (const value of Object.values(registrationProfile)) expect(persisted).not.toContain(value);
    expect(persisted).not.toContain("https://");
    expect(persisted).not.toContain(s.f.directory);
    expect((await s.f.service.accountForOAuth(owner, s.f.account.id)).connected).toBe(false);
  });
  it("requires owner identity, matching workflow and current revision and serializes competing advances without another profile lock", async () => {
    const s = await registrationFixture();
    await s.begin({ email: registrationProfile.email, accountKind: "person" });
    const flow = await s.ready();
    const input = {
      accountId: s.f.account.id,
      workflowId: flow.id,
      expectedUpdatedAt: flow.updatedAt,
      registration: registrationProfile,
    };
    const before = s.fill.mock.calls.length;
    await expect(
      s.f.manager.advanceRegistration(
        s.f.service,
        { kind: "session", actorId: "session", provider: "codex", projectId: "untrusted" },
        input,
      ),
    ).rejects.toThrow("owner device");
    await expect(
      s.f.manager.advanceRegistration(s.f.service, owner, { ...input, workflowId: "different" }),
    ).rejects.toThrow("changed");
    await expect(
      s.f.manager.advanceRegistration(s.f.service, owner, {
        ...input,
        expectedUpdatedAt: flow.updatedAt - 1,
      }),
    ).rejects.toThrow("changed");
    expect(s.fill).toHaveBeenCalledTimes(before);
    const results = await Promise.allSettled([
      s.f.manager.advanceRegistration(s.f.service, owner, input),
      s.f.manager.advanceRegistration(s.f.service, owner, input),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(s.fill.mock.calls.slice(before).map(([, value]) => value)).toEqual([
      registrationProfile.givenName,
      registrationProfile.familyName,
    ]);
    expect(s.f.locks).toBe(1);
    expect((await s.f.status()).workflows[0].updatedAt).toBeGreaterThan(flow.updatedAt);
  });
  it.each(["cancel", "expire", "stop", "pause"] as const)(
    "%s during a field fill prevents every later registration action",
    async (reason) => {
      const s = await registrationFixture();
      let release!: () => void;
      let entered!: () => void;
      const filling = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      s.hooks.beforeFill = async () => {
        entered();
        await held;
      };
      try {
        await s.begin();
        await filling;
        if (reason === "cancel") await s.f.manager.cancel(s.f.service, owner, s.f.account.id);
        else if (reason === "stop") await s.f.manager.stop(s.f.service);
        else if (reason === "pause")
          await s.f.service.call(owner, "accounts.pause", {
            accountId: s.f.account.id,
            paused: true,
          });
        else s.f.advance();
      } finally {
        release();
      }
      await until(() => !s.f.manager.hasActive(s.f.account.id));
      expect(s.fill).toHaveBeenCalledOnce();
      expect(s.page.click).not.toHaveBeenCalled();
      expect((await s.f.status()).workflows[0]).toMatchObject({
        status: reason === "cancel" ? "cancelled" : reason === "expire" ? "expired" : "interrupted",
        outcome: "unverified",
      });
      expect(s.session.close).toHaveBeenCalled();
    },
  );
  it("checks native request authorization again after probing a field and never fills after revocation", async () => {
    const s = await registrationFixture();
    let authorized = true;
    s.hooks.afterEvaluate = (expression) => {
      if (expression.includes("setAttribute('data-bycoda-registration-field'")) authorized = false;
    };
    await s.f.store.db.withAuthorization(
      () => authorized,
      () => s.begin(),
    );
    await until(() => !s.f.manager.hasActive(s.f.account.id));
    expect(s.fill).not.toHaveBeenCalled();
    expect(s.page.click).not.toHaveBeenCalled();
    expect(s.session.close).toHaveBeenCalled();
    expect((await s.f.status()).workflows[0].outcome).toBe("unverified");
  });
  it("does not resume an automated registration or retain profile values after a restart", async () => {
    const s = await registrationFixture();
    await s.begin();
    await s.ready();
    const restarted = new SocialBrowserWorkflows(
      s.f.plain,
      () => "unused",
      async (_id, action) => action(),
      Date.now,
      undefined,
      s.automated,
    );
    const state = await restarted.status(s.f.service, owner, s.f.account.id);
    expect(state.workflows[0].status).toBe("interrupted");
    await expect(
      restarted.advanceRegistration(s.f.service, owner, {
        accountId: s.f.account.id,
        workflowId: state.workflows[0].id,
        expectedUpdatedAt: state.workflows[0].updatedAt,
        registration: registrationProfile,
      }),
    ).rejects.toThrow("not active");
    expect(s.automated).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).not.toContain(registrationProfile.email);
  });
  it("rechecks executor ownership when a queued signup acquires the profile lock", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = await registrationFixture(held);
    try {
      await s.begin();
      await s.f.service.call(owner, "accounts.executor", {
        accountId: s.f.account.id,
        executorId: "another-host",
      });
    } finally {
      release();
    }
    await until(() => !s.f.manager.hasActive(s.f.account.id));
    expect(s.automated).not.toHaveBeenCalled();
    expect(s.page.goto).not.toHaveBeenCalled();
    expect(s.fill).not.toHaveBeenCalled();
  });
  it("rejects fields on non-signup intents and avoids registering another identity for a connected account", async () => {
    const s = await registrationFixture();
    await expect(
      s.f.manager.begin(s.f.service, owner, {
        accountId: s.f.account.id,
        intent: "login",
        acknowledgeRisk: true,
        registration: registrationProfile,
      }),
    ).rejects.toThrow("signup workflow");
    await s.f.service.connectAccount(
      s.f.account.id,
      { platformId: "existing-owner", name: "Existing", scopes: [], accessApproved: true },
      { accessToken: "synthetic" },
    );
    await expect(s.begin()).rejects.toThrow("already connected");
    expect(s.automated).not.toHaveBeenCalled();
    expect(s.f.plain).not.toHaveBeenCalled();
  });
});

describe("owner-assisted social browser workflows", () => {
  it.each(SOCIAL_PLATFORMS)(
    "opens an isolated %s login without granting send authority",
    async (platform) => {
      const f = await fixture(platform);
      const flow = await f.begin();
      await until(async () => (await f.status()).workflows[0]?.status === "awaiting_owner");
      expect(f.plain).toHaveBeenCalledWith(
        join(f.directory, f.account.id),
        socialBrowserUrl(platform, "login"),
      );
      expect((await f.status()).workflows[0].outcome).toBe("unverified");
      await f.windows[0].close();
      await until(async () => (await f.status()).workflows[0]?.status === "window_closed");
      expect((await f.status()).workflows[0].id).toBe(flow.id);
      expect((await f.service.accountForOAuth(owner, f.account.id)).connected).toBe(false);
    },
  );
  it("does not create duplicate windows and requires cancellation before a different intent", async () => {
    const f = await fixture();
    const first = await f.begin("signup");
    expect((await f.begin("signup")).id).toBe(first.id);
    await expect((async () => await f.begin("inbox"))()).rejects.toThrow("Close or cancel");
    await until(() => f.windows.length === 1);
    await f.manager.cancel(f.service, owner, f.account.id);
    await until(() => !f.manager.hasActive(f.account.id));
    expect((await f.status()).workflows[0].status).toBe("cancelled");
    expect(f.windows[0].close).toHaveBeenCalled();
  });
  it("expires a window without marking registration successful", async () => {
    const f = await fixture();
    await f.begin("signup");
    await until(async () => (await f.status()).workflows[0]?.status === "awaiting_owner");
    await f.advance();
    await until(() => !f.manager.hasActive(f.account.id));
    expect((await f.status()).workflows[0]).toMatchObject({
      status: "expired",
      outcome: "unverified",
    });
    expect(f.windows[0].close).toHaveBeenCalled();
  });
  it("marks persisted work interrupted after host restart, never resumes a registration automatically", async () => {
    const f = await fixture();
    await f.begin("signup");
    const restarted = new SocialBrowserWorkflows(
      f.plain,
      () => "unused",
      async (_id, action) => action(),
    );
    expect((await restarted.status(f.service, owner, f.account.id)).workflows[0].status).toBe(
      "interrupted",
    );
    expect(f.plain).toHaveBeenCalledTimes(1);
  });
  it("denies session credentials, wrong executor hosts and missing acknowledgements", async () => {
    const f = await fixture();
    await expect(
      (async () =>
        await f.manager.status(
          f.service,
          { kind: "session", actorId: "session", provider: "codex", projectId: "other" },
          f.account.id,
        ))(),
    ).rejects.toThrow("owner device");
    await expect(
      (async () =>
        await f.manager.begin(f.service, owner, { accountId: f.account.id, intent: "login" }))(),
    ).rejects.toThrow("Acknowledge");
    await f.service.call(owner, "accounts.executor", {
      accountId: f.account.id,
      executorId: "another-host",
    });
    await expect((async () => await f.begin())()).rejects.toThrow("executor host");
    expect(f.plain).not.toHaveBeenCalled();
  });
  it("does not expose launcher paths, entered data or target URLs through persisted records", async () => {
    const f = await fixture();
    await f.manager.begin(f.service, owner, {
      accountId: f.account.id,
      intent: "comments",
      acknowledgeRisk: true,
      targetUrl: "https://x.com/fixture/status/123?secret=synthetic",
    });
    await until(() => f.plain.mock.calls.length === 1);
    expect(f.plain).toHaveBeenCalledWith(expect.any(String), "https://x.com/fixture/status/123");
    const stored = JSON.stringify(await f.status());
    expect(stored).not.toContain("synthetic");
    expect(stored).not.toContain(f.directory);
    expect(stored).not.toContain("https://x.com");
  });
  it("cancels queued work without opening the browser when a profile becomes free", async () => {
    const f = await fixture();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new SocialBrowserWorkflows(
      f.plain,
      () => "profile",
      async (_id, action) => {
        await held;
        return action();
      },
    );
    await manager.begin(f.service, owner, {
      accountId: f.account.id,
      intent: "login",
      acknowledgeRisk: true,
    });
    await manager.cancel(f.service, owner, f.account.id);
    release();
    await until(() => !manager.hasActive(f.account.id));
    expect(f.plain).not.toHaveBeenCalled();
  });
  it("exposes owner RPC and prevents the X verifier from opening the same profile", async () => {
    const f = await fixture();
    const verifier = vi.fn(async () => {
      throw new Error("The verifier must not open a profile owned by a workflow.");
    });
    const browser = new XBrowserSessions(
      f.directory,
      verifier,
      Date.now,
      // Use the fixture's short polling cadence: production polls at 1s,
      // which exceeds until() on platforms with accurate 1ms timers.
      async () => new Promise((resolve) => setTimeout(resolve, 1)),
      true,
      f.plain,
    );
    const transport = new SocialTransport(f.service, browser);
    f.service.cancelBrowserWorkflow = async (id) =>
      await browser.workflows.cancelAccount(f.service, id);
    await transport.rpc(owner, "social.browser.workflow.begin", {
      accountId: f.account.id,
      intent: "signup",
      acknowledgeRisk: true,
    });
    await expect(
      (async () => await browser.begin(f.service, owner, f.account.id, true))(),
    ).rejects.toThrow("browser workflow");
    expect(verifier).not.toHaveBeenCalled();
    await until(() => f.windows.length === 1);
    await f.service.call(owner, "accounts.disconnect", { accountId: f.account.id });
    await until(() => !browser.workflows.hasActive(f.account.id));
    expect(
      await transport.rpc(owner, "social.browser.workflow.status", { accountId: f.account.id }),
    ).toMatchObject({ workflows: [expect.objectContaining({ status: "cancelled" })] });
    expect(f.plain).toHaveBeenCalledTimes(1);
    await browser.workflows.stop(f.service);
  });
});
describe("browser route boundaries", () => {
  it.each([
    "http://x.com/fixture/status/1",
    "https://x.com.evil.test/fixture/status/1",
    "https://name:secret@x.com/fixture/status/1",
    "https://x.com:444/fixture/status/1",
    "file:///tmp/page",
    "https://x.com/settings",
    "https://x.com/i/flow/signup",
  ])("rejects arbitrary navigation: %s", (url) => {
    expect(() => socialBrowserUrl("x", "comments", url)).toThrow();
  });
  it("retains YouTube's video identifier, removes other query material and refuses non-video watch links", () => {
    expect(socialBrowserUrl("youtube", "signup")).toBe("https://www.youtube.com/channel_switcher");
    expect(
      socialBrowserUrl(
        "youtube",
        "comments",
        "https://www.youtube.com/watch?v=abcdefghijk&auth=synthetic#secret",
      ),
    ).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(() =>
      socialBrowserUrl("youtube", "comments", "https://www.youtube.com/watch?v=bad"),
    ).toThrow();
    expect(() => socialBrowserUrl("youtube", "inbox")).toThrow("unavailable");
    expect(() => socialBrowserUrl("whatsapp", "signup")).toThrow("mobile app");
  });
});

async function finalPageWorkflowFixture() {
  const window = new Window({ url: "https://www.linkedin.com/company/setup/new/" });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return this.hidden || this.closest("[hidden]") ? [] : [{ width: 100, height: 30 }];
    },
  });
  const prefix = "single-line-text-form-component-urn-li-fsu-pageCreationFormItem-",
    terms = "urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS-0";
  const nav = `<div class="global-nav__me"><button aria-expanded="false">Me</button><div class="global-nav__me-content" hidden><header><a href="/in/fixture-admin/">Fixture administrator</a></header></div></div>`;
  window.document.body.innerHTML = `${nav}<form>
    <input id="${prefix}NAME" value="Bycoda"><input id="${prefix}UNIVERSAL-NAME" value="bycoda"><input id="${prefix}WEBSITE" value="https://owner-private-website.example">
    <input id="single-typeahead-entity-form-component-urn-li-fsu-pageCreationFormItem-INDUSTRY" role="combobox" aria-autocomplete="list" aria-expanded="false" value="Software Development">
    <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-SIZE"><option value="SIZE_1">0–1 employees</option></select>
    <select id="text-entity-list-form-component-urn-li-fsu-pageCreationFormItem-ORGANIZATION-TYPE"><option value="SELF_EMPLOYED">Self-employed</option></select>
    <input id="media-upload-form-component-urn-li-fsu-pageCreationFormItem-LOGO" type="file"><textarea id="multiline-text-form-component-urn-li-fsu-pageCreationFormItem-TAGLINE">Owner private tagline</textarea>
    <input id="${terms}" name="urn:li:fsu_pageCreationFormItem:TERMS_AND_CONDITIONS" type="checkbox"><label for="${terms}">I represent this organization and agree to the Page Terms.</label>
    <a href="https://legal.linkedin.com/linkedin-pages-terms">Read LinkedIn Page Terms</a><button disabled>Create page</button>
  </form>`;
  const hooks: {
    afterAgreement?: () => Promise<void>;
    createFailure?: boolean;
    beforeLegal?: () => Promise<void>;
  } = {};
  const click = vi.fn(async (selector: string) => {
    const el = window.document.querySelector(selector)!;
    if (el.closest(".global-nav__me")) {
      const button = el as HTMLButtonElement,
        expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      window.document.querySelector<HTMLElement>(".global-nav__me-content")!.hidden = expanded;
    } else if (el.id === terms) {
      await hooks.beforeLegal?.();
      (el as HTMLInputElement).checked = true;
      window.document.querySelector<HTMLButtonElement>("form button")!.disabled = false;
      await hooks.afterAgreement?.();
    } else if (el.getAttribute("data-bycoda-registration-create") === "true") {
      await hooks.beforeLegal?.();
      if (hooks.createFailure) throw new Error("Unknown click outcome");
      window.happyDOM.setURL("https://www.linkedin.com/company/145372363/admin/dashboard/");
      window.document.body.innerHTML = nav;
    } else throw new Error("Unexpected creation click");
  });
  const page = {
    evaluate: vi.fn(async <T>(expression: string) => window.eval(expression) as T),
    click,
    goto: vi.fn(async (url: string) => {
      if (url.endsWith("/signup"))
        window.happyDOM.setURL("https://www.linkedin.com/company/setup/new/");
      else {
        window.happyDOM.setURL(url);
        window.document.body.innerHTML = `${nav}<input id="organization-name-field" value="Bycoda"><input id="organization-public-url-field" value="bycoda">`;
      }
    }),
    fill: vi.fn(async (selector: string, text: string) => {
      window.document.querySelector<HTMLInputElement>(selector)!.value = text;
    }),
    cookies: vi.fn(async () => []),
    insertText: vi.fn(),
    setFiles: vi.fn(),
    watchResponse: vi.fn(() => ({ body: async () => undefined, stop() {} })),
  } as unknown as BrowserPage;
  let closed!: () => void;
  const session = {
    page,
    closed: new Promise<void>((resolve) => {
      closed = resolve;
    }),
    close: vi.fn(async () => closed()),
  };
  const launcher = vi.fn<BrowserLauncher>(async () => session);
  const f = await fixture("linkedin", launcher, undefined, "organization");
  cleanups.push(async () => {
    await window.happyDOM.abort();
  });
  const profile = {
    accountKind: "brand" as const,
    displayName: "Bycoda",
    username: "bycoda",
    category: "Software Development",
  };
  await f.manager.begin(f.service, owner, {
    accountId: f.account.id,
    intent: "signup",
    acknowledgeRisk: true,
    registration: profile,
  });
  await until(async () => !!(await f.status()).workflows[0]?.registration);
  const flow = (await f.status()).workflows[0];
  const input = { accountId: f.account.id, workflowId: flow.id, expectedUpdatedAt: flow.updatedAt };
  const review = () => f.manager.reviewRegistration(f.service, owner, input);
  const legalClicks = () =>
    click.mock.calls.filter(([s]) => s.includes(terms) || s.includes("registration-create"));
  const stored = async () =>
    String(
      (
        await f.store.db
          .prepare("SELECT value FROM social_records WHERE kind='browser-workflow' AND id=?")
          .get(flow.id)
      )?.value,
    );
  return { f, window, page, hooks, session, launcher, input, review, legalClicks, stored };
}
describe("native owner-approved final Page creation lifecycle", () => {
  it("reviews ephemerally and persists a checkpoint before either legal action, then stores an exact receipt without connecting Host", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review();
    const raw = await s.stored();
    for (const privateValue of [
      "Fixture administrator",
      "fixture-admin",
      "Owner private tagline",
      "owner-private-website.example",
      review.reviewId,
    ])
      expect(raw).not.toContain(privateValue);
    s.hooks.beforeLegal = async () => {
      expect(JSON.parse(await s.stored()).registrationSubmission).toMatchObject({
        state: "attempting",
        reviewDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        expectedResourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    };
    const result = await s.f.manager.submitRegistration(s.f.service, owner, {
      ...s.input,
      reviewId: review.reviewId,
      confirm: "CREATE_LINKEDIN_PAGE",
    });
    expect(result.registrationSubmission).toMatchObject({
      state: "created",
      resourceId: "145372363",
      resourceUrl: "https://www.linkedin.com/company/145372363/",
    });
    expect(result.outcome).toBe("unverified");
    expect((await s.f.service.accountForOAuth(owner, s.f.account.id)).connected).toBe(false);
    expect(s.legalClicks()).toHaveLength(2);
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow();
    expect(s.legalClicks()).toHaveLength(2);
  });
  it("requires owner credentials, the current revision, exact review ID and action-specific confirmation", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review();
    await expect(
      s.f.manager.reviewRegistration(
        s.f.service,
        { kind: "session", actorId: "agent", provider: "codex", sessionId: "agent", projectId: "" },
        s.input,
      ),
    ).rejects.toThrow("owner");
    for (const patch of [
      { reviewId: "wrong", confirm: "CREATE_LINKEDIN_PAGE" },
      { reviewId: review.reviewId, confirm: true },
      {
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
        expectedUpdatedAt: s.input.expectedUpdatedAt - 1,
      },
    ])
      await expect(
        s.f.manager.submitRegistration(s.f.service, owner, { ...s.input, ...patch }),
      ).rejects.toThrow();
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("invalidates the review when optional fields or the administrator changes", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review();
    s.window.document.querySelector<HTMLInputElement>('[id$="-WEBSITE"]')!.value =
      "https://changed.example";
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow("changed");
    expect(s.legalClicks()).toHaveLength(0);
    const next = await s.review();
    s.window.document
      .querySelector(".global-nav__me-content header a")!
      .setAttribute("href", "/in/another-admin/");
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: next.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow("changed");
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("serializes competing approvals and consumes the review once", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review(),
      input = { ...s.input, reviewId: review.reviewId, confirm: "CREATE_LINKEDIN_PAGE" };
    const results = await Promise.allSettled([
      s.f.manager.submitRegistration(s.f.service, owner, input),
      s.f.manager.submitRegistration(s.f.service, owner, input),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(s.legalClicks()).toHaveLength(2);
  });
  it("does not accept agreement or Create when the prior durable checkpoint fails", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review(),
      prepare = s.f.store.db.prepare.bind(s.f.store.db);
    vi.spyOn(s.f.store.db, "prepare").mockImplementation((sql: string) => {
      const statement = prepare(sql);
      if (sql.startsWith("INSERT INTO social_records(kind,id,value) VALUES('browser-workflow'")) {
        const run = statement.run.bind(statement);
        statement.run = async (...args: Parameters<typeof statement.run>) => {
          if (JSON.parse(String(args[1])).registrationSubmission?.state === "attempting")
            throw new Error("Checkpoint write failed");
          return run(...args);
        };
      }
      return statement;
    });
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow("will not be repeated");
    expect(s.legalClicks()).toHaveLength(0);
    expect(JSON.parse(await s.stored()).registrationSubmission.state).toBe("unknown");
  });
  it("keeps unknown results inspectable and preserves their hold through old-client advance, cancellation, history pruning and restart", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review();
    s.hooks.createFailure = true;
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow("will not be repeated");
    const unknown = (await s.f.status()).workflows[0];
    expect(unknown.status).toBe("awaiting_owner");
    expect(unknown.registrationSubmission?.state).toBe("unknown");
    expect(s.session.close).not.toHaveBeenCalled();
    await expect(
      s.f.manager.reviewRegistration(s.f.service, owner, {
        ...s.input,
        expectedUpdatedAt: unknown.updatedAt,
      }),
    ).rejects.toThrow("already attempted");
    await expect(
      s.f.manager.advanceRegistration(s.f.service, owner, {
        ...s.input,
        expectedUpdatedAt: unknown.updatedAt,
        registration: { accountKind: "brand" },
      }),
    ).rejects.toThrow("already been attempted");
    expect(s.session.close).not.toHaveBeenCalled();
    await s.f.manager.cancel(s.f.service, owner, s.f.account.id);
    expect(s.session.close).toHaveBeenCalled();
    await until(() => !s.f.manager.hasActive(s.f.account.id));
    for (let index = 0; index < 21; index++) {
      await s.f.begin("login");
      await until(() => s.f.windows.length > index);
      await s.f.manager.cancel(s.f.service, owner, s.f.account.id);
      await until(() => !s.f.manager.hasActive(s.f.account.id));
    }
    expect(
      (await s.f.status()).workflows.some(
        (flow) => flow.id === unknown.id && flow.registrationSubmission?.state === "unknown",
      ),
    ).toBe(true);
    const restarted = new SocialBrowserWorkflows(
      undefined,
      (a) => a.id,
      async (_id, action) => action(),
    );
    await expect(
      restarted.begin(s.f.service, owner, {
        accountId: s.f.account.id,
        intent: "signup",
        acknowledgeRisk: true,
        registration: { accountKind: "brand" },
      }),
    ).rejects.toThrow("already attempted");
    expect(JSON.parse(await s.stored()).registrationSubmission.state).toBe("unknown");
    expect(s.legalClicks()).toHaveLength(2);
  });
  it("honors cancellation between agreement and Create while keeping the durable unresolved hold", async () => {
    const s = await finalPageWorkflowFixture(),
      review = await s.review();
    s.hooks.afterAgreement = () => s.f.manager.cancel(s.f.service, owner, s.f.account.id);
    await expect(
      s.f.manager.submitRegistration(s.f.service, owner, {
        ...s.input,
        reviewId: review.reviewId,
        confirm: "CREATE_LINKEDIN_PAGE",
      }),
    ).rejects.toThrow("will not be repeated");
    expect(s.legalClicks()).toHaveLength(1);
    expect(s.session.close).toHaveBeenCalled();
    expect(JSON.parse(await s.stored()).registrationSubmission.state).toBe("unknown");
  });
});

async function unresolvedPageRecoveryFixture(keepActive = false, loginWaiting = () => false) {
  const s = await finalPageWorkflowFixture(),
    review = await s.review();
  s.hooks.createFailure = true;
  await expect(
    s.f.manager.submitRegistration(s.f.service, owner, {
      ...s.input,
      reviewId: review.reviewId,
      confirm: "CREATE_LINKEDIN_PAGE",
    }),
  ).rejects.toThrow("will not be repeated");
  if (!keepActive) {
    await s.f.manager.cancel(s.f.service, owner, s.f.account.id);
    await until(() => !s.f.manager.hasActive(s.f.account.id));
  }
  vi.mocked(s.page.click).mockClear();
  vi.mocked(s.page.goto).mockClear();
  vi.mocked(s.page.fill).mockClear();
  let finish!: () => void;
  const session = {
    page: s.page,
    closed: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    close: vi.fn(async () => finish()),
  };
  const launcher = vi.fn<BrowserLauncher>(async () => session);
  const exclusive = vi.fn(async <T>(_id: string, action: () => Promise<T>) => action());
  const manager = keepActive
    ? s.f.manager
    : new SocialBrowserWorkflows(
        undefined,
        (a) => join(s.f.directory, a.id),
        exclusive,
        Date.now,
        async () => undefined,
        launcher,
        loginWaiting,
      );
  if (!keepActive)
    cleanups.push(async () => {
      await manager.stop(s.f.service);
    });
  const current = () => s.stored().then((raw) => JSON.parse(raw) as SocialBrowserWorkflow);
  const input = async () => ({
    accountId: s.f.account.id,
    workflowId: s.input.workflowId,
    expectedUpdatedAt: (await current()).updatedAt,
    resourceId: "145372363",
  });
  const replace = async (change: (record: SocialBrowserWorkflow) => void) => {
    const row = await current();
    change(row);
    await s.f.store.db
      .prepare("UPDATE social_records SET value=? WHERE kind='browser-workflow' AND id=?")
      .run(JSON.stringify(row), row.id);
  };
  return {
    ...s,
    manager,
    recoverySession: session,
    recoveryLauncher: launcher,
    exclusive,
    current,
    recoveryInput: input,
    replace,
  };
}

describe("read-only recovery of unresolved LinkedIn Page creation", () => {
  it.each(["unknown", "attempting"] as const)(
    "reconciles a matching %s resource after restart using the same profile without repeating legal actions",
    async (state) => {
      const s = await unresolvedPageRecoveryFixture();
      if (state === "attempting")
        await s.replace((record) => {
          record.registrationSubmission!.state = "attempting";
        });
      const result = await s.manager.reconcileRegistration(
        s.f.service,
        owner,
        await s.recoveryInput(),
      );
      expect(result.registrationSubmission).toMatchObject({
        state: "created",
        resourceId: "145372363",
        resourceUrl: "https://www.linkedin.com/company/145372363/",
        expectedResourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(result.outcome).toBe("unverified");
      expect((await s.f.service.accountForOAuth(owner, s.f.account.id)).connected).toBe(false);
      expect(s.recoveryLauncher).toHaveBeenCalledExactlyOnceWith(
        s.launcher.mock.calls[0][0],
        false,
      );
      expect(s.exclusive).toHaveBeenCalledTimes(1);
      expect(s.recoverySession.close).toHaveBeenCalledTimes(1);
      expect(s.legalClicks()).toHaveLength(0);
      expect(s.page.fill).not.toHaveBeenCalled();
      expect(s.page.setFiles).not.toHaveBeenCalled();
      const raw = await s.stored();
      for (const value of [
        "fixture-admin",
        "Fixture administrator",
        "Bycoda",
        "Owner private tagline",
      ])
        expect(raw).not.toContain(value);
    },
  );
  it.each(["name", "slug", "administrator"])(
    "keeps a mismatching %s unresolved without modifying it",
    async (field) => {
      const s = await unresolvedPageRecoveryFixture(),
        go = vi.mocked(s.page.goto).getMockImplementation()!;
      vi.mocked(s.page.goto).mockImplementation(async (url) => {
        await go(url);
        if (field === "name")
          s.window.document.querySelector<HTMLInputElement>("#organization-name-field")!.value =
            "Another Page";
        if (field === "slug")
          s.window.document.querySelector<HTMLInputElement>(
            "#organization-public-url-field",
          )!.value = "another-slug";
        if (field === "administrator")
          s.window.document
            .querySelector(".global-nav__me-content header a")!
            .setAttribute("href", "/in/another-admin/");
      });
      await expect(
        s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
      ).rejects.toThrow("does not match");
      expect((await s.current()).registrationSubmission?.state).toBe("unknown");
      expect(s.legalClicks()).toHaveLength(0);
      expect(s.page.fill).not.toHaveBeenCalled();
    },
  );
  it("requires owner, current retained revision and a known resource digest before launch", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      input = await s.recoveryInput();
    await expect(
      s.manager.reconcileRegistration(
        s.f.service,
        { kind: "session", actorId: "agent", provider: "codex", sessionId: "agent" },
        input,
      ),
    ).rejects.toThrow("owner");
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, {
        ...input,
        expectedUpdatedAt: input.expectedUpdatedAt - 1,
      }),
    ).rejects.toThrow("changed");
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, {
        ...input,
        resourceId: "https://www.linkedin.com/company/145372363/",
      }),
    ).rejects.toThrow("numeric ID");
    await s.replace((record) => {
      delete record.registrationSubmission!.expectedResourceDigest;
    });
    await expect(s.manager.reconcileRegistration(s.f.service, owner, input)).rejects.toThrow(
      "older attempt",
    );
    expect(s.recoveryLauncher).not.toHaveBeenCalled();
    expect((await s.current()).registrationSubmission?.state).toBe("unknown");
  });
  it("rejects another platform's retained attempt before opening a browser", async () => {
    const s = await unresolvedPageRecoveryFixture();
    await s.replace((record) => {
      record.platform = "facebook";
    });
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("Only an unresolved");
    expect(s.recoveryLauncher).not.toHaveBeenCalled();
  });
  it("can reconcile after an intended Page connection without establishing or changing that connection", async () => {
    const s = await unresolvedPageRecoveryFixture();
    await s.f.service.connectAccount(
      s.f.account.id,
      {
        platformId: "web:linkedin:company:145372363",
        name: "Bycoda",
        scopes: [],
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "synthetic-browser" },
    );
    const connect = vi.spyOn(s.f.service, "connectAccount");
    expect(
      (await s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()))
        .registrationSubmission?.state,
    ).toBe("created");
    expect(connect).not.toHaveBeenCalled();
    expect((await s.f.service.accountForOAuth(owner, s.f.account.id)).platformId).toBe(
      "web:linkedin:company:145372363",
    );
  });
  it("rejects an unrelated connected organization", async () => {
    const s = await unresolvedPageRecoveryFixture();
    await s.f.service.connectAccount(
      s.f.account.id,
      {
        platformId: "web:linkedin:company:999",
        name: "Other",
        scopes: [],
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "synthetic-browser" },
    );
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("does not match");
    expect(s.recoveryLauncher).not.toHaveBeenCalled();
  });
  it("reuses the active page under serialization and does not later overwrite a created receipt on cancellation", async () => {
    const s = await unresolvedPageRecoveryFixture(true),
      locks = s.f.locks;
    const result = await s.manager.reconcileRegistration(
      s.f.service,
      owner,
      await s.recoveryInput(),
    );
    expect(result.registrationSubmission?.state).toBe("created");
    expect(s.launcher).toHaveBeenCalledTimes(1);
    expect(s.f.locks).toBe(locks);
    expect(s.session.close).not.toHaveBeenCalled();
    await s.manager.cancel(s.f.service, owner, s.f.account.id);
    await until(() => !s.manager.hasActive(s.f.account.id));
    expect((await s.current()).registrationSubmission?.state).toBe("created");
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("does not open another persistent profile while an external login is active", async () => {
    const s = await unresolvedPageRecoveryFixture(false, () => true);
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("current login");
    expect(s.recoveryLauncher).not.toHaveBeenCalled();
    expect(s.recoverySession.close).not.toHaveBeenCalled();
  });
  it("requires finishing a plain active login rather than launching the shared profile twice", async () => {
    const s = await unresolvedPageRecoveryFixture();
    await s.f.begin("login");
    await until(() => s.f.windows.length > 0);
    await expect(
      s.f.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("current browser window");
    expect(s.recoveryLauncher).not.toHaveBeenCalled();
    expect(s.f.windows[0].close).not.toHaveBeenCalled();
  });
  it("holds recovery when executor ownership changes during the read", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      go = vi.mocked(s.page.goto).getMockImplementation()!;
    vi.mocked(s.page.goto).mockImplementation(async (url) => {
      await go(url);
      await s.f.service.call(owner, "accounts.executor", {
        accountId: s.f.account.id,
        executorId: "another-host",
      });
    });
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("executor host");
    expect((await s.current()).registrationSubmission?.state).toBe("unknown");
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("keeps the unresolved result if native owner authority is revoked during the external read", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      go = vi.mocked(s.page.goto).getMockImplementation()!;
    vi.mocked(s.page.goto).mockImplementation(async (url) => {
      await go(url);
      vi.spyOn(s.f.service, "accountForOAuth").mockRejectedValue(new Error("Owner revoked"));
    });
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("Owner revoked");
    expect((await s.current()).registrationSubmission?.state).toBe("unknown");
    expect(s.recoverySession.close).toHaveBeenCalledTimes(1);
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("revalidates the durable workflow revision after the external read", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      go = vi.mocked(s.page.goto).getMockImplementation()!;
    vi.mocked(s.page.goto).mockImplementation(async (url) => {
      await go(url);
      await s.replace((record) => {
        record.updatedAt++;
      });
    });
    await expect(
      s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput()),
    ).rejects.toThrow("changed");
    expect((await s.current()).registrationSubmission?.state).toBe("unknown");
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("honors cancellation during the read without committing a created receipt", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      go = vi.mocked(s.page.goto).getMockImplementation()!;
    let release!: () => void,
      entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(s.page.goto).mockImplementation(async (url) => {
      entered = true;
      await gate;
      await go(url);
    });
    const pending = s.manager.reconcileRegistration(s.f.service, owner, await s.recoveryInput());
    const outcome = pending.then(
      () => undefined,
      (error) => error,
    );
    await until(() => entered);
    await s.manager.cancel(s.f.service, owner, s.f.account.id);
    release();
    expect(await outcome).toBeInstanceOf(Error);
    expect((await s.current()).registrationSubmission?.state).toBe("unknown");
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("serializes competing reconciliation requests without another launch or Create action", async () => {
    const s = await unresolvedPageRecoveryFixture(),
      go = vi.mocked(s.page.goto).getMockImplementation()!;
    let release!: () => void,
      entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(s.page.goto).mockImplementation(async (url) => {
      entered = true;
      await gate;
      await go(url);
    });
    const input = await s.recoveryInput(),
      first = s.manager.reconcileRegistration(s.f.service, owner, input);
    await until(() => entered);
    await expect(s.manager.reconcileRegistration(s.f.service, owner, input)).rejects.toThrow(
      "already being checked",
    );
    release();
    expect((await first).registrationSubmission?.state).toBe("created");
    expect(s.recoveryLauncher).toHaveBeenCalledTimes(1);
    expect(s.legalClicks()).toHaveLength(0);
  });
  it("retains a visible old hold after 21 later login windows and reconciles it with a fresh manager", async () => {
    const s = await unresolvedPageRecoveryFixture();
    for (let i = 0; i < 21; i++) {
      await s.f.begin("login");
      await until(() => s.f.windows.length > i);
      await s.f.manager.cancel(s.f.service, owner, s.f.account.id);
      await until(() => !s.f.manager.hasActive(s.f.account.id));
    }
    const state = await s.manager.status(s.f.service, owner, s.f.account.id),
      old = state.workflows.find((record) => record.id === s.input.workflowId)!;
    expect(state.workflows.length).toBeLessThanOrEqual(21);
    expect(old.registrationSubmission?.state).toBe("unknown");
    expect(
      (
        await s.manager.reconcileRegistration(s.f.service, owner, {
          ...(await s.recoveryInput()),
          expectedUpdatedAt: old.updatedAt,
        })
      ).registrationSubmission?.state,
    ).toBe("created");
    expect(s.legalClicks()).toHaveLength(0);
  });
});
