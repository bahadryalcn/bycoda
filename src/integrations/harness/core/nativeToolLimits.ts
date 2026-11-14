/**
 * The Host narrows a crew member's provider-native tools by adding this setting to the
 * provider input of its session (`host/crews/crew-native-tools.ts`). Adapters that can
 * honor it read it here; it only ever removes tools and never widens the run's mode.
 */
export const NATIVE_TOOLS_KEY = "nativeTools";
export const NATIVE_TOOLS_READ_ONLY = "read-only";

export const nativeReadOnly = (settings: Readonly<Record<string, string>> | undefined): boolean =>
  settings?.[NATIVE_TOOLS_KEY] === NATIVE_TOOLS_READ_ONLY;

/**
 * Set by the Host on a delegated child's provider input (`host/delegation/child-native.ts`):
 * the child starts only bycoda's own MCP servers, never the owner's other configured ones.
 */
export const MCP_SCOPE_KEY = "mcpScope";
export const MCP_SCOPE_BYCODA = "bycoda";
/** A chat-only child (`files: false`) also skips provider memory and the skill listing. */
export const LEAN_CONTEXT_KEY = "leanContext";

export const bycodaMcpOnly = (settings: Readonly<Record<string, string>> | undefined): boolean =>
  settings?.[MCP_SCOPE_KEY] === MCP_SCOPE_BYCODA;

export const leanContext = (settings: Readonly<Record<string, string>> | undefined): boolean =>
  settings?.[LEAN_CONTEXT_KEY] === "on";
