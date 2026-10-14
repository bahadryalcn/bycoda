import type { IncomingMessage, ServerResponse } from "node:http";
import type { SocialPlatform } from "../src/features/social/model/social";
import { SocialOAuth } from "./social-oauth";
import type { XBrowserSessions } from "./social-browser";
import type { SocialPrincipal, SocialService } from "./social";
import type { SocialOperation } from "../src/features/social/model/social";

export class SocialTransport {
  readonly oauth: SocialOAuth;
  constructor(
    readonly service: SocialService,
    private readonly browser?: XBrowserSessions,
  ) {
    this.oauth = new SocialOAuth(service);
  }
  async rpc(p: SocialPrincipal, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "social.tools.call") {
      if (p.kind !== "session") throw new Error("Use a host-issued session tool credential.");
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
    if (method === "social.request")
      return this.service.call(
        p,
        String(params.action ?? ""),
        this.input(params.input),
        typeof params.requestId === "string" ? params.requestId : undefined,
      );
    if (method === "social.oauth.availability") return this.oauth.availability();
    if (method === "social.oauth.begin")
      return this.oauth.begin(
        p,
        String(params.accountId ?? ""),
        typeof params.resourceId === "string" ? params.resourceId : undefined,
        params.operations as SocialOperation[] | undefined,
      );
    if (method === "social.oauth.status")
      return this.oauth.status(p, String(params.accountId ?? ""));
    if (method === "social.oauth.select")
      return this.oauth.select(p, String(params.accountId ?? ""), String(params.candidateId ?? ""));
    if (method.startsWith("social.browser.")) {
      if (!this.browser) throw new Error("Browser-session connection is unavailable on this host.");
      if (method === "social.browser.availability") return this.browser.availability();
      if (method === "social.browser.begin")
        return this.browser.begin(
          this.service,
          p,
          String(params.accountId ?? ""),
          params.acknowledgeRisk,
        );
      if (method === "social.browser.status")
        return this.browser.status(this.service, p, String(params.accountId ?? ""));
    }
    if (method === "social.media.upload")
      return params.mode
        ? this.service.uploadVideo(p, params)
        : this.service.uploadImage(p, String(params.base64 ?? ""));
    throw new Error("Unsupported social transport operation.");
  }
  private input(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Social input must be an object.");
    return value as Record<string, unknown>;
  }
  async http(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const parsed = new URL(request.url ?? "/", "http://localhost");
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
      /^\/social\/oauth\/(x|instagram|facebook|linkedin|youtube)\/callback$/,
    );
    const webhook = parsed.pathname.match(/^\/social\/webhooks\/(instagram|facebook)$/);
    if (!callback && !webhook) return false;
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
      const platform = webhook![1] as "instagram" | "facebook";
      const prefix = `BYCODA_SOCIAL_${platform.toUpperCase()}_`;
      const secret = process.env[`${prefix}CLIENT_SECRET`];
      const verifyToken = process.env[`${prefix}WEBHOOK_VERIFY_TOKEN`];
      if (!secret || !verifyToken) throw new Error("Webhook not configured.");
      if (request.method === "GET") {
        if (
          parsed.searchParams.get("hub.mode") !== "subscribe" ||
          parsed.searchParams.get("hub.verify_token") !== verifyToken
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
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error("Webhook too large.");
        chunks.push(Buffer.from(chunk));
      }
      const signature = request.headers["x-hub-signature-256"];
      if (typeof signature !== "string") throw new Error("Invalid webhook signature.");
      const result = this.service.webhook(platform, Buffer.concat(chunks), signature, secret);
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
