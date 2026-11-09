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
import { conversationToolsBridge } from "./conversationToolsBridge";
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
