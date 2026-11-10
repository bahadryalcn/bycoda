import type { ClaudeCliSettings, ClaudePermissionMode } from "./claudeProtocol";
import type { ClaudeNativeLimits } from "./claudeToolLimits";

/** Everything one Claude process launch is built from. */
export type ClaudeSpawnInput = {
  model?: string;
  advisor?: string;
  subagentModel?: string;
  subagentPolicy?: string;
  effort?: string;
  permissionMode?: ClaudePermissionMode;
  resume?: string;
  sessionId?: string;
  settings?: ClaudeCliSettings;
  includePartialMessages?: boolean;
  maxTurns?: number;
  isolated?: boolean;
  /** Retain only the provider transcript while preserving isolated hooks/MCP policy. */
  persistSession?: boolean;
  /** Folders beyond the cwd the session may read and edit. */
  additionalDirs?: readonly string[];
} & ClaudeNativeLimits;
