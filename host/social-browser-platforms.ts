import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SocialAccount, SocialPlatform } from "../src/features/social/model/social";
import { SocialPlatformError, type SocialAdapter } from "../src/integrations/social/adapter";
import {
  browserContentIssue,
  browserJobOperation,
  browserOperations,
} from "../src/integrations/social/browserCapabilities";
import { xMediaFormat } from "../src/integrations/social/xMedia";
import type { BrowserLauncher, BrowserPage, PlainBrowserLauncher } from "./social-browser";
import type { BrowserRecipe, BrowserRecipeContext } from "./social-browser-recipe";
import type { SocialPrincipal, SocialService } from "./social";

type Login = {
  status: "waiting" | "connected" | "failed";
  expiresAt: number;
  error?: string;
  cancelled?: boolean;
  close?: () => Promise<void>;
};
type Exclusive = <T>(id: string, action: () => Promise<T>) => Promise<T>;

/** Executes web recipes in the same isolated, serialized profile used for owner login. */
export class PlatformBrowserSessions {
  private stopped = false;
  private logins = new Map<string, Login>();
  private lastSend = new Map<string, number>();
  private recipes: Map<SocialPlatform, BrowserRecipe>;
  constructor(
    private directory: string,
    recipes: readonly BrowserRecipe[],
    private launcher: BrowserLauncher | undefined,
    private plain: PlainBrowserLauncher | undefined,
    private profile: (id: string) => string,
    private exclusive: Exclusive,
    private now: () => number,
    private wait: (ms: number) => Promise<unknown>,
    private background: boolean,
  ) {
    this.recipes = new Map(recipes.map((recipe) => [recipe.platform, recipe]));
  }
  private recipe(account: SocialAccount): BrowserRecipe {
    const recipe = this.recipes.get(account.platform);
    if (!recipe) throw new SocialPlatformError("unsupported");
    return recipe;
  }
  waiting(id: string): boolean {
    return this.logins.get(id)?.status === "waiting";
  }
  status(id: string) {
    const flow = this.logins.get(id);
    return flow ? { status: flow.status, error: flow.error } : { status: "idle" as const };
  }
  async begin(
    service: SocialService,
    principal: SocialPrincipal,
    account: SocialAccount,
    target?: string,
  ) {
    if (this.stopped) throw new Error("The browser executor is stopping.");
    const recipe = this.recipe(account);
    const connectionUrl = recipe.connectionUrl?.(account, target) ?? recipe.loginUrl;
    if (!this.launcher || !this.plain)
      throw new Error("Install Chrome or Edge on the account's executor host.");
    if (account.executorId !== service.store.environmentId)
      throw new Error("Sign in on the account's executor host.");
    if (this.waiting(account.id)) return this.logins.get(account.id)!;
    const flow: Login = { status: "waiting", expiresAt: this.now() + 10 * 60_000 };
    this.logins.set(account.id, flow);
    void this.exclusive(account.id, async () => {
      if (flow.cancelled) return;
      const window = await this.plain!(this.profile(account.id), connectionUrl);
      flow.close = () => window.close();
      let closed = false;
      void window.closed.then(() => {
        closed = true;
      });
      try {
        while (!closed) {
          if (flow.cancelled || this.now() >= flow.expiresAt)
            throw new Error("Browser login expired or was cancelled.");
          await this.wait(500);
        }
      } finally {
        delete flow.close;
        if (!closed) await window.close().catch(() => undefined);
      }
      if (flow.cancelled) return;
      const session = await this.launcher!(this.profile(account.id), true);
      try {
        await session.page.goto(connectionUrl);
        let identity: Awaited<ReturnType<BrowserRecipe["identity"]>>;
        for (let attempt = 0; attempt < 60 && !identity; attempt++) {
          if (flow.cancelled) return;
          identity = await recipe.identity(session.page, account).catch(() => undefined);
          if (!identity) await this.wait(500);
        }
        if (
          !identity ||
          !identity.platformId ||
          !identity.name ||
          identity.platformId.length > 300 ||
          (identity.accountType && identity.accountType !== account.accountType)
        )
          throw new Error("The signed-in identity or selected account type could not be verified.");
        const current = await service.accountForOAuth(principal, account.id);
        if (
          flow.cancelled ||
          current.executorId !== account.executorId ||
          (current.platformId && current.platformId !== identity.platformId)
        )
          throw new Error("The account changed. Use its previously connected identity.");
        await service.connectAccount(
          account.id,
          {
            platformId: identity.platformId,
            name: identity.name,
            scopes: browserOperations(account)
              .filter((operation) => recipe.operations.includes(operation))
              .map((operation) => `browser:${operation}`),
            accessApproved: true,
            connection: "browser",
          },
          { accessToken: "browser-session" },
        );
        flow.status = "connected";
      } finally {
        await session.close().catch(() => undefined);
      }
    }).catch(() => {
      flow.status = "failed";
      flow.error =
        "Browser identity verification failed. Complete login and any challenge in the dedicated window, then try again.";
    });
    return { status: flow.status, expiresAt: flow.expiresAt };
  }
  async forget(id: string) {
    const flow = this.logins.get(id);
    this.logins.delete(id);
    if (flow) {
      flow.cancelled = true;
      await flow.close?.().catch(() => undefined);
    }
    this.lastSend.delete(id);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    for (const id of this.logins.keys()) await this.forget(id);
  }
  private context(
    page: BrowserPage,
    account: SocialAccount,
    files: BrowserRecipeContext["files"],
    beforeSubmit?: () => Promise<void>,
    markSubmitted?: () => void,
  ): BrowserRecipeContext {
    const recipe = this.recipe(account);
    return {
      page,
      account,
      files,
      now: this.now,
      markSubmitted,
      waitFor: async <T>(expression: string, timeoutMs = 30_000) => {
        const deadline = this.now() + Math.min(120_000, Math.max(0, timeoutMs));
        for (let attempts = 0; attempts < 480; attempts++) {
          const value = await page.evaluate<T>(expression);
          if (value) return value;
          if (this.now() >= deadline) return undefined;
          await this.wait(250);
        }
        return undefined;
      },
      verifyIdentity: async () => {
        await beforeSubmit?.();
        let identity: Awaited<ReturnType<BrowserRecipe["identity"]>>;
        for (let attempt = 0; attempt < 60; attempt++) {
          identity = await recipe.identity(page, account);
          if (identity) break;
          await this.wait(500);
        }
        if (!identity) throw new SocialPlatformError("expired");
        if (
          identity.platformId !== account.platformId ||
          (identity.accountType && identity.accountType !== account.accountType)
        )
          throw new SocialPlatformError("denied");
        await beforeSubmit?.();
      },
    };
  }
  adapter(): SocialAdapter {
    return {
      creatorInfo: (account) =>
        this.exclusive(account.id, async () => {
          const recipe = this.recipe(account);
          if (!this.launcher || !recipe.creatorInfo) throw new SocialPlatformError("unsupported");
          const session = await this.launcher(this.profile(account.id), this.background);
          try {
            await session.page.goto(recipe.connectionUrl?.(account) ?? recipe.loginUrl);
            const context = this.context(session.page, account, []);
            await context.verifyIdentity();
            const result = await recipe.creatorInfo(context);
            await context.verifyIdentity();
            return result;
          } finally {
            await session.close().catch(() => undefined);
          }
        }),
      send: (account, job, _token, media, _checkpoint, beforeSubmit) =>
        this.exclusive(account.id, async () => {
          const recipe = this.recipe(account);
          if (!this.launcher || !recipe.operations.includes(browserJobOperation(job)))
            throw new SocialPlatformError("unsupported");
          if (browserContentIssue(account, job)) throw new SocialPlatformError("unsupported");
          const last = this.lastSend.get(account.id);
          if (last !== undefined && this.now() - last < 30_000)
            throw new SocialPlatformError("rate_limit", last + 30_000);
          await beforeSubmit?.();
          const staging = join(this.directory, "browser-uploads", randomUUID());
          try {
            const files: BrowserRecipeContext["files"] = [];
            for (const [index, attachment] of job.payload.media.entries()) {
              const bytes = await media(attachment.uploadId!);
              const webm =
                account.platform === "youtube" &&
                bytes.length >= 12 &&
                [0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => bytes[index] === byte);
              const format =
                attachment.kind === "document" ? "pdf" : webm ? "webm" : xMediaFormat(bytes);
              if (
                attachment.kind !== "document" &&
                (attachment.kind === "video") !== (format === "mp4" || format === "webm")
              )
                throw new SocialPlatformError("rejected");
              await mkdir(staging, { recursive: true, mode: 0o700 });
              const path = join(staging, `${index}.${format}`);
              await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
              files.push({ path, kind: attachment.kind });
            }
            const session = await this.launcher(this.profile(account.id), this.background);
            try {
              await session.page.goto(recipe.connectionUrl?.(account) ?? recipe.loginUrl);
              let submitted = false;
              const context = this.context(session.page, account, files, beforeSubmit, () => {
                submitted = true;
              });
              await context.verifyIdentity();
              this.lastSend.set(account.id, this.now());
              let result: Awaited<ReturnType<BrowserRecipe["send"]>>;
              try {
                result = await recipe.send(context, job);
              } catch (error) {
                if (submitted) throw new SocialPlatformError("unknown");
                throw error;
              }
              if (!result.platformId || result.platformId.length > 1000)
                throw new SocialPlatformError("unknown");
              try {
                await this.context(session.page, account, files).verifyIdentity();
              } catch {
                throw new SocialPlatformError("unknown");
              }
              return result;
            } finally {
              await session.close().catch(() => undefined);
            }
          } finally {
            await rm(staging, { recursive: true, force: true }).catch(() => undefined);
          }
        }),
      poll: (account, _token, posts, cursor) =>
        this.exclusive(account.id, async () => {
          const recipe = this.recipe(account);
          if (!this.launcher || !recipe.operations.includes("poll"))
            throw new SocialPlatformError("unsupported");
          const session = await this.launcher(this.profile(account.id), this.background);
          try {
            await session.page.goto(recipe.connectionUrl?.(account) ?? recipe.loginUrl);
            const context = this.context(session.page, account, []);
            await context.verifyIdentity();
            const result = await recipe.poll(context, posts.slice(-100), cursor);
            await context.verifyIdentity();
            if (
              !Array.isArray(result.events) ||
              result.events.length > 500 ||
              (result.cursor?.length ?? 0) > 64_000
            )
              throw new SocialPlatformError("unknown");
            return result;
          } finally {
            await session.close().catch(() => undefined);
          }
        }),
    };
  }
}
