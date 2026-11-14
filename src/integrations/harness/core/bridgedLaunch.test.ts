import { expect, it, vi } from "vitest";

vi.mock("./socialBridge", () => ({
  socialBridge: vi.fn(async () => null),
  socialSpawnArgs: vi.fn((_provider: unknown, args: string[]) => [...args, "--social"]),
}));
vi.mock("./runtimeLogsBridge", () => ({
  runtimeLogsBridge: vi.fn(async () => null),
  runtimeLogsSpawnArgs: vi.fn((_provider: unknown, args: string[]) => [...args, "--logs"]),
}));
vi.mock("./conversationToolsBridge", () => ({
  conversationToolsBridge: vi.fn(async () => ({ externalMcp: { servers: [] } })),
  conversationToolsSpawnArgs: vi.fn((_provider: unknown, args: string[]) => [...args, "--conv"]),
}));
vi.mock("./externalMcpLaunch", () => ({
  opencodeLaunchEnv: vi.fn(() => ({ OPENCODE_CONFIG_CONTENT: "{}" })),
}));

import { bridgedLaunch } from "./bridgedLaunch";
import { socialSpawnArgs } from "./socialBridge";
import { runtimeLogsSpawnArgs } from "./runtimeLogsBridge";
import { conversationToolsBridge, conversationToolsSpawnArgs } from "./conversationToolsBridge";
import { opencodeLaunchEnv } from "./externalMcpLaunch";

it("routes Claude and Codex through the bridge launch arguments without an environment", async () => {
  for (const provider of ["claude", "codex"] as const) {
    const launch = await bridgedLaunch(provider, "session", ["acp"]);
    expect(launch).toEqual({ launchArgs: ["acp", "--social", "--logs", "--conv"] });
  }
});

it("gives OpenCode an inline config environment and untouched arguments", async () => {
  const launch = await bridgedLaunch("opencode", "session", ["acp"]);
  expect(launch).toEqual({
    launchArgs: ["acp"],
    launchEnv: { OPENCODE_CONFIG_CONTENT: "{}" },
  });
  expect(vi.mocked(opencodeLaunchEnv)).toHaveBeenCalledWith({ servers: [] });
});

it("leaves other providers alone", async () => {
  vi.mocked(conversationToolsBridge).mockClear();
  expect(await bridgedLaunch("grok", "session", ["--acp"])).toEqual({ launchArgs: ["--acp"] });
  expect(await bridgedLaunch(undefined, "session", [])).toEqual({ launchArgs: [] });
  expect(conversationToolsBridge).not.toHaveBeenCalled();
});

it("passes the isolated OpenCode compaction override alongside bridge metadata", async () => {
  await bridgedLaunch("opencode", "session", ["serve"], "off");
  expect(opencodeLaunchEnv).toHaveBeenLastCalledWith({ servers: [] }, "off");
});

it("starts a delegated Claude child with strict MCP and only the conversation bridge", async () => {
  const { socialBridge } = await import("./socialBridge");
  const { runtimeLogsBridge } = await import("./runtimeLogsBridge");
  vi.mocked(socialBridge).mockClear();
  vi.mocked(runtimeLogsBridge).mockClear();
  vi.mocked(conversationToolsBridge).mockClear();
  const launch = await bridgedLaunch("claude", "child", ["--verbose"], undefined, true);
  expect(launch.launchArgs[0]).toBe("--strict-mcp-config");
  expect(launch.launchArgs.filter((arg) => arg === "--strict-mcp-config")).toHaveLength(1);
  expect(launch.launchArgs).toContain("--conv");
  // The mocked launchers append their flag unconditionally; what matters is the bridge they get.
  expect(vi.mocked(socialSpawnArgs).mock.calls.at(-1)?.[2]).toBeNull();
  expect(vi.mocked(runtimeLogsSpawnArgs).mock.calls.at(-1)?.[2]).toBeNull();
  expect(socialBridge).not.toHaveBeenCalled();
  expect(runtimeLogsBridge).not.toHaveBeenCalled();
  // The hub's user servers are not wired into a child.
  expect(vi.mocked(conversationToolsSpawnArgs).mock.calls.at(-1)?.[2]).toMatchObject({
    externalMcp: undefined,
  });
});

it("leaves Codex launch args free of strict flags for a delegated child", async () => {
  const launch = await bridgedLaunch("codex", "child", ["app-server"], undefined, true);
  expect(launch.launchArgs).not.toContain("--strict-mcp-config");
  expect(vi.mocked(socialSpawnArgs).mock.calls.at(-1)?.[2]).toBeNull();
});
