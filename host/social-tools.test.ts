import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { authorizeSocialAcpFrame } from "./social-tools";
import { SocialService } from "./social";
import type { SocialAdapters } from "../src/integrations/social/adapter";
import {
  REMOTE_PROVIDERS,
  HOST_PROTOCOL_VERSION,
} from "../src/features/connections/model/protocol";
import type { SocialAccount, SocialCampaign } from "../src/features/social/model/social";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(platform: "x" | "youtube" = "x") {
  const path = mkdtempSync(join(tmpdir(), "social-tools-"));
  const store = new HostStore(join(path, "host.db"));
  const project = store.addProject(path, "Project");
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
  const server = createHostServer(
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
    social.stop();
    await new Promise<void>((done) => {
      server.close(done);
      server.closeAllConnections();
    });
    await engine.close();
    store.close();
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
  const session = (harness: (typeof REMOTE_PROVIDERS)[number]) => {
    const result = engine.command({
      type: "create",
      commandId: crypto.randomUUID(),
      projectId: project.id,
      harness,
      model: `${harness}:test`,
      runtimeMode: "supervised",
    });
    const grant = social.issueSessionGrant(result.sessionId);
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
describe("Gerçek yerel CLI ve MCP taşıması", () => {
  it("ACP kimliğini backend ekler; gelen prompt ve diğer MCP sunucuları kimlik taşımaz", () => {
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
    "Claude MCP ve Pi CLI aynı %s HTTP host kampanyasına erişir; token çıktı veya promptta bulunmaz",
    async (platform) => {
      const s = await fixture(platform);
      const claude = s.session("claude"),
        pi = s.session("pi");
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
      expect(responses.find((value) => value.id === 2).result.tools).toHaveLength(27);
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
  it("session grant genel host yönetim RPC'sine geçemez; araç JSON içinden sahip kimliği türetilemez", async () => {
    const s = await fixture();
    const session = s.session("codex");
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
