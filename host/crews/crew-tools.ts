import { parseCrewTools, type CrewToolProfile } from "../../src/features/crews/model/crewTools";
import {
  CREW_TOOLS_KEY,
  DELEGATION_LIMITS,
} from "../../src/shared/model/host-contracts/delegation";
import { CONVERSATION_READ_ACTIONS } from "../conversation/conversation-read-actions";
import { isRoomOnlyConversationAction } from "../conversation/conversation-tools";

/**
 * Per-member narrowing of Host Conversation Tools. A profile is stored on the member,
 * snapshotted with the run, and written into the member session's reserved model setting
 * when the Host starts that session. Every Conversation Tool call of such a session is
 * checked here before the existing authorization, so the profile can only remove actions;
 * the run's access mode and owner approval gates are untouched. A session without the
 * setting is unrestricted.
 *
 * Provider-native tools (shell, file edits) and outgoing MCP servers are outside this
 * check: the Host has no per-session switch for them.
 */

/** Member coordination stays available to every profile; it grants no write access. */
const ALWAYS_ALLOWED: readonly string[] = [
  "tools.list",
  "tools.search",
  "tools.describe",
  "tools.status",
  "crews.request",
];

const PRESET_EXTRA: Record<"design" | "browser", readonly string[]> = {
  design: ["images.generate", "visuals.preview", "visuals.render", "images.status"],
  browser: ["browser.*"],
};

const entryMatches = (entry: string, action: string) =>
  entry === action ||
  (entry.endsWith(".*") ? action.startsWith(entry.slice(0, -1)) : action.startsWith(`${entry}.`));

/** Presets are action allowlists derived from the real catalog; `code` has none. */
function presetAllows(profile: CrewToolProfile, action: string): boolean {
  if (profile.preset === "code" || profile.preset === "custom") return true;
  if (CONVERSATION_READ_ACTIONS.has(action)) return true;
  if (profile.preset === "read-only") return false;
  return PRESET_EXTRA[profile.preset].some((entry) => entryMatches(entry, action));
}

export function crewToolAllowed(profile: CrewToolProfile | undefined, action: string): boolean {
  if (!profile) return true;
  if (ALWAYS_ALLOWED.includes(action)) return true;
  if (!presetAllows(profile, action)) return false;
  return (
    !profile.conversationTools ||
    profile.conversationTools.some((entry) => entryMatches(entry, action))
  );
}

export function assertCrewToolAllowed(profile: CrewToolProfile | undefined, action: string): void {
  if (!crewToolAllowed(profile, action))
    throw new Error(
      `This crew member's tool profile (${profile?.preset}) does not allow ${action}. Ask the owner to change the member's tools.`,
    );
}

/** Reads a session's profile; present but unreadable fails closed to read-only. */
export function crewToolProfileOf(
  modelSettings: Readonly<Record<string, string>> | undefined,
): CrewToolProfile | undefined {
  const raw = modelSettings?.[CREW_TOOLS_KEY];
  if (raw === undefined) return undefined;
  try {
    if (raw.length > DELEGATION_LIMITS.valueBytes) throw new Error("too large");
    return parseCrewTools(JSON.parse(raw)) ?? { preset: "code" };
  } catch {
    return { preset: "read-only" };
  }
}

/**
 * Applies the session's crew profile to one validated session Conversation Tool call.
 * Returns the discovery filter: session-visible Conversation Tools the profile allows,
 * plus other tool groups unchanged.
 */
export async function crewToolGate(
  dependencies: {
    inHost(sessionId: string): Promise<boolean>;
    engine: {
      store: {
        session(
          sessionId: string,
        ): Promise<{ session: { modelSettings?: Record<string, string> } }>;
      };
    };
  },
  principal: { sessionId: string },
  action: string,
): Promise<(tool: { action: string; group?: string }) => boolean> {
  const profile = await sessionProfile(dependencies, principal.sessionId);
  assertCrewToolAllowed(profile, action);
  return (tool) =>
    tool.group === undefined || tool.group === "conversation"
      ? !isRoomOnlyConversationAction(tool.action) && crewToolAllowed(profile, tool.action)
      : true;
}

/**
 * A session gets its profile when the Host starts it and keeps it for life (model changes
 * carry it), so the answer, including "none", is cached per session id after one read.
 * Sessions that only exist on the desktop are never Host crew sessions and are not read.
 */
const profiles = new Map<string, CrewToolProfile | undefined>();
async function sessionProfile(
  dependencies: Parameters<typeof crewToolGate>[0],
  sessionId: string,
): Promise<CrewToolProfile | undefined> {
  if (profiles.has(sessionId)) return profiles.get(sessionId);
  if (!(await dependencies.inHost(sessionId))) return undefined;
  const profile = crewToolProfileOf(
    (await dependencies.engine.store.session(sessionId)).session.modelSettings,
  );
  if (profiles.size >= 512) profiles.clear();
  profiles.set(sessionId, profile);
  return profile;
}
