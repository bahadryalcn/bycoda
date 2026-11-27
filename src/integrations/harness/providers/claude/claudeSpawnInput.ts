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
  chrome?: boolean;
  /** Retain only the provider transcript while preserving isolated hooks/MCP policy. */
  persistSession?: boolean;
  /** Bycoda owns the conversation history while normal Claude tools stay available. */
  privateDelegateHistory?: boolean;
  /** Folders beyond the cwd the session may read and edit. */
  additionalDirs?: readonly string[];
  /** No skill listing and no auto memory: a chat-only delegated child needs neither. */
  leanContext?: boolean;
  /** Permission rules pre-allowed for a non-interactive session, e.g. `WebFetch(domain:example.com)`. */
  allowedTools?: readonly string[];
} & ClaudeNativeLimits;
