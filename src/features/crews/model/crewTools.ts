/**
 * A member's tool profile. It can only narrow what the member's sessions may use; the
 * run's access mode and every owner approval gate still apply on top of it.
 */
export const CREW_TOOL_PRESETS = ["read-only", "code", "design", "browser", "custom"] as const;
export type CrewToolPreset = (typeof CREW_TOOL_PRESETS)[number];
/** Capabilities a read-only member can add; combinable (`design` and `browser` presets are the single-extra forms). */
export const CREW_TOOL_EXTRAS = ["design", "browser"] as const;
export type CrewToolExtra = (typeof CREW_TOOL_EXTRAS)[number];
export type CrewToolProfile = {
  /** Base allowance. `read-only`, `design` and `browser` are non-writing; `code` and `custom` allow every Host tool. */
  preset: CrewToolPreset;
  /** Added to a non-writing preset (union with the preset's own extra); ignored and dropped for `code`/`custom`. */
  extras?: CrewToolExtra[];
  /** Host action ids (`files.read`) or groups (`browser`, `browser.*`); narrows the preset. */
  conversationTools?: string[];
  /** Outgoing MCP server names the member may use; the Host hides the rest at launch. */
  mcpServers?: string[];
  /** Skill names the member may use; the Host disables the rest through the skill policy. */
  skills?: string[];
};

export const CREW_TOOL_LIMITS = { actions: 120, names: 50, nameChars: 100 } as const;
export const validCrewToolAction = (entry: string) => ACTION_PATTERN.test(entry);
const ACTION_PATTERN = /^[a-z][A-Za-z0-9]{0,40}(?:\.(?:\*|[A-Za-z0-9]{1,40})){0,3}$/;

const list = (
  value: unknown,
  max: number,
  valid: (entry: string) => boolean,
): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid member tools");
  const entries = value.map((entry) => {
    if (typeof entry !== "string" || !valid(entry.trim())) throw new Error("Invalid member tools");
    return entry.trim();
  });
  const unique = [...new Set(entries)];
  return unique.length ? unique : undefined;
};

const extrasOf = (value: unknown): CrewToolExtra[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid member tools");
  return value.map((entry) => {
    const extra = CREW_TOOL_EXTRAS.find((candidate) => candidate === entry);
    if (!extra) throw new Error("Invalid member tools");
    return extra;
  });
};

/** Effective extras of a non-writing profile: the preset's own extra plus `extras`, deduplicated. */
export const crewToolExtras = (
  profile: Pick<CrewToolProfile, "preset" | "extras">,
): CrewToolExtra[] =>
  CREW_TOOL_EXTRAS.filter(
    (extra) => profile.preset === extra || profile.extras?.includes(extra) === true,
  );

/** Plain `code` without lists is the default, so it normalizes to no profile. */
export function parseCrewTools(value: unknown): CrewToolProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid member tools");
  const t = value as Record<string, unknown>;
  if (
    Object.keys(t).some(
      (key) => !["preset", "extras", "conversationTools", "mcpServers", "skills"].includes(key),
    )
  )
    throw new Error("Invalid member tools");
  const preset = CREW_TOOL_PRESETS.find((candidate) => candidate === t.preset);
  if (!preset) throw new Error("Invalid member tool preset");
  const name = (entry: string) => entry.length > 0 && entry.length <= CREW_TOOL_LIMITS.nameChars;
  const conversationTools = list(t.conversationTools, CREW_TOOL_LIMITS.actions, (entry) =>
    ACTION_PATTERN.test(entry),
  );
  const mcpServers = list(t.mcpServers, CREW_TOOL_LIMITS.names, name);
  const skills = list(t.skills, CREW_TOOL_LIMITS.names, name);
  const writes = preset === "code" || preset === "custom";
  const extras = writes
    ? undefined
    : [...new Set(extrasOf(t.extras))].filter((extra) => extra !== preset);
  if (preset === "code" && !conversationTools && !mcpServers && !skills) return undefined;
  return {
    preset,
    ...(extras?.length ? { extras } : {}),
    ...(conversationTools ? { conversationTools } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(skills ? { skills } : {}),
  };
}

/** Preset shown for a member; no profile is the unrestricted `code` default. */
export const crewToolPreset = (tools: CrewToolProfile | undefined): CrewToolPreset =>
  tools?.preset ?? "code";

/** Host tool groups every ready-made profile keeps: project files, Git, terminals, logs and context. */
const PROFILE_BASE = [
  "files",
  "git",
  "terminals",
  "logs",
  "skills",
  "attachments",
  "notes",
  "resources",
  "checkpoints",
  "environment",
  "models",
  "providers",
] as const;

/**
 * Ready-made member profiles. Each one can write code; it only chooses which Host tool groups
 * the member sees. `full` (no profile) is everything the run allows; `custom` is anything else.
 */
export const CREW_TOOL_PROFILES = {
  developer: [...PROFILE_BASE, "devServers", "browser", "tasks", "workspaces", "pullRequests"],
  designer: [...PROFILE_BASE, "images", "visuals", "browser", "devServers"],
  tester: [...PROFILE_BASE, "devServers", "browser", "devices", "desktop"],
} as const satisfies Record<string, readonly string[]>;
export type CrewToolProfileChoice = "full" | keyof typeof CREW_TOOL_PROFILES | "custom";
export const CREW_TOOL_PROFILE_CHOICES: readonly CrewToolProfileChoice[] = [
  "full",
  "developer",
  "designer",
  "tester",
  "custom",
];

/** The ready-made profile a saved value is, or `custom`. */
export function crewToolProfileChoice(tools: CrewToolProfile | undefined): CrewToolProfileChoice {
  if (!tools) return "full";
  if (tools.preset !== "custom" || tools.mcpServers || tools.skills || !tools.conversationTools)
    return "custom";
  const listed = new Set(tools.conversationTools);
  const match = (Object.keys(CREW_TOOL_PROFILES) as (keyof typeof CREW_TOOL_PROFILES)[]).find(
    (name) =>
      CREW_TOOL_PROFILES[name].length === listed.size &&
      CREW_TOOL_PROFILES[name].every((group) => listed.has(group)),
  );
  return match ?? "custom";
}

/** The saved value for a choice; `custom` starts from what the member has now. */
export function crewToolProfileFor(
  choice: CrewToolProfileChoice,
  current: CrewToolProfile | undefined,
): CrewToolProfile | undefined {
  if (choice === "full") return undefined;
  if (choice === "custom")
    return current?.preset === "custom" ? current : { ...current, preset: "custom" };
  return { preset: "custom", conversationTools: [...CREW_TOOL_PROFILES[choice]] };
}
