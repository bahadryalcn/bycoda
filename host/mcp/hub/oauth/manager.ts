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

export type OAuthServerRef = {
  name: string;
  url: string;
  account?: string;
  /** Only inherited provider entries may use the legacy owner sign-in. */
  inheritOwner?: boolean;
};
export type OAuthState = "none" | "signed-in" | "expired" | "error";
export type OAuthStatusEntry = {
  name: string;
  state: OAuthState;
  error?: string;
  inherited?: true;
};

export type McpOAuthOptions = {
  dataDir: string;
  values: SecretValueStore;
  fetch?: OAuthFetch;
  now?: () => number;
  callbackDeadlineMs?: number;
  /** Fired after a sign-in or sign-out so cached publications are rebuilt. */
  onChange?: () => void;
};

type OAuthFlow = {
  id: string;
  server: OAuthServerRef;
  state: string;
  verifier: string;
  redirectUri: string;
  client: OAuthClient;
  found: { resource: string; authServer: AuthServer };
};
type Pending = {
  flow: OAuthFlow;
  listener?: Server;
  timer: NodeJS.Timeout;
  expiresAt: number;
};
type CallbackInput = { state: string; code?: string; error?: string };
type CallbackStatus = Exclude<OAuthPageKind, "invalid">;

const idFor = (server: OAuthServerRef) => credentialId(server.name, server.url, server.account);

/** Host-held OAuth for HTTP MCP servers. Sign-in only ever starts from an owner RPC. */
export class McpOAuth {
  private readonly store: OAuthStore;
  private readonly doFetch: OAuthFetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, Pending>();
  private readonly refreshing = new Map<string, Promise<string | undefined>>();
  private readonly signingOut = new Set<string>();
  private readonly exchanging = new Map<string, Promise<unknown>>();
  private readonly starting = new Map<string, object>();

  constructor(private readonly options: McpOAuthOptions) {
    this.store = new OAuthStore(options.dataDir, options.values);
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private entryFor(server: OAuthServerRef) {
    return this.store.entry(idFor(server));
  }

  /** Owner has a Host sign-in for this server (any state but none). */
  async signedIn(server: OAuthServerRef): Promise<boolean> {
    const entry = await this.entryFor(server).catch(() => undefined);
    return !!entry && entry.state !== "none";
  }

  /** An explicit project sign-out also suppresses inherited owner OAuth. */
  async hasAccountState(server: OAuthServerRef): Promise<boolean> {
    return this.signingOut.has(idFor(server)) || !!(await this.entryFor(server));
  }

  async status(servers: OAuthServerRef[]): Promise<OAuthStatusEntry[]> {
    const entries = await this.store.entries();
    return servers.map((server) => {
      const own = entries.find((item) => item.id === idFor(server));
      const inherited =
        !own && server.inheritOwner
          ? entries.find((item) => item.id === credentialId(server.name, server.url))
          : undefined;
      const entry = own ?? inherited;
      if (!entry) return { name: server.name, state: "none" as const };
      const lapsed = entry.expiresAt !== undefined && entry.expiresAt <= this.now();
      const state =
        entry.state === "signed-in" && lapsed && !entry.refreshable ? "expired" : entry.state;
      return {
        name: server.name,
        state,
        ...(entry.error ? { error: entry.error } : {}),
        ...(inherited ? { inherited: true as const } : {}),
      };
    });
  }

  /** Discovery, registration and a loopback listener; returns the URL the owner opens. */
  async start(
    server: OAuthServerRef,
    callbackPort?: number,
  ): Promise<{ authorizationUrl: string; expiresAt: number }> {
    const id = idFor(server);
    if (this.signingOut.has(id) || this.exchanging.has(id) || this.starting.has(id))
      throw new Error("MCP sign-in is already changing.");
    this.cancel(id);
    if (this.pending.size + this.starting.size >= MAX_PENDING)
      throw new Error("Too many sign-ins in progress.");
    const attempt = {};
    this.starting.set(id, attempt);
    try {
      return await this.startCallback(server, id, attempt, callbackPort);
    } finally {
      if (this.starting.get(id) === attempt) this.starting.delete(id);
    }
  }

  private async startCallback(
    server: OAuthServerRef,
    id: string,
    attempt: object,
    callbackPort?: number,
  ) {
    const found = await discover(this.doFetch, server.url);
    const verifier = randomToken(48);
    const state = randomToken(24);
    const deadline = this.options.callbackDeadlineMs ?? CALLBACK_DEADLINE_MS;
    const listener = callbackPort === undefined ? createServer() : undefined;
    try {
      if (listener)
        await new Promise<void>((resolve, reject) => {
          listener.once("error", reject);
          listener.listen(0, "127.0.0.1", resolve);
        });
      const port = callbackPort ?? (listener!.address() as AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const client = await registerClient(this.doFetch, found.authServer, redirectUri);
      if (this.starting.get(id) !== attempt) throw new Error("MCP sign-in was cancelled.");
      const url = authorizationUrl({
        server: found.authServer,
        client,
        redirectUri,
        state,
        challenge: pkceChallenge(verifier),
        resource: found.resource,
      });
      const expiresAt = this.now() + deadline;
      const timer = setTimeout(() => this.cancel(id), deadline);
      timer.unref();
      const flow = { id, server, state, verifier, redirectUri, client, found };
      this.pending.set(id, { flow, listener, timer, expiresAt });
      listener?.on("request", (request, response) => {
        void this.callback(
          flow,
          port,
          request.url ?? "",
          request.headers.host,
          request.method,
          request.headers["accept-language"],
          response,
        ).catch(() => undefined);
      });
      return {
        authorizationUrl: url,
        expiresAt,
      };
    } catch (error) {
      listener?.close();
      throw error;
    }
  }

  /** Stops listening. `graceful` lets the reply to the callback in flight finish. */
  private cancel(id: string, graceful = false) {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.listener?.close();
    if (!graceful) entry.listener?.closeAllConnections();
    this.pending.delete(id);
  }

  /** Cancel only the requested attempt, leaving any saved credentials untouched. */
  cancelSignIn(server: OAuthServerRef, state: string): boolean {
    const id = idFor(server);
    if (this.pending.get(id)?.flow.state !== state) return false;
    this.cancel(id);
    return true;
  }

  private async callback(
    flow: OAuthFlow,
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
    const pending = this.pendingFor(flow.id, url.searchParams.get("state"), false);
    if (!pending) return reply(400, "invalid");
    const status = await this.consume(pending, {
      code: url.searchParams.get("code") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
    });
    return reply(status === "success" ? 200 : 400, status);
  }

  completeRelay(server: OAuthServerRef, input: CallbackInput): Promise<CallbackStatus> {
    const pending = this.pendingFor(idFor(server), input.state, true);
    if (!pending) throw new Error("MCP sign-in callback is invalid or expired.");
    return this.consume(pending, input);
  }

  private pendingFor(id: string, state: string | null, relay: boolean) {
    const pending = this.pending.get(id);
    if (
      !pending ||
      !pending.listener !== relay ||
      pending.expiresAt <= this.now() ||
      pending.flow.state !== state
    )
      return undefined;
    return pending;
  }

  private async consume(pending: Pending, input: { code?: string; error?: string }) {
    const { flow } = pending;
    // Consume the exact attempt before exchanging, even if the provider declines the request.
    this.cancel(flow.id, true);
    if (this.signingOut.has(flow.id)) return "cancelled" as const;
    const completion = this.completeCallback(flow, input);
    this.exchanging.set(flow.id, completion);
    try {
      return await completion;
    } finally {
      this.exchanging.delete(flow.id);
    }
  }

  private async completeCallback(
    flow: OAuthFlow,
    { code, error: denied }: { code?: string; error?: string },
  ): Promise<CallbackStatus> {
    if (denied || !code) {
      await this.fail(flow.server, CALLBACK_ERRORS.has(denied ?? "") ? denied! : "denied");
      return denied === "access_denied" ? "cancelled" : "failure";
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
          account: flow.server.account ?? DEFAULT_ACCOUNT,
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
      return "success";
    } catch {
      await this.fail(flow.server, "exchange_failed");
      return "failure";
    }
  }

  /** A failed attempt never downgrades an existing sign-in. */
  private async fail(server: OAuthServerRef, code: string) {
    const id = idFor(server);
    const existing = await this.store.entry(id);
    if (existing && existing.state !== "none") return;
    await this.store
      .mark({
        id,
        name: server.name,
        url: server.url,
        account: server.account ?? DEFAULT_ACCOUNT,
        state: "error",
        error: code,
      })
      .then(() => this.options.onChange?.())
      .catch(() => undefined);
  }

  async signOut(server: OAuthServerRef): Promise<void> {
    const id = idFor(server);
    if (this.signingOut.has(id)) throw new Error("MCP sign-out is already in progress.");
    this.signingOut.add(id);
    try {
      await this.finishSignOut(server, id);
    } finally {
      this.signingOut.delete(id);
    }
  }

  private async finishSignOut(server: OAuthServerRef, id: string): Promise<void> {
    this.starting.delete(id);
    this.cancel(id);
    await this.exchanging.get(id)?.catch(() => undefined);
    await this.refreshing.get(id)?.catch(() => undefined);
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
    if (server.account) {
      await this.store.signOutProject({
        id,
        name: server.name,
        url: server.url,
        account: server.account,
        state: "none",
      });
    } else {
      await this.store.remove(id);
    }
    this.options.onChange?.();
  }

  /** Fresh bearer header for a signed-in server, or undefined. Refresh is single-flight. */
  async httpAuth(server: OAuthServerRef): Promise<Record<string, string> | undefined> {
    const id = idFor(server);
    const entry = await this.store.entry(id);
    if (!entry || entry.state === "none" || this.signingOut.has(id)) return undefined;
    let token = this.refreshing.get(id);
    if (!token) {
      token = this.freshToken(id, server).finally(() => this.refreshing.delete(id));
      this.refreshing.set(id, token);
    }
    const value = await token;
    return value && !this.signingOut.has(id) ? { Authorization: `Bearer ${value}` } : undefined;
  }

  private async freshToken(id: string, server: OAuthServerRef): Promise<string | undefined> {
    const credential = await this.store.credential(id).catch(() => undefined);
    const base: OAuthIndexEntry = {
      id,
      name: server.name,
      url: server.url,
      account: server.account ?? DEFAULT_ACCOUNT,
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
    this.starting.clear();
    for (const id of Array.from(this.pending.keys())) this.cancel(id);
  }
}
