import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SocialPlatform } from "../../src/features/social/model/social";
import { liveViewFrame, liveViewInput } from "./browser-layers/live-view";
import { SocialOAuth } from "./social-oauth";
import { receiveTelegramWebhook } from "./inbox/social-webhooks";
import { SocialTokenConnections } from "./social-token-connections";
import type { XBrowserSessions } from "./social-browser-x";
import type { SocialPrincipal, SocialService } from "./social";
import type { SocialOperation } from "../../src/features/social/model/social";
import type { SocialBrowserIntent } from "../../src/features/social/model/socialBrowser";
import { assertLivePage } from "./facebook-live/actions";
import { readLiveEncoder } from "./facebook-live/receipts";
import { facebookLiveId } from "../../src/integrations/social/adapters/facebook-live";

/** Constant-time comparison; both sides are hashed first so a length difference does not leak through timing. */
function sameSecret(actual: string | null, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual ?? ""), digest(expected));
}

/** Reads a webhook body up to 1 MiB; larger bodies are refused before parsing. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Webhook too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class SocialTransport {
  readonly oauth: SocialOAuth;
  readonly tokens: SocialTokenConnections;
  constructor(
    readonly service: SocialService,
    private readonly browser?: XBrowserSessions,
  ) {
    this.oauth = new SocialOAuth(service);
    this.tokens = new SocialTokenConnections(service);
    // Snapchat owner reviews and account-scoped browser reads use the same verified session.
    if (browser)
      service.snapchatBrowserProfile = (principal, accountId, action, input) =>
        browser.snapchatProfileAction(service, principal, accountId, action, input);
  }
  async rpc(p: SocialPrincipal, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "social.tools.call") {
      if (p.kind !== "session" && p.kind !== "assistant-thread")
        throw new Error("Use a host-issued session or Assistant tool credential.");
      const action = String(params.action ?? "");
      if (!this.service.isTool(action)) throw new Error("Unsupported social tool.");
      return this.service.call(
        p,
        action,
        this.input(params.input),
        typeof params.requestId === "string" ? params.requestId : undefined,
      );
    }
    if (p.kind !== "owner")
      throw new Error("Social administration requires an owner device credential.");
    // X Live custody uses a separate owner-only path with a receipt that contains no key.
    if (method === "social.x.liveKey.store")
      return this.service.saveXLiveKey(
        p,
        String(params.accountId ?? ""),
        params.key,
        params.server,
      );
    // Facebook encoder credentials bypass registry results and never enter Social receipts.
    if (method === "social.facebook.live.encoder") {
      const account = await this.service.accountForOAuth(p, String(params.accountId ?? ""));
      assertLivePage(account, this.service.store.environmentId);
      const liveId = facebookLiveId(params.liveId);
      await this.service.store.db.checkAuthorization();
      const encoder = await readLiveEncoder(
        this.service,
        this.service.credentials,
        account.id,
        account.platformId,
        liveId,
      );
      const latest = await this.service.accountForOAuth(p, account.id);
      assertLivePage(latest, this.service.store.environmentId);
      if (latest.platformId !== account.platformId) throw new Error("Facebook Page changed.");
      return encoder;
    }
    if (method === "social.request")
      return this.service.call(
        p,
        String(params.action ?? ""),
        this.input(params.input),
        typeof params.requestId === "string" ? params.requestId : undefined,
      );
    if (method === "social.oauth.availability")
      return { ...this.oauth.availability(), ...this.tokens.availability() };
    if (method === "social.token.connect")
      return this.tokens.connect(
        p,
        String(params.accountId ?? ""),
        typeof params.reviewId === "string" ? params.reviewId : undefined,
      );
    if (method === "social.token.inspect")
      return this.tokens.inspectTelegramChannel(
        p,
        String(params.accountId ?? ""),
        typeof params.target === "string" ? params.target : "",
      );
    if (method === "social.monitoring.status")
      return this.service.monitoringStatus(p, String(params.accountId ?? ""));
    if (method === "social.tiktok.creator")
      return this.service.tiktokCreator(p, String(params.accountId ?? ""));
    if (method === "social.oauth.begin")
      return this.oauth.begin(
        p,
        String(params.accountId ?? ""),
        typeof params.resourceId === "string" ? params.resourceId : undefined,
        params.operations as SocialOperation[] | undefined,
        ...(params.linkedinLiveComments === true ? [true as const] : []),
      );
    if (method === "social.oauth.status")
      return this.oauth.status(p, String(params.accountId ?? ""));
    if (method === "social.oauth.select")
      return this.oauth.select(p, String(params.accountId ?? ""), String(params.candidateId ?? ""));
    if (method.startsWith("social.browser.")) {
      if (!this.browser) throw new Error("Browser-session connection is unavailable on this host.");
      // Facebook-only, read-only Business Suite overview.
      if (method === "social.browser.facebook.monetization")
        return this.browser.facebookMonetization(this.service, p, String(params.accountId ?? ""));
      if (method === "social.browser.availability")
        return params.existingChrome === true
          ? this.browser.chromeTabs(
              this.service,
              p,
              String(params.accountId ?? ""),
              params.acknowledgeChromeAccess,
            )
          : this.browser.availability();
      if (method === "social.browser.view.frame")
        return liveViewFrame(String(params.accountId ?? ""), params.after);
      if (method === "social.browser.view.input")
        return liveViewInput(String(params.accountId ?? ""), params.event);
      if (method === "social.browser.instagram.live")
        return this.browser.instagramLiveAction(
          this.service,
          p,
          String(params.accountId ?? ""),
          params,
        );
      // Instagram owner-only browser operations.
      switch (method) {
        case "social.browser.instagram.post":
        case "social.browser.instagram.followers":
        case "social.browser.instagram.follow":
        case "social.browser.instagram.mentions":
        case "social.browser.instagram.comment-like":
        case "social.browser.instagram.recipient":
        case "social.browser.instagram.earnings":
        case "social.browser.instagram.highlights":
        case "social.browser.instagram.highlight-change":
          return this.browser.instagramAction(
            this.service,
            p,
            String(params.accountId ?? ""),
            method.slice("social.browser.instagram.".length) as
              | "post"
              | "followers"
              | "follow"
              | "mentions"
              | "comment-like"
              | "recipient"
              | "earnings"
              | "highlights"
              | "highlight-change",
            params,
          );
      }
      // LinkedIn owner-only browser analytics.
      if (method === "social.browser.linkedin.analytics.profile")
        return this.browser.linkedInProfileAnalytics(
          this.service,
          p,
          String(params.accountId ?? ""),
        );
      if (method === "social.browser.linkedin.manage")
        return this.browser.linkedInBrowserManagement(this.service, p, params);
      if (
        [
          "social.browser.profile.read",
          "social.browser.profile.update",
          "social.browser.profile.follow",
        ].includes(method)
      )
        return this.browser.profileAction(
          this.service,
          p,
          String(params.accountId ?? ""),
          method.split(".").at(-1) as "read" | "update" | "follow",
          params,
        );
      if (method === "social.browser.workflow.begin")
        return this.browser.workflowBegin(
          this.service,
          p,
          String(params.accountId ?? ""),
          params.intent as SocialBrowserIntent,
          params.targetUrl,
          params.acknowledgeRisk,
          params.registration,
        );
      if (method === "social.browser.workflow.status")
        return this.browser.workflows.status(this.service, p, String(params.accountId ?? ""));
      if (method === "social.browser.workflow.cancel")
        return params.loginFlow === true
          ? this.browser.cancelLogin(this.service, p, String(params.accountId ?? ""))
          : this.browser.workflows.cancel(
              this.service,
              p,
              String(params.accountId ?? ""),
              typeof params.workflowId === "string" ? params.workflowId : undefined,
            );
      if (method === "social.browser.registration.review")
        return this.browser.workflows.reviewRegistration(this.service, p, {
          accountId: String(params.accountId ?? ""),
          workflowId: String(params.workflowId ?? ""),
          expectedUpdatedAt: Number(params.expectedUpdatedAt),
        });
      if (method === "social.browser.registration.submit")
        return this.browser.workflows.submitRegistration(this.service, p, {
          accountId: String(params.accountId ?? ""),
          workflowId: String(params.workflowId ?? ""),
          expectedUpdatedAt: Number(params.expectedUpdatedAt),
          reviewId: params.reviewId,
          confirm: params.confirm,
        });
      if (method === "social.browser.registration.advance")
        return this.browser.workflows.advanceRegistration(this.service, p, {
          accountId: String(params.accountId ?? ""),
          workflowId: String(params.workflowId ?? ""),
          expectedUpdatedAt: Number(params.expectedUpdatedAt),
          registration: params.registration,
        });
      if (method === "social.browser.registration.reconcile")
        return this.browser.workflows.reconcileRegistration(this.service, p, {
          accountId: String(params.accountId ?? ""),
          workflowId: String(params.workflowId ?? ""),
          expectedUpdatedAt: Number(params.expectedUpdatedAt),
          resourceId: params.resourceId,
        });
      if (method === "social.browser.begin")
        return this.browser.begin(
          this.service,
          p,
          String(params.accountId ?? ""),
          params.acknowledgeRisk,
          typeof params.resourceId === "string" ? params.resourceId : undefined,
          params.existingChrome === true
            ? {
                targetId: String(params.chromeTargetId ?? ""),
                acknowledgeAccess: params.acknowledgeChromeAccess,
              }
            : undefined,
        );
      if (method === "social.browser.status")
        return this.browser.status(
          this.service,
          p,
          String(params.accountId ?? ""),
          params.loginFlow === true,
        );
    }
    if (
      method === "social.media.claim" ||
      method === "social.media.transfer" ||
      method === "social.media.releaseLogical"
    )
      return this.service.mediaEditorClaim(
        p,
        method.slice("social.media.".length) as "claim" | "transfer" | "releaseLogical",
        params,
      );
    if (method === "social.media.upload")
      return params.mode
        ? this.service.uploadVideo(p, params)
        : this.service.uploadImage(
            p,
            String(params.base64 ?? ""),
            params.kind === "document" ? "document" : "image",
          );
    throw new Error("Unsupported social transport operation.");
  }
  private input(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Social input must be an object.");
    return value as Record<string, unknown>;
  }
  async http(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const parsed = new URL(request.url ?? "/", "http://localhost");
    const instagramAttachment = parsed.pathname.match(
      /^\/social\/media\/instagram-direct\/([a-f0-9-]{36})$/,
    );
    if (instagramAttachment) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      try {
        if (request.method !== "GET" && request.method !== "HEAD")
          throw new Error("Unsupported media method.");
        const { bytes, mime } = await this.service.readInstagramAttachment(
          instagramAttachment[1],
          parsed.searchParams,
        );
        response.setHeader("Content-Type", mime);
        response.setHeader("Content-Length", bytes.length);
        response.end(request.method === "GET" ? bytes : undefined);
      } catch {
        response.statusCode = 404;
        response.end("Media unavailable.");
      }
      return true;
    }
    const media = parsed.pathname.match(/^\/social\/media\/([a-f0-9-]{36})$/);
    if (media) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      try {
        if (request.method !== "GET") throw new Error("Unsupported media method.");
        const bytes = await this.service.publicMedia(
          media[1],
          parsed.searchParams.get("expires"),
          parsed.searchParams.get("token"),
        );
        response.setHeader("Content-Type", bytes[0] === 0x89 ? "image/png" : "image/jpeg");
        response.end(bytes);
      } catch {
        response.statusCode = 404;
        response.end("Media unavailable.");
      }
      return true;
    }
    const callback = parsed.pathname.match(
      /^\/social\/oauth\/(x|instagram|facebook|linkedin|youtube|tiktok|snapchat)\/callback$/,
    );
    const webhook = parsed.pathname.match(/^\/social\/webhooks\/(instagram|facebook|whatsapp)$/);
    const telegram = parsed.pathname.match(
      /^\/social\/webhooks\/telegram\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    );
    if (!callback && !webhook && !telegram) return false;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (callback) {
        if (request.method !== "GET") throw new Error("Unsupported OAuth method.");
        await this.oauth.callback(callback[1] as SocialPlatform, parsed.searchParams);
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        response.end(
          "<!doctype html><title>bycoda Social Media</title><p>OAuth identity verified. Return to bycoda to choose the account.</p>",
        );
        return true;
      }
      if (telegram) {
        if (request.method !== "POST") throw new Error("Unsupported webhook method.");
        const raw = await readBody(request);
        const result = await this.service.operation(async () => {
          await this.service.ready;
          return await receiveTelegramWebhook(
            this.service,
            telegram[1]!,
            raw,
            request.headers["x-telegram-bot-api-secret-token"],
          );
        });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(result));
        return true;
      }
      const platform = webhook![1] as "instagram" | "facebook" | "whatsapp";
      const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
      const secret = process.env[`${prefix}CLIENT_SECRET`];
      const verifyToken = process.env[`${prefix}WEBHOOK_VERIFY_TOKEN`];
      if (!secret || !verifyToken) throw new Error("Webhook not configured.");
      if (request.method === "GET") {
        if (
          parsed.searchParams.get("hub.mode") !== "subscribe" ||
          !sameSecret(parsed.searchParams.get("hub.verify_token"), verifyToken)
        )
          throw new Error("Invalid webhook challenge.");
        const challenge = parsed.searchParams.get("hub.challenge");
        if (!challenge || !/^\d{1,100}$/.test(challenge))
          throw new Error("Invalid webhook challenge.");
        response.setHeader("Content-Type", "text/plain");
        response.end(challenge);
        return true;
      }
      if (request.method !== "POST") throw new Error("Unsupported webhook method.");
      const body = await readBody(request);
      const signature = request.headers["x-hub-signature-256"];
      if (typeof signature !== "string") throw new Error("Invalid webhook signature.");
      const result = await this.service.webhook(platform, body, signature, secret);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch {
      // Never echo callback query, platform token response, raw inbound payload or signature.
      response
        .writeHead(400)
        .end("Social callback/event was rejected. Review the account in bycoda.");
    }
    return true;
  }
}
