import { describe, expect, it, vi } from "vitest";
import { memberMcpHub } from "./member-hub";

const hubServer = {
  name: "arc",
  codexName: "arc",
  url: "http://127.0.0.1:4555/mcp/ext/arc",
  kind: "stdio",
  mode: "shared",
  sources: [],
};
const published = {
  externalMcp: {
    servers: [hubServer, { ...hubServer, name: "docs", codexName: "docs" }],
    disable: { claude: [], codex: [] },
  },
};
const hub = { externalMcp: vi.fn(async () => published) };

describe("memberMcpHub", () => {
  it("passes the hub through for sessions without an allowlist", async () => {
    const wrapped = memberMcpHub(hub, async () => undefined);
    expect(await wrapped.externalMcp("http://x/mcp/conversation", "p", "s1")).toBe(published);
    expect(await wrapped.externalMcp("http://x/mcp/conversation", "p")).toBe(published);
  });

  it("narrows to the member's allowlist and looks the session up without its suffix", async () => {
    const allowlist = vi.fn(async () => ["docs"] as const);
    const out = await memberMcpHub(hub, allowlist).externalMcp("u", "p", "s1#2");
    expect(allowlist).toHaveBeenCalledWith("s1");
    const external = out!.externalMcp as {
      servers: { name: string }[];
      disable: { codex: string[] };
    };
    expect(external.servers.map((server) => server.name)).toEqual(["docs"]);
    expect(external.disable.codex).toEqual(["arc"]);
  });

  it("refuses the launch when hub metadata is missing", async () => {
    const empty = { externalMcp: vi.fn(async () => undefined) };
    await expect(
      memberMcpHub(empty, async () => ["docs"]).externalMcp("u", "p", "s"),
    ).rejects.toThrow(/cannot be restricted/);
  });
});
