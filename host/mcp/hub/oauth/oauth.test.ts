import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpHub } from "../hub";
import type { InventoryDefinition } from "../inventory";
import { discover } from "./discovery";
import { McpOAuth } from "./manager";
import { oauthFetch } from "./net";
import { oauthRpc } from "./rpc";

const dirs: string[] = [];
const servers: Server[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  closers.splice(0).forEach((close) => close());
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SECRET_ACCESS = "access-secret-1";
const SECRET_REFRESH = "refresh-secret-1";

type Fake = {
  origin: string;
  url: string;
  requests: { path: string; body: string; auth?: string }[];
  tokenCalls: () => number;
  revoked: () => number;
  options: {
    lifetime: number;
    rejectRefresh: boolean;
    issuer?: string;
    metaIssuer?: string;
    rotate: boolean;
  };
  verifierOk: () => boolean | undefined;
  setChallenge: (value: string) => void;
};

/** One loopback server playing both the MCP resource and its authorization server. */
async function fakeServer(options: Partial<Fake["options"]> = {}, redirect = false): Promise<Fake> {
  const state = {
    tokens: 0,
    revoked: 0,
    challenge: "",
    verifierOk: undefined as boolean | undefined,
  };
  const opts = { lifetime: 3600, rejectRefresh: false, rotate: true, ...options };
  const requests: Fake["requests"] = [];
  let origin = "";
  const server = createServer(async (req: IncomingMessage, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const path = req.url ?? "";
    requests.push({ path, body, auth: req.headers.authorization });
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
      res
        .writeHead(status, { "Content-Type": "application/json", ...headers })
        .end(JSON.stringify(value));
    if (redirect && path === "/mcp")
      return void res.writeHead(302, { Location: "http://evil.example/x" }).end();
    if (path === "/mcp")
      return json(
        401,
        {},
        {
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      );
    if (path === "/.well-known/oauth-protected-resource/mcp")
      return json(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [opts.issuer ?? origin],
      });
    if (path === "/.well-known/oauth-authorization-server")
      return json(200, {
        issuer: opts.metaIssuer ?? opts.issuer ?? origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        code_challenge_methods_supported: ["S256"],
      });
    if (path === "/register") {
      const meta = JSON.parse(body);
      return json(201, { client_id: "client-1", redirect_uris: meta.redirect_uris });
    }
    if (path === "/revoke") {
      state.revoked++;
      return json(200, {});
    }
    if (path === "/token") {
      state.tokens++;
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code") {
        state.verifierOk =
          createHash("sha256")
            .update(form.get("code_verifier") ?? "")
            .digest("base64url") === state.challenge && form.get("resource") === `${origin}/mcp`;
        if (!state.verifierOk) return json(400, { error: "invalid_grant" });
      } else if (opts.rejectRefresh) return json(400, { error: "invalid_grant" });
      await new Promise((r) => setTimeout(r, 20));
      const n = state.tokens;
      return json(200, {
        access_token: n === 1 ? SECRET_ACCESS : `access-${n}`,
        token_type: "Bearer",
        expires_in: opts.lifetime,
        refresh_token: n === 1 ? SECRET_REFRESH : opts.rotate ? `refresh-${n}` : undefined,
      });
    }
    return json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The fake needs the challenge the client sent; the test hands it over via authorize.
  return {
    origin,
    url: `${origin}/mcp`,
    requests,
    tokenCalls: () => state.tokens,
    revoked: () => state.revoked,
    options: opts,
    verifierOk: () => state.verifierOk,
    setChallenge(value: string) {
      state.challenge = value;
    },
  };
}

function setup(fake: Fake, extra: { now?: () => number; callbackDeadlineMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-oauth-"));
  dirs.push(dir);
  const vault = new Map<string, string>();
  let changes = 0;
  const oauth = new McpOAuth({
    dataDir: dir,
    values: {
      get: async (ref) => vault.get(ref),
      set: async (ref, value) => void vault.set(ref, value),
      delete: async (ref) => void vault.delete(ref),
    },
    onChange: () => void changes++,
    ...extra,
  });
  closers.push(() => oauth.close());
  const server = { name: "remote", url: fake.url };
  /** Plays the browser: opens the authorization URL, then follows the redirect back. */
  async function signIn(stateOverride?: string) {
    const { authorizationUrl } = await oauth.start(server);
    const url = new URL(authorizationUrl);
    fake.setChallenge(url.searchParams.get("code_challenge")!);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", "code-1");
    back.searchParams.set("state", stateOverride ?? url.searchParams.get("state")!);
    return { url, response: await fetch(back) };
  }
  return { dir, oauth, server, vault, signIn, changes: () => changes };
}

const indexText = (dir: string) =>
  readFileSync(join(dir, "mcp-hub", "oauth", "index.json"), "utf8");

describe("discovery", () => {
  it("follows WWW-Authenticate to protected-resource and authorization-server metadata", async () => {
    const fake = await fakeServer();
    const found = await discover(fetch, fake.url);
    expect(found.resource).toBe(fake.url);
    expect(found.authServer.tokenEndpoint).toBe(`${fake.origin}/token`);
    expect(found.authServer.registrationEndpoint).toBe(`${fake.origin}/register`);
    expect(fake.requests.map((r) => r.path)).toEqual([
      "/mcp",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
    ]);
  });

  it("rejects metadata for a different issuer", async () => {
    const fake = await fakeServer({ metaIssuer: "https://other.example" });
    await expect(discover(fetch, fake.url)).rejects.toThrow(
      "Sign-in metadata does not match this server.",
    );
  });

  it("refuses redirects away from the server and non-loopback http", async () => {
    const fake = await fakeServer({}, true);
    await expect(oauthFetch(fetch, `${fake.origin}/mcp`)).rejects.toThrow(/redirected|not allowed/);
    await expect(oauthFetch(fetch, "http://example.com/x")).rejects.toThrow(/not allowed/);
  });

  it("enforces the deadline and response cap with fixed messages", async () => {
    const slow = createServer(() => undefined);
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    servers.push(slow);
    const port = (slow.address() as AddressInfo).port;
    await expect(oauthFetch(fetch, `http://127.0.0.1:${port}/`, {}, 50)).rejects.toThrow(
      "Sign-in request timed out.",
    );
    const big = createServer((_req, res) => res.end("x".repeat(300 * 1024)));
    await new Promise<void>((r) => big.listen(0, "127.0.0.1", r));
    servers.push(big);
    await expect(
      oauthFetch(fetch, `http://127.0.0.1:${(big.address() as AddressInfo).port}/`),
    ).rejects.toThrow("Sign-in response too large.");
  });
});

describe("McpOAuth sign-in", () => {
  it("registers a client, validates state, uses PKCE and the resource, and stores no secret in plain files", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    const { url, response } = await s.signIn();
    expect(response.status).toBe(200);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(fake.url);
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(new URL(url.searchParams.get("redirect_uri")!).hostname).toBe("127.0.0.1");
    expect(fake.verifierOk()).toBe(true);
    expect(await s.oauth.status([s.server])).toEqual([{ name: "remote", state: "signed-in" }]);
    expect(await s.oauth.httpAuth(s.server)).toEqual({ Authorization: `Bearer ${SECRET_ACCESS}` });
    expect(await s.oauth.signedIn(s.server)).toBe(true);
    expect(s.changes()).toBe(1);
    const index = indexText(s.dir);
    for (const secret of [SECRET_ACCESS, SECRET_REFRESH, "client-1"])
      expect(index).not.toContain(secret);
    expect([...s.vault.values()].join("")).toContain(SECRET_REFRESH);
    expect(JSON.stringify(await s.oauth.status([s.server]))).not.toContain(SECRET_ACCESS);
  });

  it("ignores a callback with the wrong state and still accepts the right one", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    const { authorizationUrl } = await s.oauth.start(s.server);
    const url = new URL(authorizationUrl);
    fake.setChallenge(url.searchParams.get("code_challenge")!);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", "c");
    back.searchParams.set("state", "forged");
    expect((await fetch(back)).status).toBe(400);
    expect(fake.tokenCalls()).toBe(0);
    back.searchParams.set("state", url.searchParams.get("state")!);
    expect((await fetch(back)).status).toBe(200);
    expect((await s.oauth.status([s.server]))[0].state).toBe("signed-in");
  });

  it("closes the loopback listener at the callback deadline", async () => {
    const fake = await fakeServer();
    const s = setup(fake, { callbackDeadlineMs: 60 });
    const { authorizationUrl } = await s.oauth.start(s.server);
    const back = new URL(new URL(authorizationUrl).searchParams.get("redirect_uri")!);
    await new Promise((r) => setTimeout(r, 150));
    await expect(fetch(back)).rejects.toThrow();
    expect((await s.oauth.status([s.server]))[0].state).toBe("none");
  });

  it("records an owner denial without leaking upstream text", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    const { authorizationUrl } = await s.oauth.start(s.server);
    const url = new URL(authorizationUrl);
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("state", url.searchParams.get("state")!);
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "secret-detail");
    expect((await fetch(back)).status).toBe(400);
    expect(await s.oauth.status([s.server])).toEqual([
      { name: "remote", state: "error", error: "access_denied" },
    ]);
  });
});

describe("McpOAuth tokens", () => {
  it("refreshes once for concurrent callers and rotates the refresh token", async () => {
    let now = 1_000_000;
    const fake = await fakeServer({ lifetime: 3600 });
    const s = setup(fake, { now: () => now });
    await s.signIn();
    expect(fake.tokenCalls()).toBe(1);
    now += 3600_000 - 30_000; // inside the 60 s refresh window
    const results = await Promise.all(Array.from({ length: 6 }, () => s.oauth.httpAuth(s.server)));
    expect(fake.tokenCalls()).toBe(2);
    expect(new Set(results.map((r) => r?.Authorization)).size).toBe(1);
    expect(results[0]?.Authorization).toBe("Bearer access-2");
    expect([...s.vault.values()].join("")).toContain("refresh-2");
    expect([...s.vault.values()].join("")).not.toContain(SECRET_REFRESH);
    expect(await s.oauth.httpAuth(s.server)).toEqual({ Authorization: "Bearer access-2" });
    expect(fake.tokenCalls()).toBe(2);
  });

  it("marks the sign-in expired when the refresh token is rejected", async () => {
    let now = 1_000_000;
    const fake = await fakeServer({ lifetime: 100, rejectRefresh: true });
    const s = setup(fake, { now: () => now });
    await s.signIn();
    now += 200_000;
    expect(await s.oauth.httpAuth(s.server)).toBeUndefined();
    expect((await s.oauth.status([s.server]))[0].state).toBe("expired");
    expect(await s.oauth.signedIn(s.server)).toBe(true);
  });

  it("returns nothing for a server that was never signed in", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    expect(await s.oauth.httpAuth(s.server)).toBeUndefined();
    expect(await s.oauth.signedIn(s.server)).toBe(false);
  });

  it("revokes and removes credentials on sign-out", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    await s.signIn();
    await s.oauth.signOut(s.server);
    expect(fake.revoked()).toBe(1);
    expect(s.vault.size).toBe(0);
    expect(await s.oauth.status([s.server])).toEqual([{ name: "remote", state: "none" }]);
    expect(await s.oauth.httpAuth(s.server)).toBeUndefined();
    expect(s.changes()).toBe(2);
  });

  it("does not put the refresh failure details or tokens into thrown errors", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    const bad = { name: "remote", url: `${fake.origin}/nope` };
    const error = await s.oauth.start(bad).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toMatch(/token|secret/i);
  });
});

describe("owner RPC and publication", () => {
  const http = (name: string, url: string): InventoryDefinition => ({
    name,
    source: "claude",
    sources: ["claude"],
    aliases: [{ provider: "claude", name }],
    kind: "http",
    url,
  });

  it("validates input, takes the URL from the inventory and returns no secrets", async () => {
    const fake = await fakeServer();
    const s = setup(fake);
    const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-oauth-hub-"));
    dirs.push(dir);
    const hub = new McpHub({
      dataDir: dir,
      inventory: async () => [http("remote", fake.url)],
      oauth: s.oauth,
      policy: async () => ({ version: 1, mode: "onDemand", direct: [] }),
    });
    await expect(oauthRpc(hub, "mcp.oauth.start", { name: "../x" })).rejects.toThrow(/Invalid/);
    await expect(oauthRpc(hub, "mcp.oauth.start", { name: "other" })).rejects.toThrow(
      "Unknown MCP server.",
    );
    expect(await oauthRpc(hub, "mcp.oauth.status", {})).toEqual({
      servers: [{ name: "remote", state: "none" }],
    });
    const started = (await oauthRpc(hub, "mcp.oauth.start", {
      name: "remote",
      url: "https://evil.example",
    })) as {
      authorizationUrl: string;
    };
    expect(started.authorizationUrl.startsWith(`${fake.origin}/authorize`)).toBe(true);
    expect(fake.requests.every((r) => !r.path.includes("evil"))).toBe(true);
  });

  it("treats a signed-in http server as hub-hosted: on demand unless direct", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-oauth-hub-"));
    dirs.push(dir);
    let direct: string[] = [];
    const signedIn = new Set(["signed"]);
    const hub = new McpHub({
      dataDir: dir,
      inventory: async () => [
        http("signed", "https://a.example/mcp"),
        http("plain", "https://b.example/mcp"),
      ],
      oauth: {
        signedIn: async (server: { name: string }) => signedIn.has(server.name),
        httpAuth: async () => undefined,
      } as never,
      policy: async () => ({ version: 1, mode: "onDemand", direct }),
      files: {
        claudeConfig: join(dir, "no.json"),
        pluginsDir: join(dir, "no-plugins"),
        codexConfig: join(dir, "config.toml"),
      },
      accountDirs: async () => ({ claude: [], codex: [] }),
    });
    let published = await hub.publication("http://127.0.0.1:4555");
    expect(published.servers.map((server) => server.name)).toEqual(["plain"]);
    expect(published.disable.claude).toEqual(["signed"]);
    direct = ["signed"];
    published = await hub.publication("http://127.0.0.1:4555");
    expect(published.servers.map((server) => server.name)).toEqual(["signed", "plain"]);
    expect(published.disable.claude).toEqual(["signed"]);
  });
});
