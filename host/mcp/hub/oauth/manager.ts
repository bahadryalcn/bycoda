import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SecretValueStore } from "../../../secrets/secret-store";
import { discover } from "./discovery";
import { oauthPage, type OAuthPageKind } from "./page";
import type { OAuthFetch } from "./net";
import { credentialId, DEFAULT_ACCOUNT, OAuthStore, type OAuthIndexEntry } from "./store";
import {
  authorizationUrl,
  exchangeCode,
  OAuthRejectedError,
  pkceChallenge,
  randomToken,
  refreshTokens,
  registerClient,
  revokeToken,
  type OAuthClient,
} from "./tokens";
import type { AuthServer } from "./discovery";

export const CALLBACK_DEADLINE_MS = 5 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const MAX_PENDING = 8;
const CALLBACK_ERRORS = new Set(["access_denied", "invalid_request", "server_error"]);

export type OAuthServerRef = { name: string; url: string };
export type OAuthState = "none" | "signed-in" | "expired" | "error";
export type OAuthStatusEntry = { name: string; state: OAuthState; error?: string };

export type McpOAuthOptions = {
  dataDir: string;
  values: SecretValueStore;
  fetch?: OAuthFetch;
  now?: () => number;
  callbackDeadlineMs?: number;
  /** Fired after a sign-in or sign-out so cached publications are rebuilt. */
  onChange?: () => void;
};

type Pending = {
  server: Server;
  timer: NodeJS.Timeout;
  expiresAt: number;
};

/** Host-held OAuth for HTTP MCP servers. Sign-in only ever starts from an owner RPC. */
export class McpOAuth {
  private readonly store: OAuthStore;
  private readonly doFetch: OAuthFetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, Pending>();
  private readonly refreshing = new Map<string, Promise<string | undefined>>();

  constructor(private readonly options: McpOAuthOptions) {
    this.store = new OAuthStore(options.dataDir, options.values);
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private entryFor(server: OAuthServerRef) {
    return this.store.entry(credentialId(server.name, server.url));
  }

  /** Owner has a Host sign-in for this server (any state but none). */
  async signedIn(server: OAuthServerRef): Promise<boolean> {
    return !!(await this.entryFor(server).catch(() => undefined));
  }

  async status(servers: OAuthServerRef[]): Promise<OAuthStatusEntry[]> {
    const entries = await this.store.entries();
    return servers.map((server) => {
      const entry = entries.find((item) => item.id === credentialId(server.name, server.url));
      if (!entry) return { name: server.name, state: "none" as const };
      const lapsed = entry.expiresAt !== undefined && entry.expiresAt <= this.now();
      const state =
        entry.state === "signed-in" && lapsed && !entry.refreshable ? "expired" : entry.state;
      return { name: server.name, state, ...(entry.error ? { error: entry.error } : {}) };
    });
  }

  /** Discovery, registration and a loopback listener; returns the URL the owner opens. */
  async start(server: OAuthServerRef): Promise<{ authorizationUrl: string; expiresAt: number }> {
    const id = credentialId(server.name, server.url);
    this.cancel(id);
    if (this.pending.size >= MAX_PENDING) throw new Error("Too many sign-ins in progress.");
    const found = await discover(this.doFetch, server.url);
    const verifier = randomToken(48);
    const state = randomToken(24);
    const deadline = this.options.callbackDeadlineMs ?? CALLBACK_DEADLINE_MS;
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    try {
      const port = (listener.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const client = await registerClient(this.doFetch, found.authServer, redirectUri);
      const expiresAt = this.now() + deadline;
      const timer = setTimeout(() => this.cancel(id), deadline);
      timer.unref();
      this.pending.set(id, { server: listener, timer, expiresAt });
      listener.on("request", (request, response) => {
        void this.callback(
          { id, server, state, verifier, redirectUri, client, found },
          port,
          request.url ?? "",
          request.headers.host,
          request.method,
          request.headers["accept-language"],
          response,
        ).catch(() => undefined);
      });
      return {
        authorizationUrl: authorizationUrl({
          server: found.authServer,
          client,
          redirectUri,
          state,
          challenge: pkceChallenge(verifier),
          resource: found.resource,
        }),
        expiresAt,
      };
    } catch (error) {
      listener.close();
      throw error;
    }
  }

  /** Stops listening. `graceful` lets the reply to the callback in flight finish. */
  private cancel(id: string, graceful = false) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.server.close();
    if (!graceful) entry.server.closeAllConnections();
    this.pending.delete(id);
  }

  private async callback(
    flow: {
      id: string;
      server: OAuthServerRef;
      state: string;
      verifier: string;
      redirectUri: string;
      client: OAuthClient;
      found: { resource: string; authServer: AuthServer };
    },
    port: number,
    path: string,
    host: string | undefined,
    method: string | undefined,
    acceptLanguage: string | undefined,
    response: import("node:http").ServerResponse,
  ) {
    const reply = (status: number, kind: OAuthPageKind) =>
      response
        .writeHead(status, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close",
        })
        .end(oauthPage(kind, acceptLanguage));
    // Anything but the exact loopback callback (DNS rebinding, stray requests) is ignored.
    if (method !== "GET" || host !== `127.0.0.1:${port}`) return reply(400, "invalid");
    const url = new URL(path, flow.redirectUri);
    if (url.pathname !== "/callback") return reply(404, "invalid");
    if (url.searchParams.get("state") !== flow.state) return reply(400, "invalid");
    // The state matched: this request is the one answer; the listener is spent either way.
    this.cancel(flow.id, true);
    const code = url.searchParams.get("code");
    const denied = url.searchParams.get("error");
    if (denied || !code) {
      await this.fail(flow.server, CALLBACK_ERRORS.has(denied ?? "") ? denied! : "denied");
      return reply(400, denied === "access_denied" ? "cancelled" : "failure");
    }
    try {
      const tokens = await exchangeCode(this.doFetch, {
        server: flow.found.authServer,
        client: flow.client,
        code,
        verifier: flow.verifier,
        redirectUri: flow.redirectUri,
        resource: flow.found.resource,
        now: this.now(),
      });
      await this.store.put(
        {
          id: flow.id,
          name: flow.server.name,
          url: flow.server.url,
          account: DEFAULT_ACCOUNT,
          state: "signed-in",
          expiresAt: tokens.expiresAt,
          refreshable: !!tokens.refreshToken,
        },
        {
          version: 1,
          resource: flow.found.resource,
          server: flow.found.authServer,
          client: flow.client,
          tokens,
        },
      );
      this.options.onChange?.();
      return reply(200, "success");
    } catch {
      await this.fail(flow.server, "exchange_failed");
      return reply(400, "failure");
    }
  }

  /** A failed attempt never downgrades an existing sign-in. */
  private async fail(server: OAuthServerRef, code: string) {
    const id = credentialId(server.name, server.url);
    if (await this.store.entry(id)) return;
    await this.store
      .mark({
        id,
        name: server.name,
        url: server.url,
        account: DEFAULT_ACCOUNT,
        state: "error",
        error: code,
      })
      .catch(() => undefined);
  }

  async signOut(server: OAuthServerRef): Promise<void> {
    const id = credentialId(server.name, server.url);
    this.cancel(id);
    const credential = await this.store.credential(id).catch(() => undefined);
    if (credential) {
      const token = credential.tokens.refreshToken ?? credential.tokens.accessToken;
      await revokeToken(this.doFetch, {
        revocationEndpoint: credential.server.revocationEndpoint,
        client: credential.client,
        token,
        hint: credential.tokens.refreshToken ? "refresh_token" : "access_token",
      });
    }
    await this.store.remove(id);
    this.options.onChange?.();
  }

  /** Fresh bearer header for a signed-in server, or undefined. Refresh is single-flight. */
  async httpAuth(server: OAuthServerRef): Promise<Record<string, string> | undefined> {
    const id = credentialId(server.name, server.url);
    if (!(await this.store.entry(id))) return undefined;
    let token = this.refreshing.get(id);
    if (!token) {
      token = this.freshToken(id, server).finally(() => this.refreshing.delete(id));
      this.refreshing.set(id, token);
    }
    const value = await token;
    return value ? { Authorization: `Bearer ${value}` } : undefined;
  }

  private async freshToken(id: string, server: OAuthServerRef): Promise<string | undefined> {
    const credential = await this.store.credential(id).catch(() => undefined);
    const base: OAuthIndexEntry = {
      id,
      name: server.name,
      url: server.url,
      account: DEFAULT_ACCOUNT,
      state: "signed-in",
    };
    if (!credential) {
      await this.store
        .mark({ ...base, state: "error", error: "credential_unavailable" })
        .catch(() => undefined);
      return undefined;
    }
    const { tokens } = credential;
    if (tokens.expiresAt - this.now() > REFRESH_SKEW_MS) return tokens.accessToken;
    if (!tokens.refreshToken) {
      await this.store
        .mark({ ...base, state: "expired", expiresAt: tokens.expiresAt, refreshable: false })
        .catch(() => undefined);
      return undefined;
    }
    try {
      const next = await refreshTokens(this.doFetch, {
        server: credential.server,
        client: credential.client,
        refreshToken: tokens.refreshToken,
        resource: credential.resource,
        now: this.now(),
      });
      await this.store.put(
        { ...base, expiresAt: next.expiresAt, refreshable: !!next.refreshToken },
        { ...credential, tokens: next },
      );
      return next.accessToken;
    } catch (error) {
      if (error instanceof OAuthRejectedError) {
        await this.store
          .mark({ ...base, state: "expired", expiresAt: tokens.expiresAt, refreshable: false })
          .catch(() => undefined);
        return undefined;
      }
      // Unreachable or failing server: keep the sign-in and use the old token while it lasts.
      return tokens.expiresAt > this.now() ? tokens.accessToken : undefined;
    }
  }

  close() {
    for (const id of Array.from(this.pending.keys())) this.cancel(id);
  }
}
