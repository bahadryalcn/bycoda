import { socialBridge, socialSpawnArgs } from "./socialBridge";
import { runtimeLogsBridge, runtimeLogsSpawnArgs } from "./runtimeLogsBridge";
import { conversationToolsBridge, conversationToolsSpawnArgs } from "./conversationToolsBridge";
import { opencodeLaunchEnv } from "./externalMcpLaunch";

export type BridgedLaunch = { launchArgs: string[]; launchEnv?: Record<string, string> };
type BinaryProvider = Parameters<typeof socialSpawnArgs>[0];

/** Providers whose launch goes through the Host tool bridges. */
export function bridgedProvider(provider: BinaryProvider): boolean {
  return provider === "claude" || provider === "codex" || provider === "opencode";
}

/**
 * Launch arguments and environment that route a provider child through the Host's tool
 * bridges. Claude and Codex take the social, runtime-log and conversation bridges as
 * launch arguments; OpenCode reads its MCP table from its own config, so the hub reaches it
 * through an inline config document in the child environment instead.
 */
export async function bridgedLaunch(
  binaryProvider: BinaryProvider,
  sessionId: string,
  args: string[],
): Promise<BridgedLaunch> {
  if (binaryProvider === "claude" || binaryProvider === "codex") {
    const [social, logs, conversation] = await Promise.all([
      socialBridge(sessionId),
      runtimeLogsBridge(sessionId),
      conversationToolsBridge(sessionId),
    ]);
    const withLogs = runtimeLogsSpawnArgs(
      binaryProvider,
      socialSpawnArgs(binaryProvider, args, social),
      logs,
    );
    return { launchArgs: conversationToolsSpawnArgs(binaryProvider, withLogs, conversation) };
  }
  if (binaryProvider === "opencode")
    return {
      launchArgs: args,
      launchEnv: opencodeLaunchEnv((await conversationToolsBridge(sessionId))?.externalMcp),
    };
  return { launchArgs: args };
}
