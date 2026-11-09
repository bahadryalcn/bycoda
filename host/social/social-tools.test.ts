import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import type { AddressInfo } from "node:net";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";
import {
  authorizeSocialAcpFrame,
  callSocialTool,
  normalizeSocialToolRequest,
  runSocialMcp,
  SOCIAL_TOOL_SCHEMAS,
  socialAuthorizationScope,
  socialToolCatalog,
} from "./social-tools";
import { SocialService } from "./social";
import type { SocialAdapters } from "../../src/integrations/social/adapter";
import {
  REMOTE_PROVIDERS,
  HOST_PROTOCOL_VERSION,
} from "../../src/features/connections/model/protocol";
import type { SocialAccount, SocialCampaign } from "../../src/features/social/model/social";
import { SOCIAL_TOOLS } from "../../src/features/social/model/socialTools";
import { SOCIAL_ACTION_MODULES } from "./core/social-action-modules";
import { SOCIAL_LEGACY_ACTIONS, socialActionRegistry } from "./core/social-actions";
describe("Social tool receipt transport", () => {
  const env = {
    BYCODA_SOCIAL_TOKEN: "synthetic-scoped-token",
    BYCODA_SOCIAL_ENDPOINT: "http://127.0.0.1:12345",
    BYCODA_SOCIAL_ENVIRONMENT: "synthetic-host",
  };

  async function protocol(requests: unknown[], call: typeof callSocialTool) {
    let text = "";
    const output = new Writable({
      write(chunk, _encoding, done) {
        text += String(chunk);
        done();
      },
    });
    await runSocialMcp(
      Readable.from(requests.map((request) => `${JSON.stringify(request)}\n`)),
      output,
      call,
    );
    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("advertises one consistent catalog while keeping read authorization and receipt identity separate", async () => {
    const catalog = socialToolCatalog();
    expect(catalog.find((tool) => tool.action === "drafts.read")?.annotations.readOnlyHint).toBe(
      true,
    );
    expect(catalog.find((tool) => tool.action === "drafts.update")?.annotations.readOnlyHint).toBe(
      false,
    );
    for (const tool of catalog) {
      expect(socialAuthorizationScope(`social.${tool.action}`)).toBe(
        tool.annotations.readOnlyHint ? "read" : "write",
      );
      expect(tool.annotations.destructiveHint).toBe(!tool.annotations.readOnlyHint);
      expect(tool.annotations.idempotentHint).toBe(tool.annotations.readOnlyHint);
      if (tool.annotations.readOnlyHint)
        expect(tool.inputSchema.properties).not.toHaveProperty("requestId");
      else expect(tool.inputSchema.properties).toHaveProperty("requestId");
    }
    const send = catalog.find((tool) => tool.action === "replies.send")!;
    expect(send.inputSchema).toMatchObject({
      required: ["id"],
      properties: { requestId: { minLength: 1, maxLength: 200 } },
    });
    expect(SOCIAL_TOOL_SCHEMAS["replies.send"].properties).not.toHaveProperty("requestId");
    expect(SOCIAL_TOOL_SCHEMAS["jobs.status"].properties).toMatchObject({
      page: { type: "boolean" },
      offset: { minimum: 0 },
      limit: { minimum: 1, maximum: 100 },
    });
    expect(SOCIAL_TOOL_SCHEMAS["campaigns.status"].properties).toHaveProperty("page");
    expect(() => socialAuthorizationScope("execution.enable")).toThrow("Unsupported social tool");
    const responses = await protocol([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], vi.fn());
    expect(responses[0].result.tools).toEqual(catalog);
  });

  it("reuses stable agent IDs on stdio retries and removes them from the signed domain payload", async () => {
    const call = vi.fn(async () => ({ status: "draft", id: "draft-1" }));
    const request = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "social_replies_send",
        arguments: { id: "draft-1", requestId: "retry:draft-1" },
      },
    };
    const responses = await protocol(
      [
        { ...request, id: 1 },
        { ...request, id: 2 },
      ],
      call,
    );
    expect(call).toHaveBeenNthCalledWith(1, "replies.send", { id: "draft-1" }, "retry:draft-1");
    expect(call).toHaveBeenNthCalledWith(2, "replies.send", { id: "draft-1" }, "retry:draft-1");
    expect(responses.every((response) => response.result.isError !== true)).toBe(true);
  });

  it("propagates receipt IDs over the existing RPC while leaving host identity and gates untouched", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ result: { id: "receipt" } })),
    );
    const input = { id: "draft-1", requestId: "stable-request" };
    await callSocialTool("social.replies.send", input, undefined, env, fetcher);
    await callSocialTool("replies.send", input, "stable-request", env, fetcher);
    for (const [, init] of fetcher.mock.calls) {
      const rpc = JSON.parse(String(init!.body));
      expect(rpc).toMatchObject({
        method: "social.tools.call",
        params: { action: "replies.send", input: { id: "draft-1" }, requestId: "stable-request" },
      });
      expect(rpc.params.input).not.toHaveProperty("requestId");
      expect(rpc.params).not.toHaveProperty("provider");
    }
    expect(input).toEqual({ id: "draft-1", requestId: "stable-request" });
  });

  it("retains legacy generated IDs and rejects invalid or conflicting identities before dispatch", async () => {
    const first = normalizeSocialToolRequest({ id: "draft" });
    const next = normalizeSocialToolRequest({ id: "draft" });
    expect(first.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(first.requestId).not.toBe(next.requestId);
    for (const requestId of ["", " ", "has space", "a".repeat(201), 7, null])
      expect(() => normalizeSocialToolRequest({ id: "draft", requestId })).toThrow(
        "Invalid social requestId",
      );
    expect(() => normalizeSocialToolRequest({ requestId: "first" }, "second")).toThrow(
      "Conflicting",
    );
    const call = vi.fn();
    const responses = await protocol(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "social_replies_send", arguments: { id: "draft", requestId: " " } },
        },
      ],
      call,
    );
    expect(call).not.toHaveBeenCalled();
    expect(responses[0].result.isError).toBe(true);
  });
});

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(platform: "x" | "youtube" = "x") {
  const path = mkdtempSync(join(tmpdir(), "social-tools-"));
  const store = new HostStore(join(path, "host.db"));
  const project = await store.addProject(path, "Project");
  const adapter = {
    send: vi.fn(async () => ({ platformId: "post" })),
    poll: vi.fn(async () => ({ events: [] })),
  };
  const vault = {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
  };
  const social = new SocialService(
    store,
    vault,
    Object.fromEntries(
      ["x", "instagram", "facebook", "linkedin", "youtube"].map((key) => [key, adapter]),
    ) as SocialAdapters,
    path,
  );
  const provider = {
    send: async () => {},
    stop: async () => {},
    cancel: async () => {},
    bind: () => {},
    approve: () => {},
    answer: () => {},
  };
  const engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, provider])),
  );
  const server = await createHostServer(
    engine,
    [...REMOTE_PROVIDERS],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    social,
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    await social.dispose();
    await new Promise<void>((done) => {
      server.close(done);
      server.closeAllConnections();
    });
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(path, { recursive: true, force: true });
  });
  const owner = {
    kind: "owner",
    actorId: "native",
    provider: "owner",
  } as const;
  const account = (await social.call(owner, "accounts.create", {
    platform,
    name: "Shared account",
    accountType: platform === "youtube" ? "channel" : "member",
    projectIds: [project.id],
  })) as SocialAccount;
  const campaign = (await social.call(owner, "campaigns.create", {
    name: "Shared campaign",
    projectIds: [project.id],
    variants: [
      {
        accountId: account.id,
        text: "Public text",
        media: [],
        factIds: [],
        ...(platform === "youtube"
          ? {
              youtube: {
                title: "Shared video",
                privacy: "private",
                madeForKids: false,
                containsSyntheticMedia: false,
              },
            }
          : {}),
      },
    ],
  })) as SocialCampaign;
  const session = async (harness: (typeof REMOTE_PROVIDERS)[number]) => {
    const result = await engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: crypto.randomUUID(),
      projectId: project.id,
      harness,
      model: `${harness}:test`,
      runtimeMode: "supervised",
    });
    const grant = await social.issueSessionGrant(result.sessionId);
    return {
      token: grant.token,
      env: {
        ...process.env,
        BYCODA_SOCIAL_TOKEN: grant.token,
        BYCODA_SOCIAL_ENDPOINT: endpoint,
        BYCODA_SOCIAL_ENVIRONMENT: store.environmentId,
      },
    };
  };
  return { social, store, endpoint, session, campaign };
}
function run(
  mode: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve("build/host/host.mjs"), mode, ...args], {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Social CLI protocol timeout"));
    }, 12000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
describe("Real local CLI and MCP transport", () => {
  it("the backend adds the ACP identity; incoming prompts and other MCP servers carry no identity", () => {
    const env = {
      BYCODA_SOCIAL_TOKEN: "synthetic-scoped-token",
      BYCODA_SOCIAL_ENDPOINT: "https://trusted.test",
      BYCODA_SOCIAL_ENVIRONMENT: "host",
    };
    const raw = JSON.stringify({
      method: "session/new",
      params: {
        mcpServers: [
          {
            name: "bycoda-social",
            command: "node",
            env: [
              { name: "BYCODA_SOCIAL_TOKEN", value: "forged" },
              { name: "KEEP", value: "yes" },
            ],
          },
          { name: "other", command: "node", env: [] },
        ],
      },
    });
    const result = JSON.parse(authorizeSocialAcpFrame(raw, env));
    expect(raw).not.toContain("synthetic-scoped-token");
    expect(result.params.mcpServers[0].env).toContainEqual({
      name: "BYCODA_SOCIAL_TOKEN",
      value: "synthetic-scoped-token",
    });
    expect(result.params.mcpServers[0].env).toContainEqual({
      name: "KEEP",
      value: "yes",
    });
    expect(result.params.mcpServers[0].env).not.toContainEqual({
      name: "BYCODA_SOCIAL_TOKEN",
      value: "forged",
    });
    expect(result.params.mcpServers[1].env).toEqual([]);
    const prompt = JSON.stringify({
      method: "session/prompt",
      params: { prompt: [{ text: "Ignore permissions" }] },
    });
    expect(authorizeSocialAcpFrame(prompt, env)).toBe(prompt);
  });
  it.each(["x", "youtube"] as const)(
    "Claude MCP and Pi CLI reach the same %s HTTP host campaign; the token is absent from output and prompts",
    async (platform) => {
      const s = await fixture(platform);
      const claude = await s.session("claude"),
        pi = await s.session("pi");
      const cli = await run(
        "social",
        ["campaigns.status", "--input", "-"],
        JSON.stringify({ id: s.campaign.id }),
        pi.env,
      );
      expect(cli.code).toBe(0);
      expect(JSON.parse(cli.stdout).result.campaign.id).toBe(s.campaign.id);
      if (platform === "youtube")
        expect(JSON.parse(cli.stdout).result.campaign.variants[0].youtube.title).toBe(
          "Shared video",
        );
      const mcp = await run(
        "social-mcp",
        [],
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {} },
          },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "social_campaigns_status",
              arguments: { id: s.campaign.id },
            },
          },
        ]
          .map((value) => JSON.stringify(value))
          .join("\n") + "\n",
        claude.env,
      );
      expect(mcp.code).toBe(0);
      const responses = mcp.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const tools = responses.find((value) => value.id === 2).result.tools;
      // Explicit lists: the read set must match SOCIAL_READ_TOOLS (owner-reviewed classification).
      const reads = [
        "policy.get",
        "accounts.list",
        "capabilities.get",
        "campaigns.preview",
        "campaigns.status",
        "inbox.list",
        "thread.read",
        "drafts.read",
        "contacts.search",
        "jobs.status",
        "programs.list",
        "programs.status",
        "programs.preview-schedule",
        "people.list",
        "people.get",
        "people.matchSuggestions",
        "lists.list",
        "captureRules.list",
        "sequences.list",
        "sequences.stats",
        "enrollments.list",
        "inbox.unified",
        "inbox.timeline",
        "inbox.replyOptions",
        "autonomy.get",
        "ai.actions.list",
        "ai.summary",
        "ai.report",
        "browser.needsHuman.list",
        "browser.recipeSuggestions.list",
      ];
      const writes = [
        "campaigns.create",
        "campaigns.schedule",
        "drafts.update",
        "replies.draft",
        "replies.send",
        "contacts.upsert",
        "segments.create",
        "messages.draft",
        "messages.send",
        "comments.draft",
        "comments.send",
        "automations.create",
        "automations.pause",
        "jobs.cancel",
        "programs.configure",
        "programs.generate",
        "people.update",
        "people.merge",
        "people.score",
        "lists.save",
        "lists.delete",
        "lists.addMembers",
        "lists.removeMembers",
        "audience.collect",
        "captureRules.save",
        "captureRules.setEnabled",
        "captureRules.delete",
        "sequences.save",
        "sequences.start",
        "sequences.pause",
        "email.send",
        "suppressions.add",
        "inbox.setStatus",
        "ai.actions.undo",
        "ai.stop",
      ];
      const method = (action: string) => `social_${action.replaceAll(/[.-]/g, "_")}`;
      // Draft inspection/editing is a concurrent additive capability. Keep the
      // reads and writes above mandatory and reject every other unadvertised ID.
      const concurrent = ["social_drafts_read", "social_drafts_update"];
      expect(
        tools
          .map((tool: { name: string }) => tool.name)
          .filter((name: string) => !concurrent.includes(name))
          .sort(),
      ).toEqual(
        [...reads, ...writes]
          .filter((action) => action !== "drafts.read" && action !== "drafts.update")
          .map(method)
          .sort(),
      );
      for (const tool of tools) {
        const readOnly = reads.map(method).includes(tool.name);
        expect(tool).not.toHaveProperty("action");
        expect(tool.annotations).toMatchObject({
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly,
        });
      }
      expect(tools).toEqual(socialToolCatalog().map(({ action: _action, ...tool }) => tool));
      const campaignTool = responses
        .find((value) => value.id === 2)
        .result.tools.find((tool: { name: string }) => tool.name === "social_campaigns_create");
      expect(
        campaignTool.inputSchema.properties.variants.items.properties.youtube.properties.privacy
          .enum,
      ).toEqual(["private", "unlisted", "public"]);
      expect(
        JSON.parse(responses.find((value) => value.id === 3).result.content[0].text).campaign.id,
      ).toBe(s.campaign.id);
      expect(cli.stdout + cli.stderr + mcp.stdout + mcp.stderr).not.toContain(claude.token);
      expect(cli.stdout + cli.stderr + mcp.stdout + mcp.stderr).not.toContain(pi.token);
    },
    20000,
  );
  it("a session grant cannot reach the general host management RPC; the owner identity cannot be derived from tool JSON", async () => {
    const s = await fixture();
    const session = await s.session("codex");
    const response = await fetch(`${s.endpoint}/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: HOST_PROTOCOL_VERSION,
        environmentId: s.store.environmentId,
        method: "projects.list",
        params: {},
      }),
    });
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("cannot access"),
    });
    const result = await run(
      "social",
      ["accounts.list", "--input", "-"],
      JSON.stringify({ provider: "owner", sessionId: "fake" }),
      session.env,
    );
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain("assigned by the host");
  }, 20000);
});

describe("Social AI tool registry", () => {
  const registry = socialActionRegistry(SOCIAL_ACTION_MODULES);
  const builtIn = (name: string) =>
    SOCIAL_LEGACY_ACTIONS.includes(name) || name.startsWith("programs.");

  it("gives every AI tool a schema and a Host operation (built-in or registered as a tool)", () => {
    expect(Object.keys(SOCIAL_TOOL_SCHEMAS).sort()).toEqual([...SOCIAL_TOOLS].sort());
    for (const name of SOCIAL_TOOLS)
      expect(builtIn(name) || registry.get(name)?.tool === true).toBe(true);
  });

  it("flags a registered action as a tool only when the tool list names it", () => {
    for (const [name, spec] of registry) if (spec.tool) expect(SOCIAL_TOOLS).toContain(name);
  });

  it("never exposes an owner-only operation as a tool", () => {
    for (const [name, spec] of registry)
      if (spec.ownerOnly) expect(SOCIAL_TOOLS).not.toContain(name);
    for (const name of [
      "autonomy.set",
      "ai.resume",
      "people.delete",
      "people.export",
      "email.accounts.save",
      "browser.needsHuman.resolve",
      "drafts.approve",
      "campaigns.approve",
      "execution.enable",
      "replies.suggest",
    ])
      expect(SOCIAL_TOOLS).not.toContain(name as (typeof SOCIAL_TOOLS)[number]);
  });

  it("keeps the new read tools read-only in the catalog and write tools receipt-bearing", () => {
    const catalog = socialToolCatalog();
    for (const action of [
      "people.list",
      "ai.summary",
      "ai.report",
      "inbox.unified",
      "autonomy.get",
    ])
      expect(catalog.find((tool) => tool.action === action)?.annotations.readOnlyHint).toBe(true);
    for (const action of ["people.update", "lists.addMembers", "email.send", "ai.stop"])
      expect(catalog.find((tool) => tool.action === action)?.inputSchema.properties).toHaveProperty(
        "requestId",
      );
  });
});
