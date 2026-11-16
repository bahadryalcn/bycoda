import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpHttp } from "./mcp-http";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-mcp-loading-"));
  dirs.push(dir);
  const resetPublications = vi.fn();
  const hub = {
    dataDir: dir,
    resetPublications,
    oauthSignedIn: async () => false,
    inventory: async () => [
      {
        name: "zeta",
        kind: "stdio",
        source: "claude",
        sources: ["claude"],
        aliases: [],
        command: "SECRET-cmd",
        args: ["SECRET-arg"],
        env: { TOKEN: "SECRET" },
      },
      {
        name: "alpha",
        kind: "stdio",
        source: "claude",
        sources: ["claude"],
        aliases: [{ provider: "claude", name: "alpha" }],
        command: "x",
        args: [],
        env: {},
      },
      {
        name: "remote",
        kind: "http",
        source: "codex",
        sources: ["codex"],
        aliases: [],
        url: "https://SECRET.example/mcp",
        headers: { Authorization: "SECRET" },
      },
    ],
  };
  const store = {
    ready: Promise.resolve(),
    authenticated: async (token: string) => token === "owner",
    db: {
      exec: async () => {},
      withAuthorization: async (_check: unknown, run: () => Promise<unknown>) => await run(),
    },
  };
  const http = new McpHttp({ store, hub } as never);
  const call = async (method: string, input: Record<string, unknown>, token = "owner") => {
    let body = "";
    const handled = await http.rpc(method, input, token, {
      end: (text: string) => (body = text),
    } as never);
    return { handled, result: body ? JSON.parse(body).result : undefined };
  };
  return { dir, call, resetPublications, file: join(dir, "mcp-hub", "loading.json") };
}

describe("mcp.hub.loading owner RPCs", () => {
  it("rejects callers without an owner credential", async () => {
    const s = setup();
    await expect(s.call("mcp.hub.loading.get", {}, "nobody")).rejects.toThrow(/Owner device/);
    await expect(
      s.call("mcp.hub.loading.set", { mode: "always", direct: [] }, "x"),
    ).rejects.toThrow(/Owner device/);
    expect(s.resetPublications).not.toHaveBeenCalled();
  });

  it("returns the default policy and sorted hub-hosted names", async () => {
    const s = setup();
    const { result } = await s.call("mcp.hub.loading.get", {});
    expect(result).toEqual({
      policy: { version: 1, mode: "onDemand", direct: [] },
      corrupt: false,
      servers: ["alpha", "zeta"],
      inventory: [
        {
          name: "alpha",
          kind: "stdio",
          source: "claude",
          sources: ["claude"],
          aliases: [{ provider: "claude", name: "alpha" }],
          signedIn: false,
        },
        {
          name: "remote",
          kind: "http",
          source: "codex",
          sources: ["codex"],
          aliases: [],
          signedIn: false,
        },
        {
          name: "zeta",
          kind: "stdio",
          source: "claude",
          sources: ["claude"],
          aliases: [],
          signedIn: false,
        },
      ],
    });
  });

  it("never exposes launch or endpoint secrets in the inventory", async () => {
    const s = setup();
    const { result } = await s.call("mcp.hub.loading.get", {});
    const text = JSON.stringify(result);
    for (const key of ["command", "args", "env", "url", "headers"])
      expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain("SECRET");
  });

  it("validates, persists atomically and resets publications", async () => {
    const s = setup();
    const { result } = await s.call("mcp.hub.loading.set", { mode: "onDemand", direct: ["alpha"] });
    expect(result.policy).toEqual({ version: 1, mode: "onDemand", direct: ["alpha"] });
    expect(JSON.parse(readFileSync(s.file, "utf8")).direct).toEqual(["alpha"]);
    expect(s.resetPublications).toHaveBeenCalledOnce();
    for (const bad of [
      { mode: "sometimes", direct: [] },
      { mode: "always", direct: ["../evil"] },
      { mode: "always" },
    ])
      await expect(s.call("mcp.hub.loading.set", bad)).rejects.toThrow(/Invalid MCP loading/);
    expect(s.resetPublications).toHaveBeenCalledOnce();
  });

  it("flags a corrupt file and refuses to overwrite it", async () => {
    const s = setup();
    mkdirSync(join(s.dir, "mcp-hub"));
    writeFileSync(s.file, "{not json");
    const { result } = await s.call("mcp.hub.loading.get", {});
    expect(result.corrupt).toBe(true);
    expect(result.policy.mode).toBe("onDemand");
    await expect(s.call("mcp.hub.loading.set", { mode: "always", direct: [] })).rejects.toThrow(
      /corrupt/,
    );
    expect(readFileSync(s.file, "utf8")).toBe("{not json");
    expect(s.resetPublications).not.toHaveBeenCalled();
  });
});

describe("mcp.oauth owner RPCs", () => {
  function oauthSetup() {
    const start = vi.fn(async () => ({
      authorizationUrl: "https://auth.example/authorize",
      expiresAt: 1,
    }));
    const signOut = vi.fn(async () => undefined);
    const hub = {
      dataDir: "unused",
      inventory: async () => [
        { name: "remote", kind: "http", url: "https://remote.example/mcp" },
        { name: "local", kind: "stdio" },
      ],
      oauthSignedIn: async () => false,
      oauth: {
        start,
        signOut,
        status: async (servers: { name: string }[]) =>
          servers.map((server) => ({ name: server.name, state: "none" })),
      },
    };
    const store = {
      ready: Promise.resolve(),
      authenticated: async (token: string) => token === "owner",
      db: {
        exec: async () => {},
        withAuthorization: async (_check: unknown, run: () => Promise<unknown>) => await run(),
      },
    };
    const http = new McpHttp({ store, hub } as never);
    const call = async (method: string, input: Record<string, unknown>, token = "owner") => {
      let body = "";
      await http.rpc(method, input, token, { end: (text: string) => (body = text) } as never);
      return JSON.parse(body).result;
    };
    return { call, start, signOut };
  }

  it("requires the owner credential before any sign-in work", async () => {
    const s = oauthSetup();
    for (const method of ["mcp.oauth.start", "mcp.oauth.status", "mcp.oauth.signOut"])
      await expect(s.call(method, { name: "remote" }, "nobody")).rejects.toThrow(/Owner device/);
    expect(s.start).not.toHaveBeenCalled();
    expect(s.signOut).not.toHaveBeenCalled();
  });

  it("validates input, only offers http servers and passes the inventory URL", async () => {
    const s = oauthSetup();
    await expect(s.call("mcp.oauth.start", { name: "local" })).rejects.toThrow(
      "Unknown MCP server.",
    );
    await expect(s.call("mcp.oauth.signOut", { name: "a b" })).rejects.toThrow(/Invalid/);
    expect(await s.call("mcp.oauth.status", {})).toEqual({
      servers: [{ name: "remote", state: "none" }],
    });
    expect((await s.call("mcp.oauth.start", { name: "remote" })).authorizationUrl).toContain(
      "https://auth.example",
    );
    expect(s.start).toHaveBeenCalledWith({ name: "remote", url: "https://remote.example/mcp" });
    expect(await s.call("mcp.oauth.signOut", { name: "remote" })).toEqual({ signedOut: true });
  });
});
