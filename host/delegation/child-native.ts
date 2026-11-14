import {
  DELEGATION_CHAT_ONLY_KEY,
  DELEGATION_PARENT_KEY,
} from "../../src/shared/model/host-contracts/delegation";
import {
  LEAN_CONTEXT_KEY,
  MCP_SCOPE_BYCODA,
  MCP_SCOPE_KEY,
  NATIVE_TOOLS_KEY,
  NATIVE_TOOLS_READ_ONLY,
} from "../../src/integrations/harness/core/nativeToolLimits";

/** Providers that honor a read-only launch and a lean context; others never run chat-only children. */
export const CHAT_ONLY_PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex"]);

/**
 * Provider input of one delegated-child turn. A child starts only bycoda's MCP servers, and a
 * chat-only child (`files: false`) also runs read-only without memory or skill listing. Only
 * removes capability, so a forged marker can never widen a run. Other sessions pass unchanged.
 */
export function delegatedChildInput<
  T extends { modelSettings?: Record<string, string>; runtimeMode?: string },
>(provider: string, input: T): T {
  const settings = input.modelSettings;
  if (!settings?.[DELEGATION_PARENT_KEY]) return input;
  const chatOnly = settings[DELEGATION_CHAT_ONLY_KEY] === "on";
  if (chatOnly && !CHAT_ONLY_PROVIDERS.has(provider))
    throw new Error("Chat-only delegation (files: false) needs a Claude or Codex model.");
  return {
    ...input,
    ...(chatOnly && input.runtimeMode !== undefined ? { runtimeMode: "supervised" } : {}),
    modelSettings: {
      ...settings,
      [MCP_SCOPE_KEY]: MCP_SCOPE_BYCODA,
      ...(chatOnly ? { [NATIVE_TOOLS_KEY]: NATIVE_TOOLS_READ_ONLY, [LEAN_CONTEXT_KEY]: "on" } : {}),
    },
  };
}
