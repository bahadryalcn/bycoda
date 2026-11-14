import { socialBridge, socialSpawnArgs } from "./socialBridge";
import { runtimeLogsBridge, runtimeLogsSpawnArgs } from "./runtimeLogsBridge";
import { conversationToolsBridge, conversationToolsSpawnArgs } from "./conversationToolsBridge";
import { opencodeLaunchEnv } from "./externalMcpLaunch";

export type BridgedLaunch = { launchArgs: string[]; launchEnv?: Record<string, string> };
type BinaryProvider = Parameters<typeof socialSpawnArgs>[0];

/**
 * Claude then loads only the --mcp-config servers (the bycoda ones), not the owner's global,
 * project or plugin servers. Their settings, hooks and permissions still apply.
 */
export function strictClaudeMcp(args: string[]): string[] {
  return args[0]?.startsWith("-") && !args.includes("--strict-mcp-config")
    ? ["--strict-mcp-config", ...args]
    : args;
}

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
  autoCompact?: "on" | "off",
  bycodaMcpOnly?: boolean,
): Promise<BridgedLaunch> {
  if (binaryProvider === "claude" || binaryProvider === "codex") {
    // A child needs the conversation tools (agents.*) only; social and runtime logs stay with the owner's sessions.
    const [social, logs, conversation] = await Promise.all([
      bycodaMcpOnly ? null : socialBridge(sessionId),
      bycodaMcpOnly ? null : runtimeLogsBridge(sessionId),
      conversationToolsBridge(sessionId),
    ]);
    const withLogs = runtimeLogsSpawnArgs(
      binaryProvider,
      socialSpawnArgs(binaryProvider, args, social),
      logs,
    );
    // A child gets bycoda's own tools only, so the Host MCP hub's user servers are not wired in.
    const scoped =
      bycodaMcpOnly && conversation ? { ...conversation, externalMcp: undefined } : conversation;
    const launchArgs = conversationToolsSpawnArgs(binaryProvider, withLogs, scoped);
    return {
      launchArgs:
        bycodaMcpOnly && binaryProvider === "claude" ? strictClaudeMcp(launchArgs) : launchArgs,
    };
  }
  if (binaryProvider === "opencode")
    return {
      launchArgs: args,
      launchEnv: autoCompact
        ? opencodeLaunchEnv((await conversationToolsBridge(sessionId))?.externalMcp, autoCompact)
        : opencodeLaunchEnv((await conversationToolsBridge(sessionId))?.externalMcp),
    };
  return { launchArgs: args };
}
