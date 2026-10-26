import { afterEach, expect, it, vi } from "vitest";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { SessionToolsRelay, type SessionToolGroup } from "./session-tools-relay";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";

const scope = {
  sessionId: "session",
  projectId: "project",
  provider: "codex",
  environmentId: "environment",
};
const methods = {
  conversation: "conversation.tools.call",
  "runtime-logs": "runtimeLogs.tools.call",
  social: "social.tools.call",
};
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});
async function fixture(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
  timeout?: number,
) {
  const upstream = createServer(handle);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as { port: number };
  const relay = new SessionToolsRelay(timeout);
  cleanups.push(async () => {
    await relay.close();
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
  });
  return { relay, upstream: `http://127.0.0.1:${address.port}` };
}
const grant = (token = "private-upstream-token") => ({
  token,
  expiresAt: Date.now() + 1000,
  scope,
});
const body = (group: SessionToolGroup) => ({
  version: HOST_PROTOCOL_VERSION,
  environmentId: scope.environmentId,
  method: methods[group],
  params: { action: "tools.list", input: {} },
});
const request = (
  endpoint: string,
  token: string,
  input = body("conversation"),
  path = "/rpc",
  headers: Record<string, string> = {},
) =>
  fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(input),
  });

it.each(["conversation", "runtime-logs", "social"] as const)(
  "renews only pre-dispatch rejected %s grants without exposing private tokens",
  async (group) => {
    const calls: string[] = [];
    const f = await fixture((req, res) => {
      calls.push(req.headers.authorization!);
      if (req.headers.authorization === "Bearer private-upstream-token") {
        res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
        res.end("expired");
      } else res.end(JSON.stringify({ result: req.headers.authorization }));
    });
    const renew = vi.fn(async () => grant("renewed-private-token"));
    const cap = await f.relay.create({ group, upstream: f.upstream, grant: grant(), renew });
    expect(cap.token).not.toBe(grant().token);
    const response = await request(cap.endpoint, cap.token, body(group));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"result":"Bearer [session credential redacted]"}');
    expect(renew).toHaveBeenCalledExactlyOnceWith(scope);
    const mcp = await request(
      cap.endpoint,
      cap.token,
      { jsonrpc: "2.0", method: "tools/list", params: {} } as never,
      `/mcp/${group}`,
    );
    expect(mcp.status).toBe(200);
    expect(calls).toHaveLength(3);
  },
);

it.each([401, 500, 302])(
  "never replays an unmarked HTTP %s, even if it follows a side effect",
  async (status) => {
    let effects = 0;
    const f = await fixture((_req, res) => {
      effects++;
      res.writeHead(status, { Location: "http://127.0.0.1:1" });
      res.end("failed");
    });
    const renew = vi.fn(async () => grant("fresh"));
    const cap = await f.relay.create({
      group: "conversation",
      upstream: f.upstream,
      grant: grant(),
      renew,
    });
    expect((await request(cap.endpoint, cap.token)).status).toBe(status === 302 ? 502 : status);
    expect(effects).toBe(1);
    expect(renew).not.toHaveBeenCalled();
  },
);

it("never retries a disconnected upstream or a second marked rejection", async () => {
  let calls = 0;
  const f = await fixture((_req, res) => {
    calls++;
    if (calls === 1) res.destroy();
    else {
      res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
      res.end();
    }
  });
  const renew = vi.fn(async () => grant("fresh"));
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew,
  });
  expect((await request(cap.endpoint, cap.token)).status).toBe(502);
  expect(calls).toBe(1);
  expect(renew).not.toHaveBeenCalled();
  expect((await request(cap.endpoint, cap.token)).status).toBe(401);
  expect(calls).toBe(3);
  expect(renew).toHaveBeenCalledOnce();
});

it("shares one scope-checked renewal for concurrent expired requests", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let rejected = 0,
    accepted = 0;
  const f = await fixture((req, res) => {
    if (req.headers.authorization === "Bearer private-upstream-token") {
      rejected++;
      res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
    } else accepted++;
    res.end("{}");
  });
  const renew = vi.fn(async () => {
    await gate;
    return grant("fresh");
  });
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew,
  });
  const calls = Array.from({ length: 8 }, () => request(cap.endpoint, cap.token));
  await vi.waitFor(() => expect(rejected).toBe(8));
  expect(renew).toHaveBeenCalledOnce();
  release();
  expect((await Promise.all(calls)).every((value) => value.status === 200)).toBe(true);
  expect(accepted).toBe(8);
  expect(renew).toHaveBeenCalledExactlyOnceWith(scope);
});

it.each(["scope", "revoked"])("fails closed when renewal authority is %s", async (reason) => {
  let calls = 0;
  const f = await fixture((_req, res) => {
    calls++;
    res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
    res.end();
  });
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew: async () => {
      if (reason === "revoked") throw new Error("Session revoked");
      return { ...grant("fresh"), scope: { ...scope, projectId: "another" } };
    },
  });
  expect((await request(cap.endpoint, cap.token)).status).toBe(502);
  expect(calls).toBe(1);
});

it("rejects wrong capabilities, browser origins, hosts, routes, protocol, group and environment before forwarding", async () => {
  let calls = 0;
  const f = await fixture((_req, res) => {
    calls++;
    res.end("{}");
  });
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew: async () => grant(),
  });
  expect((await request(cap.endpoint, "wrong")).status).toBe(401);
  expect(
    (
      await request(cap.endpoint, cap.token, body("conversation"), "/rpc", {
        Origin: "https://example.test",
      })
    ).status,
  ).toBe(403);
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      `${cap.endpoint}/rpc`,
      {
        method: "POST",
        headers: {
          Host: "attacker.test",
          Authorization: `Bearer ${cap.token}`,
          "Content-Type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode!));
      },
    );
    req.once("error", reject);
    req.end(JSON.stringify(body("conversation")));
  });
  expect(wrongHost).toBe(403);
  expect(
    (
      await request(cap.endpoint, cap.token, body("conversation"), "/rpc", {
        "Content-Type": "text/plain",
      })
    ).status,
  ).toBe(403);
  expect((await request(cap.endpoint, cap.token, body("conversation"), "/mcp/social")).status).toBe(
    404,
  );
  for (const input of [
    body("social"),
    { ...body("conversation"), environmentId: "another" },
    { ...body("conversation"), version: -1 },
    [],
  ])
    expect((await request(cap.endpoint, cap.token, input as never)).status).toBe(502);
  expect(
    (
      await request(
        cap.endpoint,
        cap.token,
        { jsonrpc: "1.0", method: "tools/list" } as never,
        "/mcp/conversation",
      )
    ).status,
  ).toBe(502);
  expect(calls).toBe(0);
});

it("retires capabilities independently and aborts pending refresh waits without late retry", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const f = await fixture((_req, res) => {
    calls++;
    res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
    res.end();
  });
  const renew = vi.fn(async () => {
    await gate;
    return grant("fresh");
  });
  const old = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew,
  });
  const replacement = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew: async () => grant("replacement"),
  });
  const result = request(old.endpoint, old.token);
  await vi.waitFor(() => expect(renew).toHaveBeenCalledOnce());
  old.dispose();
  expect((await result).status).toBe(502);
  expect((await request(old.endpoint, old.token)).status).toBe(401);
  release();
  expect((await request(replacement.endpoint, replacement.token)).status).toBe(401);
  expect(calls).toBe(3);
});

it("rejects noncanonical upstream URLs and malformed scopes", async () => {
  const f = await fixture((_req, res) => res.end());
  for (const upstream of [
    "https://127.0.0.1:1",
    "http://example.test",
    `${f.upstream}/other`,
    `${f.upstream}?x=1`,
    `${f.upstream}#hash`,
  ])
    await expect(
      f.relay.create({
        group: "conversation",
        upstream,
        grant: grant(),
        renew: async () => grant(),
      }),
    ).rejects.toThrow();
  await expect(
    f.relay.create({
      group: "conversation",
      upstream: f.upstream,
      grant: { ...grant(), scope: { a: "a", b: "b", c: "c", d: "d" } as never },
      renew: async () => grant(),
    }),
  ).rejects.toThrow("Invalid session tools scope");
});

it("times out a stalled upstream once without renewal or replay", async () => {
  let calls = 0;
  const f = await fixture((_req, _res) => {
    calls++;
  }, 100);
  const renew = vi.fn(async () => grant("fresh"));
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew,
  });
  expect((await request(cap.endpoint, cap.token)).status).toBe(502);
  expect(calls).toBe(1);
  expect(renew).not.toHaveBeenCalled();
});

it("preserves large JSON editor requests while bounding input and output", async () => {
  let calls = 0;
  const f = await fixture((req, res) => {
    calls++;
    req.resume();
    req.once("end", () => res.end(calls === 1 ? "{}" : "x".repeat(16 * 1024 * 1024 + 1)));
  });
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew: async () => grant("fresh"),
  });
  const large = {
    ...body("conversation"),
    params: { action: "files.write", input: { content: "x".repeat(2 * 1024 * 1024) } },
  };
  expect((await request(cap.endpoint, cap.token, large)).status).toBe(200);
  expect((await request(cap.endpoint, cap.token)).status).toBe(502);
  const oversized = {
    ...large,
    params: { action: "files.write", input: { content: "x".repeat(8 * 1024 * 1024) } },
  };
  expect((await request(cap.endpoint, cap.token, oversized)).status).toBe(502);
  expect(calls).toBe(2);
});

it("redacts the actual retry token even when another request has already renewed it again", async () => {
  let held: ServerResponse | undefined;
  let freshCalls = 0;
  const f = await fixture((req, res) => {
    const token = req.headers.authorization?.slice(7);
    if (token === "private-upstream-token" || (token === "private-g1" && ++freshCalls > 1)) {
      res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
      res.end();
    } else if (token === "private-g1") {
      held = res;
      res.writeHead(200);
      res.flushHeaders();
    } else res.end("okay");
  });
  let generation = 0;
  const cap = await f.relay.create({
    group: "conversation",
    upstream: f.upstream,
    grant: grant(),
    renew: async () => grant(`private-g${++generation}`),
  });
  const a = request(cap.endpoint, cap.token);
  await vi.waitFor(() => expect(held).toBeDefined());
  const b = await request(cap.endpoint, cap.token);
  expect(await b.text()).toBe("okay");
  expect(generation).toBe(2);
  held!.end(JSON.stringify({ echo: "private-g1" }));
  expect(await (await a).text()).toBe('{"echo":"[session credential redacted]"}');
});
