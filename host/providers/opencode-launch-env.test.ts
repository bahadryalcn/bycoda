import { describe, expect, it } from "vitest";
import {
  isOpencodeAcpLaunch,
  opencodeLaunchEnv,
  opencodeSessionCompaction,
  opencodeCompactionEnv,
} from "./opencode-launch-env";

it("accepts compaction only for an isolated OpenCode serve process", () => {
  expect(
    opencodeSessionCompaction({ binaryProvider: "opencode", args: ["serve"], autoCompact: "off" }),
  ).toBe("off");
  expect(opencodeSessionCompaction({})).toBeUndefined();
  for (const input of [
    { binaryProvider: "opencode", args: ["service", "start"], autoCompact: "off" },
    { binaryProvider: "opencode", args: ["acp"], autoCompact: "on" },
    { binaryProvider: "codex", args: ["serve"], autoCompact: "on" },
    { binaryProvider: "opencode", args: ["serve"], autoCompact: "default" },
    { binaryProvider: "opencode", genericAcpId: "custom", args: ["serve"], autoCompact: "off" },
  ])
    expect(() => opencodeSessionCompaction(input)).toThrow("Invalid isolated OpenCode");
});

it("preserves Host config and keeps Default free of overrides", () => {
  const config = {
    mcp: { owner: { enabled: true } },
    compaction: { prune: false, reserved: 10000 },
  };
  expect(
    JSON.parse(opencodeCompactionEnv(JSON.stringify(config), "off").OPENCODE_CONFIG_CONTENT),
  ).toEqual({
    ...config,
    compaction: { ...config.compaction, auto: false },
  });
  expect(opencodeCompactionEnv("not JSON", undefined)).toEqual({});
  for (const content of ["null", "[]", "not JSON", '{"compaction":false}', " ".repeat(65537)]) {
    expect(() => opencodeCompactionEnv(content, "on")).toThrow();
  }
});

const published = {
  externalMcp: {
    servers: [
      {
        name: "blender",
        url: "http://127.0.0.1:3776/mcp/ext/blender",
        kind: "stdio",
        mode: "shared",
        sources: ["claude", "opencode"],
      },
    ],
    disable: { claude: ["blender"], codex: [], opencode: ["blender", "rea"] },
  },
};

describe("opencode launch env", () => {
  it("recognises only an opencode acp launch", () => {
    expect(isOpencodeAcpLaunch("C:\\Users\\me\\.bun\\bin\\opencode.exe", ["acp"])).toBe(true);
    expect(isOpencodeAcpLaunch("/usr/local/bin/opencode", ["acp"])).toBe(true);
    expect(isOpencodeAcpLaunch("/usr/local/bin/opencode", ["serve"])).toBe(false);
    expect(isOpencodeAcpLaunch("/usr/local/bin/claude", ["acp"])).toBe(false);
  });

  it("turns the published hub fragment into an inline config that disables local copies", () => {
    const env = opencodeLaunchEnv("opencode.exe", ["acp"], published);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    expect(config.mcp.rea).toEqual({
      type: "local",
      command: ["bycoda-hub-hosted"],
      enabled: false,
    });
    expect(config.mcp.blender).toMatchObject({
      type: "remote",
      url: "http://127.0.0.1:3776/mcp/ext/blender",
      enabled: true,
    });
    // The token travels by env reference only.
    expect(env.OPENCODE_CONFIG_CONTENT).toContain("{env:BYCODA_CONVERSATION_TOKEN}");
    expect(env.OPENCODE_CONFIG_CONTENT).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
  });

  it("yields nothing for other providers or for absent and invalid metadata", () => {
    expect(opencodeLaunchEnv("claude", ["--print"], published)).toEqual({});
    expect(opencodeLaunchEnv("opencode", ["acp"], undefined)).toEqual({});
    expect(opencodeLaunchEnv("opencode", ["acp"], { externalMcp: { servers: "x" } })).toEqual({});
    expect(
      opencodeLaunchEnv("opencode", ["acp"], {
        externalMcp: { servers: [], disable: { claude: [], codex: [] } },
      }),
    ).toEqual({});
  });
});
