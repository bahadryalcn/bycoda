import {
  DELEGATION_CHAT_ONLY_KEY,
  DELEGATION_PARENT_KEY,
  decodeDelegationParent,
} from "../../src/shared/model/host-contracts/delegation";
import { buildConversationReplay } from "../../src/features/sessions/model/conversationRewind";
import type { Session } from "../../src/features/sessions/model/session";
import { grokChatOnlyAvailable } from "../providers/grok-chat-only";
import { geminiChatOnlyAvailable } from "../providers/gemini-chat-only";
import {
  LEAN_CONTEXT_KEY,
  MCP_SCOPE_BYCODA,
  MCP_SCOPE_KEY,
  NATIVE_TOOLS_KEY,
  NATIVE_TOOLS_READ_ONLY,
} from "../../src/integrations/harness/core/nativeToolLimits";

/** Providers that honor a read-only launch and a lean context; others never run chat-only children. */
const CHAT_ONLY_PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex", "pi"]);

const TEXT_ONLY_PROVIDERS: ReadonlySet<string> = new Set(["opencode", "grok", "antigravity"]);

export function chatOnlyAvailable(ref: {
  harness: string;
  model: string;
  providerAccountId?: string;
}): boolean {
  switch (ref.harness) {
    case "grok":
      return grokChatOnlyAvailable(ref);
    case "antigravity":
      return geminiChatOnlyAvailable(ref);
    case "opencode":
      return true;
    default:
      return CHAT_ONLY_PROVIDERS.has(ref.harness);
  }
}

/** Build replay from this child's saved text, ending before the new prompt. */
export function delegatedChatOnlyHistory(
  session: Session,
  userBlockId?: string,
): string | undefined {
  const settings = session.modelSettings;
  if (
    !TEXT_ONLY_PROVIDERS.has(session.harness) ||
    settings?.[DELEGATION_CHAT_ONLY_KEY] !== "on" ||
    !decodeDelegationParent(settings[DELEGATION_PARENT_KEY])
  )
    return undefined;
  const index = session.blocks.findIndex(
    (block) => block.id === userBlockId && block.role === "user",
  );
  if (index < 0) throw new Error("Cannot identify the current chat-only delegation turn.");
  return buildConversationReplay(
    session.blocks
      .slice(0, index)
      .flatMap((block) =>
        (block.role === "user" || block.role === "assistant") && !block.internal && !block.draft
          ? [{ id: block.id, role: block.role, text: block.text }]
          : [],
      ),
  );
}

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
  if (chatOnly && !CHAT_ONLY_PROVIDERS.has(provider) && !TEXT_ONLY_PROVIDERS.has(provider))
    throw new Error("Chat-only delegation (files: false) is unavailable for this provider.");
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
