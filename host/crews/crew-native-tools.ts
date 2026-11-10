import type { CrewToolProfile } from "../../src/features/crews/model/crewTools";
import {
  NATIVE_TOOLS_KEY,
  NATIVE_TOOLS_READ_ONLY,
} from "../../src/integrations/harness/core/nativeToolLimits";
import { crewToolProfileOf } from "./crew-tools";

/**
 * Enforcement of a crew member's profile on what the provider itself runs: native tools
 * (shell, file edits), outgoing MCP servers and skills. Host Conversation Tools are
 * checked in `crew-tools.ts`. A profile only removes capability: the run's mode is never
 * raised, and a provider that cannot honor a restriction refuses to launch the member
 * instead of running it with write tools.
 *
 * Provider mechanisms: Claude removes its edit and shell tools; Codex runs a read-only
 * sandbox with no approval path. No other provider has a per-session switch the Host can
 * set, so they fail closed.
 */
const NATIVE_READ_ONLY_PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex"]);
/** Providers whose user MCP servers go through the Host MCP hub, which can filter them. */
const MCP_FILTER_PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex", "opencode"]);
/** Presets that remove native write tools; `code` and `custom` leave them as the run allows. */
const NATIVE_READ_ONLY_PRESETS: ReadonlySet<string> = new Set(["read-only", "design", "browser"]);

const LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  pi: "Pi",
  omp: "OMP",
  fx: "FX",
  hermes: "Hermes",
  antigravity: "Antigravity",
  acp: "Generic ACP",
};
const label = (provider: string) => LABELS[provider] ?? provider;

export const crewNativeReadOnly = (profile: CrewToolProfile | undefined): boolean =>
  !!profile && NATIVE_READ_ONLY_PRESETS.has(profile.preset);

/**
 * Provider input for one crew-member operation. Returns the input unchanged when the
 * session has no restricting profile; throws when the provider cannot honor it.
 */
export function crewNativeInput<
  T extends { modelSettings?: Record<string, string>; runtimeMode?: string },
>(provider: string, input: T): T {
  const profile = crewToolProfileOf(input.modelSettings);
  if (!profile) return input;
  if (profile.mcpServers && !MCP_FILTER_PROVIDERS.has(provider))
    throw new Error(`${label(provider)} cannot restrict MCP servers for crew members.`);
  if (!crewNativeReadOnly(profile)) return input;
  if (!NATIVE_READ_ONLY_PROVIDERS.has(provider))
    throw new Error(`${label(provider)} cannot run read-only members.`);
  return {
    ...input,
    ...(input.runtimeMode === undefined ? {} : { runtimeMode: "supervised" }),
    modelSettings: { ...input.modelSettings, [NATIVE_TOOLS_KEY]: NATIVE_TOOLS_READ_ONLY },
  };
}

/** Outgoing MCP server names the session's member may use; undefined means unrestricted. */
export const crewMcpServers = (
  modelSettings: Readonly<Record<string, string>> | undefined,
): readonly string[] | undefined => crewToolProfileOf(modelSettings)?.mcpServers;

/** Skill names from `candidates` that the session's member may not use. */
export function crewDeniedSkills(
  modelSettings: Readonly<Record<string, string>> | undefined,
  candidates: readonly { name: string }[],
): string[] {
  const allowed = crewToolProfileOf(modelSettings)?.skills;
  if (!allowed) return [];
  return [...new Set(candidates.map((skill) => skill.name).filter((n) => !allowed.includes(n)))];
}
