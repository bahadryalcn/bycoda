import { describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("./child", () => ({ invokeProviderCommand: invoke }));
import { socialAcpServers, socialBridge, socialCliHint, socialSpawnArgs } from "./socialBridge";
const bridge = {
  command: "C:\\Program Files\\nodejs\\node.exe",
  args: ["G:\\bycoda Host\\host.mjs"],
};
describe("Provider bağımsız sosyal araç köprüsü", () => {
  it("Claude ve Codex MCP; ACP aynı stdio sunucusu; diğer provider'lar güvenli CLI tanımı alır", () => {
    expect(socialSpawnArgs("claude", ["--print"], bridge)).toContain("--mcp-config");
    const codex = socialSpawnArgs("codex", ["app-server"], bridge);
    expect(codex.join(" ")).toContain("mcp_servers.bycoda-social");
    expect(codex.join(" ")).toContain("mcp_servers.bycoda-social.env_vars=");
    expect(codex.join(" ")).toContain('"BYCODA_SOCIAL_TOKEN"');
    expect(codex.join(" ")).not.toContain("synthetic-scoped-token");
    expect(socialAcpServers(bridge)[0]).toMatchObject({
      name: "bycoda-social",
      env: [],
      args: [...bridge.args, "social-mcp"],
    });
    for (const provider of [
      "pi",
      "omp",
      "antigravity",
      "grok",
      "gemini",
      "cursor",
      "fx",
      "hermes",
      "opencode",
    ] as const)
      expect(socialSpawnArgs(provider, ["run"], bridge)).toEqual(["run"]);
    expect(socialCliHint(bridge)).toContain("social_policy_get");
    expect(socialCliHint(bridge)).toContain("Drafts never authorize sending");
    expect(socialCliHint(bridge)).not.toContain("TOKEN");
  });
  it.each([
    ["claude", ["auth", "login"]],
    ["claude", ["auth", "status"]],
    ["claude", ["update"]],
    ["codex", ["login"]],
    ["codex", ["login", "--device-auth"]],
  ] as const)("keeps %s management commands free of social MCP flags", (provider, args) => {
    expect(socialSpawnArgs(provider, [...args], bridge)).toEqual(args);
  });
  it("adds social MCP to Claude's stream conversation launch", () => {
    const args = ["--output-format", "stream-json", "--input-format", "stream-json"];
    const result = socialSpawnArgs("claude", args, bridge);
    expect(result.slice(0, args.length)).toEqual(args);
    expect(result[args.length]).toBe("--mcp-config");
    expect(JSON.parse(result[args.length + 1])).toEqual({
      mcpServers: {
        "bycoda-social": {
          command: bridge.command,
          args: [...bridge.args, "social-mcp"],
        },
      },
    });
  });
  it("katalog ve izole başlık helper'larına MCP eklenmez; bağlantısız host normal session'ı bozmaz", async () => {
    expect(socialSpawnArgs("claude", ["--strict-mcp-config"], bridge)).toEqual([
      "--strict-mcp-config",
    ]);
    expect(socialSpawnArgs("claude", ["--max-turns", "1"], bridge)).toEqual(["--max-turns", "1"]);
    invoke.mockImplementationOnce(() => {
      throw new Error("No host");
    });
    expect(await socialBridge("offline")).toBeNull();
    invoke.mockResolvedValueOnce(42);
    expect(await socialBridge("malformed")).toBeNull();
    invoke.mockResolvedValueOnce(bridge);
    expect(await socialBridge("session#4")).toEqual(bridge);
    expect(invoke).toHaveBeenLastCalledWith("harness_social_bridge", {
      sessionId: "session",
    });
  });
});
