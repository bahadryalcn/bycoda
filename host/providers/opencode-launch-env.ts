import { basename } from "node:path";
import {
  opencodeConfigContent,
  parseExternalMcp,
} from "../../src/integrations/harness/core/externalMcpLaunch";

/** `opencode acp` as the Host launches it; other providers get no inline config. */
export function isOpencodeAcpLaunch(command: string, args: readonly unknown[]): boolean {
  return /^opencode(\.exe|\.cmd)?$/i.test(basename(command)) && args[0] === "acp";
}

/**
 * Environment that points an OpenCode child at the MCP hub: the Host's published
 * `externalMcp` fragment becomes OpenCode's inline config (`OPENCODE_CONFIG_CONTENT`),
 * which OpenCode merges after the user's global file, so hub-hosted stdio servers are
 * disabled there and reached over HTTP instead. Invalid or absent metadata yields no env.
 */
export function opencodeLaunchEnv(
  command: string,
  args: readonly unknown[],
  published: unknown,
): Record<string, string> {
  if (!isOpencodeAcpLaunch(command, args)) return {};
  const fragment =
    published && typeof published === "object" && "externalMcp" in published
      ? (published as { externalMcp: unknown }).externalMcp
      : undefined;
  const external = parseExternalMcp(fragment);
  const content = external ? opencodeConfigContent(external) : undefined;
  return content ? { OPENCODE_CONFIG_CONTENT: content } : {};
}
