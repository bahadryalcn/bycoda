import { expect, it } from "vitest";
import type { McpHubServer, McpLoadingState } from "./mcp";
import {
  buildMcpCatalog,
  mcpEntrySearchText,
  mcpEntryStatus,
  type McpCatalogEntry,
} from "./mcpCatalog";
import type { McpServerRow } from "./mcpSettingsCache";

const row = (
  over: Partial<McpServerRow> & Pick<McpServerRow, "provider" | "name">,
): McpServerRow => ({
  scope: "user",
  configPath: `/config/${over.provider}`,
  transport: "stdio",
  status: "Configured",
  ...over,
});
const hubServer = (over: Partial<McpHubServer> & Pick<McpHubServer, "name">): McpHubServer => ({
  kind: "stdio",
  source: "claude",
  sources: ["claude"],
  aliases: [],
  signedIn: false,
  ...over,
});
const loading = (
  inventory: McpHubServer[],
  over: { direct?: string[]; servers?: string[] } = {},
): McpLoadingState => ({
  policy: { version: 1, mode: "onDemand", direct: over.direct ?? [] },
  corrupt: false,
  servers: over.servers ?? [],
  inventory,
});
const never = () => false;

it("groups provider rows by name in discovery order and sorts entries", () => {
  const rows = [
    row({ provider: "claude", name: "zed" }),
    row({ provider: "claude", name: "shared", scope: "project" }),
    row({ provider: "codex", name: "shared" }),
  ];
  const catalog = buildMcpCatalog(rows, undefined, undefined);
  expect(catalog.map((entry) => entry.name)).toEqual(["shared", "zed"]);
  expect(catalog[0].configs.map((config) => config.provider)).toEqual(["claude", "codex"]);
  expect(catalog[0].hub).toBeUndefined();
});

it("attaches the hub entry through its provider alias, including a suffixed hub name", () => {
  const rows = [
    row({ provider: "claude", name: "blender" }),
    row({ provider: "opencode", name: "blender" }),
    row({ provider: "claude", name: "docs", transport: "http" }),
  ];
  const catalog = buildMcpCatalog(
    rows,
    loading(
      [
        hubServer({ name: "blender", aliases: [{ provider: "claude", name: "blender" }] }),
        hubServer({
          name: "blender-opencode",
          aliases: [{ provider: "opencode", name: "blender" }],
        }),
        hubServer({
          name: "docs",
          kind: "http",
          aliases: [{ provider: "claude", name: "docs" }],
          signedIn: true,
        }),
      ],
      { direct: ["docs"], servers: ["docs"] },
    ),
    [{ name: "docs", state: "expired" }],
  );
  // One name, one entry; the second alias match claims the entry only while it has no hub yet.
  const blender = catalog.find((entry) => entry.name === "blender")!;
  expect(blender.hub?.name).toBe("blender");
  const extra = catalog.find((entry) => entry.name === "blender-opencode")!;
  expect(extra.configs).toEqual([]);
  expect(extra.hub?.name).toBe("blender-opencode");
  const docs = catalog.find((entry) => entry.name === "docs")!;
  expect(docs.hub).toMatchObject({
    kind: "http",
    direct: true,
    directEligible: true,
    oauth: "expired",
  });
});

it("aliases a suffixed hub name onto the opencode row when only opencode declares it", () => {
  const catalog = buildMcpCatalog(
    [row({ provider: "opencode", name: "blender" })],
    loading([
      hubServer({
        name: "blender-opencode",
        aliases: [{ provider: "opencode", name: "blender" }],
      }),
    ]),
    undefined,
  );
  expect(catalog).toHaveLength(1);
  expect(catalog[0].name).toBe("blender");
  expect(catalog[0].configs).toHaveLength(1);
  expect(catalog[0].hub?.name).toBe("blender-opencode");
});

it("lists host-only plugin and account servers once, without configs", () => {
  const catalog = buildMcpCatalog(
    [row({ provider: "claude", name: "local" })],
    loading([
      hubServer({
        name: "plugin:github",
        source: "claude-plugin",
        sources: ["claude-plugin"],
        aliases: [{ provider: "claude", name: "github" }],
      }),
      hubServer({ name: "acct", source: "codex-account", sources: ["codex-account"] }),
    ]),
    undefined,
  );
  expect(catalog.map((entry) => entry.name)).toEqual(["acct", "github", "local"]);
  const github = catalog.find((entry) => entry.name === "github")!;
  expect(github.configs).toEqual([]);
  expect(github.hub?.name).toBe("plugin:github");
  expect(github.hub?.sources).toEqual(["claude-plugin"]);
});

it("uses the hub name when a host-only alias collides with an existing entry", () => {
  const catalog = buildMcpCatalog(
    [row({ provider: "cursor", name: "github" })],
    loading([
      hubServer({
        name: "github-plugin",
        aliases: [{ provider: "claude", name: "github" }],
      }),
    ]),
    undefined,
  );
  expect(catalog.map((entry) => entry.name)).toEqual(["github", "github-plugin"]);
});

it("falls back to the inventory sign-in flag until mcp.oauth.status answers", () => {
  const inventory = [
    hubServer({ name: "a", kind: "http", signedIn: true }),
    hubServer({ name: "b", kind: "http" }),
    hubServer({ name: "c", kind: "stdio", signedIn: true }),
  ];
  const byName = (catalog: McpCatalogEntry[], name: string) =>
    catalog.find((entry) => entry.name === name)!.hub!;
  const catalog = buildMcpCatalog([], loading(inventory), undefined);
  expect(byName(catalog, "a").oauth).toBe("signed-in");
  expect(byName(catalog, "b").oauth).toBeUndefined();
  expect(byName(catalog, "c").oauth).toBeUndefined();
  const answered = buildMcpCatalog([], loading(inventory), [{ name: "a", state: "none" }]);
  expect(byName(answered, "a").oauth).toBe("none");
});

const entry = (
  configs: McpServerRow[],
  oauth?: NonNullable<McpCatalogEntry["hub"]>["oauth"],
): McpCatalogEntry => ({
  name: "x",
  configs,
  ...(oauth !== undefined || configs.length === 0
    ? {
        hub: {
          name: "x",
          kind: "http" as const,
          sources: [],
          oauth,
          direct: false,
          directEligible: false,
        },
      }
    : {}),
});

it("derives one status with the documented precedence", () => {
  const on = row({ provider: "claude", name: "x", transport: "http" });
  const off = { ...on, enabled: false };
  const connected = (r: McpServerRow) => r.status === "Connected";
  const needs = (r: McpServerRow) => r.transport === "http";
  // every provider row off beats a stored sign-in
  expect(mcpEntryStatus(entry([off], "signed-in"), connected, needs)).toBe("off");
  // a disabled row does not count as live access
  expect(mcpEntryStatus(entry([off, on]), never, never)).toBe("configured");
  // host sign-in or a provider-confirmed connection proves access
  expect(mcpEntryStatus(entry([on], "signed-in"), never, needs)).toBe("ready");
  expect(mcpEntryStatus(entry([{ ...on, status: "Connected" }], "none"), connected, needs)).toBe(
    "ready",
  );
  expect(mcpEntryStatus(entry([on], "expired"), never, never)).toBe("expired");
  expect(mcpEntryStatus(entry([on], "none"), never, never)).toBe("sign-in");
  expect(mcpEntryStatus(entry([on], "error"), never, never)).toBe("sign-in");
  expect(mcpEntryStatus(entry([on]), never, needs)).toBe("sign-in");
  expect(mcpEntryStatus(entry([on]), never, never)).toBe("configured");
  // A provider-reported sign-in (Codex auth) proves access like a connection.
  expect(mcpEntryStatus(entry([{ ...on, auth: "signed_in" }]), never, needs)).toBe("ready");
  // host-only entries have no configs to turn off
  expect(mcpEntryStatus(entry([]), never, never)).toBe("configured");
});

it("builds lowercase search text from name, hub, sources, providers, transport and path", () => {
  const search = mcpEntrySearchText(
    {
      name: "Sentry",
      configs: [
        row({ provider: "codex", name: "Sentry", transport: "http", configPath: "/Home/Cfg.toml" }),
      ],
      hub: {
        name: "Sentry-Hub",
        kind: "http",
        sources: ["codex-account"],
        direct: false,
        directEligible: false,
      },
    },
    (config) => `Codex ${config.scope}`,
  );
  for (const part of [
    "sentry",
    "sentry-hub",
    "codex-account",
    "codex user",
    "http",
    "/home/cfg.toml",
  ])
    expect(search).toContain(part);
  expect(search).toBe(search.toLocaleLowerCase());
});
