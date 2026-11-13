import { challengeError, detectChallenge } from "./browser/challenge";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { writeFileAtomic } from "../storage/atomic-write";
import type { SocialAccount } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialAdapter } from "../../src/integrations/social/adapter";
import { X_BROWSER_SCOPES } from "../../src/integrations/social/capabilities";
import { xMediaFormat } from "../../src/integrations/social/xMedia";
import type { SocialPrincipal, SocialService } from "./social";
import { SocialBrowserWorkflows } from "./social-browser-workflows";
import type { SocialBrowserIntent } from "../../src/features/social/model/socialBrowser";
import { XProfileActions, parseXProfilePatch } from "./social-browser-profile";
import {
  LinkedInProfileActions,
  parseLinkedInProfilePatch,
} from "./social-browser-linkedin-profile";
import { BrowserSendLimiter } from "./browser/limiter";
import { ExistingChromeBindings } from "./browser/existing-chrome-bindings";
import { connectExistingChrome } from "./browser/existing-chrome-connect";
import { runLayered, visibilityOf, type BrowserWiring } from "./browser-layers/wiring";
import { PlatformBrowserSessions } from "./social-browser-platforms";
import { SOCIAL_BROWSER_RECIPES } from "./social-browser-recipes";
import {
  FacebookProfileActions,
  parseFacebookProfilePatch,
} from "./social-browser-facebook-profile";
import {
  InstagramProfileActions,
  parseInstagramProfilePatch,
} from "./social-browser-instagram-profile";
import type { BrowserRecipe } from "./social-browser-recipe";
import { xIdentity, xUserId, type XBrowserDeps } from "./social-browser-x-page";
import { pollX } from "./social-browser-x-inbox";
import { publishX } from "./social-browser-x-compose";
import {
  systemBrowserLauncher,
  systemPlainLauncher,
  type BrowserLauncher,
  type BrowserPage,
  type BrowserSession,
  type PlainBrowserLauncher,
} from "./social-browser";

const LOGIN_TIMEOUT = 10 * 60_000;
const READ_IDLE_TIMEOUT = 120_000;
const READ_MAX_AGE = 10 * 60_000;
const READ_POOL_LIMIT = 2;
type ReadSession = {
  session?: BrowserSession;
  timer?: ReturnType<typeof setTimeout>;
  started: number;
  usable: boolean;
};
type LoginFlow = {
  status: "waiting" | "checking" | "connected" | "failed";
  error?: string;
  expiresAt: number;
  cancelled?: boolean;
  session?: { close(): Promise<void> };
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * X connection through the owner's own logged-in web session instead of the paid API.
 * The persistent profile is the credential: it stays in the host data directory and never
 * reaches the renderer, session tools or logs. Every operation on a profile is serialized.
 */
export class XBrowserSessions {
  private stopped = false;
  readonly workflows: SocialBrowserWorkflows;
  private readonly platforms: PlatformBrowserSessions;
  private locks = new Map<string, Promise<unknown>>();
  private chromeReviews = new Map<string, symbol>();
  private logins = new Map<string, LoginFlow>();
  private reads = new Map<string, ReadSession>();
  constructor(
    private readonly directory: string,
    private readonly launcher: BrowserLauncher | undefined = systemBrowserLauncher(),
    private readonly now = Date.now,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
    private readonly background = process.env.BYCODA_SOCIAL_BROWSER_HEADED !== "1",
    private readonly plain: PlainBrowserLauncher | undefined = systemPlainLauncher(),
    private readonly recipes: readonly BrowserRecipe[] = SOCIAL_BROWSER_RECIPES,
    private readonly readNow = monotonicNow,
    private readonly limiter: BrowserSendLimiter = new BrowserSendLimiter({ now }),
    private readonly wiring: BrowserWiring = {},
    private readonly chrome = new ExistingChromeBindings(directory),
  ) {
    wiring.openSession = async (accountId, fallback) =>
      (await this.chrome.open(accountId)) ?? fallback();
    this.platforms = new PlatformBrowserSessions(
      directory,
      recipes,
      launcher,
      plain,
      (id) => this.profile(id, "browser-profiles"),
      (id, action) => this.exclusive(id, action),
      now,
      wait,
      background,
      limiter,
      wiring,
    );
    this.workflows = new SocialBrowserWorkflows(
      plain,
      (account) =>
        account.platform === "x"
          ? this.profile(account.id)
          : this.profile(account.id, "browser-profiles"),
      (id, action) => this.exclusive(id, action),
      now,
      wait,
      launcher,
      (id) =>
        ["waiting", "checking"].includes(this.logins.get(id)?.status ?? "") ||
        this.platforms.waiting(id),
    );
  }
  async workflowBegin(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    intent: SocialBrowserIntent,
    targetUrl: unknown,
    acknowledgeRisk: unknown,
    registration?: unknown,
  ) {
    if (await this.chrome.get(accountId))
      throw new Error(
        "This account uses an existing Chrome session. Use its platform tab for owner sign-in steps.",
      );
    if (
      ["waiting", "checking"].includes(this.logins.get(accountId)?.status ?? "") ||
      this.platforms.waiting(accountId)
    )
      throw new Error("Finish or cancel the account's current login first.");
    return await this.workflows.begin(service, p, {
      accountId,
      intent,
      targetUrl,
      acknowledgeRisk,
      ...(registration === undefined ? {} : { registration }),
    });
  }
  availability() {
    return this.launcher
      ? { available: true, reason: "Google Chrome or Microsoft Edge found." }
      : {
          available: false,
          reason:
            "Install Microsoft Edge or Google Chrome on this host, or set BYCODA_SOCIAL_BROWSER.",
        };
  }
  async chromeTabs(
    service: SocialService,
    principal: SocialPrincipal,
    accountId: string,
    acknowledgeAccess: unknown,
  ) {
    if (acknowledgeAccess !== true)
      throw new Error("Confirm access to your Chrome profile before connecting.");
    const account = await service.accountForOAuth(principal, accountId);
    if (account.executorId !== service.store.environmentId)
      throw new Error("Connect Chrome on the account's executor host.");
    return { tabs: await this.chrome.list(account.platform) };
  }
  async cancelLogin(service: SocialService, principal: SocialPrincipal, accountId: string) {
    await service.accountForOAuth(principal, accountId);
    this.chromeReviews.delete(accountId);
    const flow = this.logins.get(accountId);
    if (flow) {
      flow.cancelled = true;
      this.logins.delete(accountId);
      await flow.session?.close();
    }
    await this.platforms.forget(accountId);
    return { status: "idle" as const };
  }
  async profileAction(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    action: "read" | "update" | "follow",
    input: Record<string, unknown>,
  ) {
    const account = await service.accountForBrowserManagement(p, accountId, action !== "read");
    const linkedIn = account.platform === "linkedin" && account.accountType === "organization";
    const facebook = account.platform === "facebook" && account.accountType === "page";
    const instagram =
      account.platform === "instagram" && ["member", "professional"].includes(account.accountType);
    const check = async () => {
      const current = await service.accountForBrowserManagement(p, accountId, action !== "read");
      if (
        current.platform !== account.platform ||
        current.accountType !== account.accountType ||
        (current.platform !== "x" &&
          !(
            linkedIn &&
            current.platform === "linkedin" &&
            current.accountType === "organization"
          ) &&
          !(facebook && current.platform === "facebook" && current.accountType === "page") &&
          !instagram) ||
        current.connection !== "browser" ||
        !current.connected ||
        current.paused ||
        current.platformId !== account.platformId ||
        current.executorId !== service.store.environmentId
      )
        throw new SocialPlatformError("denied");
      if (
        this.workflows.hasActive(accountId) ||
        ["waiting", "checking"].includes(this.logins.get(accountId)?.status ?? "")
      )
        throw new Error("Finish the account's active browser operation first.");
    };
    await check();
    if (!this.launcher) throw new SocialPlatformError("unsupported");
    if (
      action !== "read" &&
      input.confirm !==
        (action === "follow"
          ? "FOLLOW_X_ACCOUNT"
          : linkedIn
            ? "UPDATE_LINKEDIN_PROFILE"
            : facebook
              ? "UPDATE_FACEBOOK_PROFILE"
              : instagram
                ? "UPDATE_INSTAGRAM_PROFILE"
                : "UPDATE_X_PROFILE")
    )
      throw new Error("Explicit profile action confirmation required.");
    if ((linkedIn || facebook || instagram) && action === "follow")
      throw new SocialPlatformError("unsupported");
    const patch =
      action === "update"
        ? linkedIn
          ? parseLinkedInProfilePatch(input.patch)
          : facebook
            ? parseFacebookProfilePatch(input.patch)
            : instagram
              ? parseInstagramProfilePatch(input.patch)
              : parseXProfilePatch(input.patch)
        : undefined;
    if (
      action === "follow" &&
      (typeof input.handle !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(input.handle))
    )
      throw new Error("Enter an exact X username.");
    return this.exclusive(accountId, async () => {
      await check();
      const staging = join(this.directory, "x-profile-uploads", randomUUID());
      let session: BrowserSession | undefined;
      try {
        const files: { avatar?: string; banner?: string } = {};
        for (const kind of ["avatar", "banner"] as const) {
          const id = patch?.[kind === "avatar" ? "avatarUploadId" : "bannerUploadId"];
          if (!id) continue;
          const bytes = await service.readOwnerMedia(p, id);
          const format = xMediaFormat(bytes);
          if (format === "mp4") throw new SocialPlatformError("rejected");
          await mkdir(staging, { recursive: true, mode: 0o700 });
          files[kind] = join(staging, `${kind}.${format}`);
          await writeFileAtomic(files[kind]!, bytes, { mode: 0o600 });
        }
        session = await this.launchAt(
          accountId,
          this.profile(
            accountId,
            linkedIn || facebook || instagram ? "browser-profiles" : "x-browser",
          ),
          this.background,
        );
        const page = session.page;
        if (instagram) {
          const recipe = this.recipes.find((entry) => entry.platform === "instagram");
          if (!recipe) throw new SocialPlatformError("unsupported");
          const actions = new InstagramProfileActions(
            page,
            check,
            async () => {
              const identity = await recipe.identity(page, account);
              if (identity?.platformId !== account.platformId)
                throw new SocialPlatformError("denied");
            },
            async (expression, timeout) => await this.until(page, expression, timeout),
          );
          return action === "read" ? await actions.read() : await actions.update(patch!, files);
        }
        if (facebook) {
          const recipe = this.recipes.find((entry) => entry.platform === "facebook");
          if (!recipe) throw new SocialPlatformError("unsupported");
          const actions = new FacebookProfileActions(
            page,
            account.platformId,
            check,
            async () => {
              const identity = await recipe.identity(page, account);
              if (identity?.platformId !== account.platformId || identity.accountType !== "page")
                throw new SocialPlatformError("denied");
            },
            async (expression, timeout) => await this.until(page, expression, timeout),
          );
          return action === "read" ? await actions.read() : await actions.update(patch!, files);
        }
        if (linkedIn) {
          const actions = new LinkedInProfileActions(
            page,
            account.platformId,
            check,
            async (expression, timeout) => await this.until(page, expression, timeout),
          );
          return action === "read" ? await actions.read() : await actions.update(patch!, files);
        }
        const actions = new XProfileActions(
          page,
          async () => {
            await check();
            await this.identity(page, account);
          },
          async (expression, timeout) => await this.until(page, expression, timeout),
        );
        return action === "read"
          ? await actions.read()
          : action === "update"
            ? await actions.update(patch!, files)
            : await actions.follow(input.handle as string);
      } finally {
        await session?.close().catch(() => undefined);
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }
  /** Opens an account browser with its visibility setting and tracks its page for the layers and live view. */
  private async launchAt(
    accountId: string,
    profile: string,
    background: boolean,
  ): Promise<BrowserSession> {
    const visibility = await visibilityOf(this.wiring, accountId);
    const fallback = () => this.launcher!(profile, background, visibility);
    const session = await (this.wiring.openSession?.(accountId, fallback) ?? fallback());
    const release = this.wiring.tracker?.track(accountId, session);
    return {
      ...session,
      close: async () => {
        release?.();
        await session.close();
      },
    };
  }
  private profile(accountId: string, folder = "x-browser") {
    if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("Invalid social account.");
    return join(this.directory, folder, accountId);
  }
  private exclusive<T>(
    accountId: string,
    action: () => Promise<T>,
    retainRead = false,
  ): Promise<T> {
    const previous = this.locks.get(accountId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (!retainRead) await this.closeRead(accountId);
        return await action();
      });
    const settled = next.catch(() => undefined);
    this.locks.set(accountId, settled);
    void settled
      .then(() => {
        if (this.locks.get(accountId) === settled) this.locks.delete(accountId);
      })
      .catch(() => undefined);
    return next;
  }
  private async closeRead(accountId: string): Promise<void> {
    const owner = this.reads.get(accountId);
    if (!owner) return;
    owner.usable = false;
    clearTimeout(owner.timer);
    if (owner.session) {
      await owner.session.close();
      // A CDP disconnect is not physical profile retirement. Keep ownership
      // and its capacity reservation when release fails or remains unknown.
      await owner.session.profileReleased!();
    }
    if (this.reads.get(accountId) === owner) this.reads.delete(accountId);
  }
  private async readSession(accountId: string): Promise<BrowserSession> {
    if (this.stopped) throw new Error("The browser executor is stopping.");
    let owner = this.reads.get(accountId);
    if (owner && (!owner.usable || elapsedSince(owner.started, this.readNow()) >= READ_MAX_AGE)) {
      await this.closeRead(accountId);
      owner = undefined;
    }
    if (owner?.session) {
      clearTimeout(owner.timer);
      return owner.session;
    }
    const reserve = this.background && this.reads.size < READ_POOL_LIMIT;
    owner = { started: this.readNow(), usable: true };
    if (reserve) this.reads.set(accountId, owner);
    try {
      const session = await this.launchAt(accountId, this.profile(accountId), this.background);
      if (reserve && session.profileReleased) {
        owner.session = session;
        const captured = owner;
        void session.closed.then(
          () => {
            captured.usable = false;
          },
          () => {
            captured.usable = false;
          },
        );
        if (this.stopped) {
          await this.closeRead(accountId);
          throw new Error("The browser executor is stopping.");
        }
      } else if (reserve) this.reads.delete(accountId);
      if (this.stopped && !owner.session) {
        await session.close();
        await session.profileReleased?.();
        throw new Error("The browser executor is stopping.");
      }
      return session;
    } catch (error) {
      if (!owner.session && this.reads.get(accountId) === owner) this.reads.delete(accountId);
      throw error;
    }
  }
  private async releaseRead(accountId: string, session: BrowserSession, success: boolean) {
    const owner = this.reads.get(accountId);
    if (owner?.session !== session) {
      await session.close().catch(() => undefined);
      await session.profileReleased?.();
      return;
    }
    if (!success || this.stopped || !owner.usable) {
      await this.closeRead(accountId);
      return;
    }
    const delay = Math.min(
      READ_IDLE_TIMEOUT,
      Math.max(0, READ_MAX_AGE - elapsedSince(owner.started, this.readNow())),
    );
    owner.timer = setTimeout(() => {
      if (this.reads.get(accountId) !== owner) return;
      void this.exclusive(accountId, async () => {}).catch(() => undefined);
    }, delay);
    owner.timer.unref?.();
  }
  async begin(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    acknowledgeRisk: unknown,
    target?: string,
    chromeSelection?: { targetId: string; acknowledgeAccess: unknown },
  ): Promise<{ status: LoginFlow["status"]; expiresAt: number; source?: "existing-chrome" }> {
    if (this.stopped) throw new Error("The browser executor is stopping.");
    if (acknowledgeRisk !== true)
      throw new Error(
        "Confirm that browser-session mode is unofficial and can restrict the account.",
      );
    const account = await service.accountForOAuth(p, accountId);
    if (this.workflows.hasActive(accountId))
      throw new Error(
        "Close or cancel the account's browser workflow before verifying its connection.",
      );
    if (chromeSelection) {
      if (chromeSelection.acknowledgeAccess !== true)
        throw new Error("Confirm access to your Chrome profile before connecting.");
      if (account.executorId !== service.store.environmentId)
        throw new Error("Connect Chrome on the account's executor host.");
      if (
        ["waiting", "checking"].includes(this.logins.get(accountId)?.status ?? "") ||
        this.platforms.waiting(accountId)
      )
        throw new Error("Finish the account's current login before connecting Chrome.");
      const token = Symbol();
      this.chromeReviews.set(accountId, token);
      const epoch = await service.connectionReviewEpoch(p, accountId);
      const current = () => !this.stopped && this.chromeReviews.get(accountId) === token;
      return this.exclusive(accountId, async () => {
        if (!current()) throw new Error("The account connection was cancelled.");
        if (
          this.workflows.hasActive(accountId) ||
          this.platforms.waiting(accountId) ||
          ["waiting", "checking"].includes(this.logins.get(accountId)?.status ?? "")
        )
          throw new Error("Finish the account's current login before connecting Chrome.");
        return await connectExistingChrome({
          service,
          principal: p,
          account,
          review: { epoch, current },
          targetId: chromeSelection.targetId,
          resourceId: target,
          bindings: this.chrome,
          recipes: this.recipes,
          directory: this.directory,
          wait: this.wait,
        });
      }).finally(() => {
        if (this.chromeReviews.get(accountId) === token) this.chromeReviews.delete(accountId);
      });
    }
    const activeLogin = this.logins.get(accountId);
    if (activeLogin?.status === "waiting" || activeLogin?.status === "checking")
      return { status: activeLogin.status, expiresAt: activeLogin.expiresAt };
    if (account.platform !== "x" && this.platforms.waiting(accountId))
      return this.platforms.begin(service, p, account, target);
    await this.exclusive(accountId, () => this.chrome.set(accountId, undefined));
    if (account.platform !== "x") return this.platforms.begin(service, p, account, target);
    // The profile must live on the host that executes this account's sends.
    if (account.executorId !== service.store.environmentId)
      throw new Error(
        "Log in on the account's executor host; its browser profile is used for sending.",
      );
    if (!this.launcher) throw new Error(this.availability().reason);
    const current = this.logins.get(accountId);
    if (current && (current.status === "waiting" || current.status === "checking"))
      return { status: current.status, expiresAt: current.expiresAt };
    const flow: LoginFlow = { status: "waiting", expiresAt: this.now() + LOGIN_TIMEOUT };
    this.logins.set(accountId, flow);
    void this.exclusive(accountId, async () => await this.login(service, account, flow)).catch(
      (error) => {
        flow.status = "failed";
        flow.error = message(error);
      },
    );
    return { status: flow.status, expiresAt: flow.expiresAt };
  }
  async status(service: SocialService, p: SocialPrincipal, accountId: string) {
    const account = await service.accountForOAuth(p, accountId);
    const source = (await this.chrome.get(accountId))
      ? ("existing-chrome" as const)
      : ("dedicated" as const);
    if (account.platform !== "x")
      return { ...(await this.platforms.check(service, p, account)), source };
    const flow = this.logins.get(accountId);
    if (flow?.status === "waiting" || flow?.status === "checking")
      return { status: flow.status, error: flow.error };
    if (!account.connected || !account.platformId)
      return flow?.status === "failed"
        ? { status: flow.status, error: flow.error }
        : { status: "idle" as const };
    try {
      if (
        !this.launcher ||
        account.executorId !== service.store.environmentId ||
        this.workflows.hasActive(accountId)
      )
        throw new Error(
          "Check this account on its executor host after closing its browser workflow.",
        );
      return await this.exclusive(accountId, async () => {
        const current = await service.accountForOAuth(p, accountId);
        if (
          !current.connected ||
          current.platformId !== account.platformId ||
          current.executorId !== account.executorId
        )
          throw new Error("The account changed. Try again.");
        const session = await this.launchAt(accountId, this.profile(accountId), true);
        try {
          await session.page.goto("https://x.com/home");
          const challenge = await challengeError(session.page, this.directory);
          if (challenge) throw challenge;
          if (await detectChallenge(session.page)) throw new SocialPlatformError("expired");
          await this.identity(session.page, current);
          return { status: "connected" as const, error: undefined, source };
        } finally {
          await session.close();
          await session.profileReleased?.();
        }
      });
    } catch (error) {
      return { status: "failed" as const, error: message(error) };
    }
  }
  private async login(service: SocialService, account: SocialAccount, flow: LoginFlow) {
    if (flow.cancelled) throw new Error("X login was cancelled.");
    if (!this.plain) throw new Error(this.availability().reason);
    const profile = this.profile(account.id);
    const window = await this.plain(profile, "https://x.com/login");
    flow.session = window;
    let closed = false;
    const markClosed = () => {
      closed = true;
    };
    void window.closed.then(markClosed, markClosed);
    try {
      while (!closed) {
        if (flow.cancelled) throw new Error("X login was cancelled.");
        if (this.now() > flow.expiresAt) throw new Error("X login timed out. Try again.");
        await this.wait(1000);
      }
    } finally {
      delete flow.session;
      if (!closed) await window.close().catch(() => undefined);
    }
    if (flow.cancelled) throw new Error("X login was cancelled.");
    flow.status = "checking";
    // The owner closed the window; verify the saved session without showing a window.
    const session = await this.launchAt(account.id, profile, true);
    try {
      const id = xUserId(await session.page.cookies().catch(() => []));
      if (!id)
        throw new Error("X login was not completed. Log in to X in the window, then close it.");
      if (account.platformId && account.platformId !== id)
        throw new Error(
          "A different X account is logged in. Log in with the account connected earlier.",
        );
      await session.page.goto("https://x.com/home");
      const challenge = await challengeError(session.page, this.directory);
      if (challenge) throw challenge;
      if (await detectChallenge(session.page)) throw new SocialPlatformError("expired");
      const href = await this.until(
        session.page,
        `document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") ?? ""`,
        30_000,
      );
      const handle = /^\/(\w{1,15})$/.exec(String(href ?? ""))?.[1];
      if (flow.cancelled) throw new Error("X login was cancelled.");
      await service.connectAccount(
        account.id,
        {
          platformId: id,
          name: handle ? `@${handle}` : `X ${id}`,
          scopes: X_BROWSER_SCOPES,
          accessApproved: true,
          connection: "browser",
        },
        { accessToken: "browser-session" },
      );
      flow.status = "connected";
    } finally {
      await session.close().catch(() => undefined);
    }
  }
  /** Cancels an open login and removes the logged-in profile, which logs this host out of X. */
  async forget(accountId: string): Promise<void> {
    this.chromeReviews.delete(accountId);
    await this.platforms.forget(accountId);
    const flow = this.logins.get(accountId);
    this.logins.delete(accountId);
    if (flow) {
      flow.cancelled = true;
      await flow.session?.close().catch(() => undefined);
    }
    // Browser helper processes can hold profile files briefly after closing.
    return this.exclusive(accountId, async () => {
      await this.chrome.set(accountId, undefined);
      for (const folder of ["x-browser", "browser-profiles"])
        await rm(this.profile(accountId, folder), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
    });
  }
  /** Stop owner login/workflow windows without deleting persistent signed-in profiles. */
  async stop(service: SocialService): Promise<void> {
    this.stopped = true;
    this.chromeReviews.clear();
    await this.chrome.stop();
    for (const flow of this.logins.values()) {
      flow.cancelled = true;
      await flow.session?.close().catch(() => undefined);
    }
    this.logins.clear();
    await this.platforms.stop();
    await this.workflows.stop(service);
    await Promise.all([...this.reads.keys()].map((id) => this.exclusive(id, async () => {})));
  }
  private async until<T>(
    page: BrowserPage,
    expression: string,
    timeoutMs: number,
  ): Promise<T | undefined> {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const value = await page.evaluate<T>(expression).catch(() => undefined);
      if (value) return value;
      if (this.now() >= deadline) return undefined;
      await this.wait(250);
    }
  }
  adapter(): SocialAdapter {
    const platforms = this.platforms.adapter();
    return {
      creatorInfo: platforms.creatorInfo,
      send: (account, job, token, media, checkpoint, beforeSubmit) =>
        account.platform === "x"
          ? this.exclusive(
              account.id,
              async () => await publishX(this.deps(), account, job, media, beforeSubmit),
            )
          : platforms.send(account, job, token, media, checkpoint, beforeSubmit),
      poll: (account, token, posts, cursor) =>
        account.platform === "x"
          ? this.exclusive(
              account.id,
              async () =>
                await runLayered(this.wiring, account.id, {
                  name: "poll",
                  recipe: () => pollX(this.deps(), account, posts, cursor),
                }),
              true,
            )
          : platforms.poll(account, token, posts, cursor),
    };
  }
  private async identity(page: BrowserPage, account: SocialAccount) {
    await xIdentity(page, account, this.directory);
  }
  /** Dependencies for the X inbox and send modules. Each module receives only these. */
  private deps(): XBrowserDeps {
    return {
      directory: this.directory,
      background: this.background,
      launcher: this.launcher
        ? (profile, background) => this.launchAt(basename(profile), profile, background)
        : undefined,
      limiter: this.limiter,
      now: this.now,
      profile: (accountId) => this.profile(accountId),
      identity: (page, account) =>
        runLayered(this.wiring, account.id, {
          name: "identity",
          recipe: () => this.identity(page, account),
        }),
      until: <T>(page: BrowserPage, expression: string, timeoutMs: number) =>
        this.until<T>(page, expression, timeoutMs),
      readSession: (accountId) => this.readSession(accountId),
      releaseRead: (accountId, session, success) => this.releaseRead(accountId, session, success),
    };
  }
}
