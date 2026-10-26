import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "./child-backend";
import type { RuntimeLogAccess } from "./runtime-log-tools";
import type { SocialService } from "./social";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";

it("gives actual surviving children stable scoped MCP/RPC routes, renews all groups, and retires replaced credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-child-relay-"));
  const script = join(directory, "provider.cjs");
  await writeFile(
    script,
    `
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', async line => {
 const {group,id,mcp}=JSON.parse(line), prefix=group==='runtime-logs'?'BYCODA_RUNTIME_LOGS':'BYCODA_'+group.toUpperCase();
 const body=mcp?{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}:{version:${HOST_PROTOCOL_VERSION},environmentId:process.env[prefix+'_ENVIRONMENT'],method:group==='runtime-logs'?'runtimeLogs.tools.call':group+'.tools.call',params:{action:'tools.list',input:{}}};
 const response=await fetch(process.env[prefix+'_ENDPOINT']+(mcp?'/mcp/'+group:'/rpc'),{method:'POST',headers:{Authorization:'Bearer '+process.env[prefix+'_TOKEN'],'Content-Type':'application/json'},body:JSON.stringify(body)});
 console.log(JSON.stringify({id,status:response.status,value:await response.text()}));
});
`,
  );
  const valid = new Map<string, string>();
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const token = req.headers.authorization?.slice(7) ?? "";
    calls.push(token);
    if (![...valid.values()].includes(token)) {
      res.writeHead(401, { "X-Bycoda-Auth-Stage": "before-dispatch" });
      res.end("expired");
    } else res.end(JSON.stringify({ result: "ok" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const backend = new HostChildBackend();
  const scope = {
    sessionId: "session",
    projectId: "project",
    provider: "codex",
    environmentId: "environment",
  };
  const issuers = new Map<string, ReturnType<typeof vi.fn>>();
  let delegated = false;
  let revision = 0;
  for (const group of ["conversation", "runtime-logs", "social"]) {
    const issueSessionGrant = vi.fn(
      async (session: string, _device?: string, expected?: unknown) => {
        expect(session).toBe("session");
        if (expected !== undefined) expect(expected).toEqual(scope);
        const token = `private-${group}-${++revision}`;
        valid.set(group, token);
        return { token, expiresAt: Date.now() + 1000, scope };
      },
    );
    issuers.set(group, issueSessionGrant);
    if (group === "conversation")
      backend.setConversationAccess({ issueSessionGrant } as unknown as RuntimeLogAccess, endpoint);
    if (group === "runtime-logs")
      backend.setRuntimeLogAccess({ issueSessionGrant } as unknown as RuntimeLogAccess, endpoint);
    if (group === "social")
      backend.setSocialAccess(
        { issueSessionGrant, isDelegated: async () => delegated } as unknown as SocialService,
        endpoint,
      );
  }
  const events: Array<{ id: string; status: number; value: string }> = [];
  const unlisten = await backend.listen<{ line: string }>("harness-stdout", ({ payload }) =>
    events.push(JSON.parse(payload.line)),
  );
  const id = "session#2";
  const launch = () =>
    backend.invoke<number>("harness_spawn", {
      sessionId: id,
      command: script,
      args: [],
      cwd: directory,
    });
  const state = backend as unknown as {
    conversationEnvironments: Map<string, NodeJS.ProcessEnv>;
    runtimeLogEnvironments: Map<string, NodeJS.ProcessEnv>;
    socialEnvironments: Map<string, NodeJS.ProcessEnv>;
  };
  const send = async (group: string, marker: string, mcp = false) => {
    await backend.invoke("harness_write", {
      sessionId: id,
      line: JSON.stringify({ group, id: marker, mcp }),
    });
    await vi.waitFor(() => expect(events.some((event) => event.id === marker)).toBe(true));
    return events.find((event) => event.id === marker)!;
  };
  try {
    const bridges = [];
    for (const command of [
      "harness_conversation_tools_bridge",
      "harness_runtime_logs_bridge",
      "harness_social_bridge",
    ])
      bridges.push(await backend.invoke<{ mcpUrl: string }>(command, { sessionId: id }));
    await launch();
    for (const [index, group] of ["conversation", "runtime-logs", "social"].entries()) {
      const env =
        group === "conversation"
          ? state.conversationEnvironments.get(id)!
          : group === "social"
            ? state.socialEnvironments.get(id)!
            : state.runtimeLogEnvironments.get(id)!;
      const prefix =
        group === "runtime-logs" ? "BYCODA_RUNTIME_LOGS" : `BYCODA_${group.toUpperCase()}`;
      expect(`${env[`${prefix}_ENDPOINT`]}/mcp/${group}`).toBe(bridges[index].mcpUrl);
      expect(env[`${prefix}_TOKEN`]).not.toBe(valid.get(group));
      expect(issuers.get(group)).toHaveBeenCalledOnce();
      expect((await send(group, `${group}-initial`)).status).toBe(200);
      valid.delete(group); // Same rejection the real twelve-hour grant TTL returns.
      expect((await send(group, `${group}-renewed`, true)).status).toBe(200);
      expect(issuers.get(group)).toHaveBeenCalledTimes(2);
      expect(issuers.get(group)).toHaveBeenLastCalledWith("session", undefined, scope);
    }
    delegated = true;
    valid.delete("social");
    expect((await send("social", "social-moved")).status).toBe(502);
    expect(issuers.get("social")).toHaveBeenCalledTimes(2);
    const old = { ...state.conversationEnvironments.get(id)! };
    delegated = false;
    await launch();
    expect(state.conversationEnvironments.get(id)!.BYCODA_CONVERSATION_TOKEN).not.toBe(
      old.BYCODA_CONVERSATION_TOKEN,
    );
    expect(
      (
        await fetch(`${old.BYCODA_CONVERSATION_ENDPOINT}/rpc`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${old.BYCODA_CONVERSATION_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect((await send("conversation", "replacement")).status).toBe(200);
    await backend.kill(id);
    expect(state.conversationEnvironments.has(id)).toBe(false);
    expect(calls.length).toBeGreaterThanOrEqual(11);
  } finally {
    unlisten();
    await backend.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it("does not fall back to local Social grants when delegated credentials are unavailable", async () => {
  const backend = new HostChildBackend();
  const issueSessionGrant = vi.fn();
  backend.setSocialAccess(
    {
      isDelegated: async () => true,
      remoteAccess: async () => undefined,
      issueSessionGrant,
    } as unknown as SocialService,
    "http://127.0.0.1:1",
  );
  try {
    expect(await backend.invoke("harness_social_bridge", { sessionId: "session" })).toBeNull();
    expect(issueSessionGrant).not.toHaveBeenCalled();
  } finally {
    await backend.close();
  }
});

it("rechecks session authority after an unavailable bridge preparation", async () => {
  const backend = new HostChildBackend();
  let available = false;
  const issueSessionGrant = vi.fn(async () => {
    if (!available) throw new Error("Session metadata not available");
    return {
      token: "private",
      expiresAt: Date.now() + 1000,
      scope: {
        sessionId: "session",
        projectId: "project",
        provider: "codex",
        environmentId: "environment",
      },
    };
  });
  backend.setConversationAccess(
    { issueSessionGrant } as unknown as RuntimeLogAccess,
    "http://127.0.0.1:1",
  );
  try {
    expect(
      await backend.invoke("harness_conversation_tools_bridge", { sessionId: "session" }),
    ).toBeNull();
    available = true;
    expect(
      await backend.invoke("harness_conversation_tools_bridge", { sessionId: "session" }),
    ).toHaveProperty("mcpUrl");
    expect(issueSessionGrant).toHaveBeenCalledTimes(2);
  } finally {
    await backend.close();
  }
});
