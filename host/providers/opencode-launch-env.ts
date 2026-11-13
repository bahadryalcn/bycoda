import { win32 } from "node:path";
import {
  opencodeConfigContent,
  parseExternalMcp,
} from "../../src/integrations/harness/core/externalMcpLaunch";

/** `opencode acp` as the Host launches it; other providers get no inline config. */
export function isOpencodeAcpLaunch(command: string, args: readonly unknown[]): boolean {
  return /^opencode(\.exe|\.cmd)?$/i.test(win32.basename(command)) && args[0] === "acp";
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

/** Only an isolated serve process accepts a renderer's primitive compaction choice. */
export function opencodeSessionCompaction(args: Record<string, unknown>): "on" | "off" | undefined {
  const value = args.autoCompact;
  if (value === undefined) return undefined;
  if (
    (value !== "on" && value !== "off") ||
    args.binaryProvider !== "opencode" ||
    args.genericAcpId ||
    !Array.isArray(args.args) ||
    args.args[0] !== "serve"
  ) {
    throw new Error("Invalid isolated OpenCode compaction setting.");
  }
  return value;
}

/** Merge into Host-owned config; renderer environment/MCP credentials are never copied. */
export function opencodeCompactionEnv(
  content: string | undefined,
  mode: "on" | "off" | undefined,
): Record<string, string> {
  if (!mode) return {};
  if (content && content.length > 64 * 1024)
    throw new Error("OpenCode inline configuration is too large.");
  const config: unknown = content ? JSON.parse(content) : {};
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new Error("Invalid OpenCode inline configuration.");
  const current = config as Record<string, unknown>;
  const compaction = current.compaction;
  if (
    compaction !== undefined &&
    (!compaction || typeof compaction !== "object" || Array.isArray(compaction))
  )
    throw new Error("Invalid OpenCode compaction configuration.");
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...current,
      compaction: { ...(compaction as Record<string, unknown>), auto: mode === "on" },
    }),
  };
}
