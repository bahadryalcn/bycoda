import { isRemoteProvider, type RemoteProvider } from "../../connections/model/protocol";
import type { RuntimeMode } from "../../sessions/model/session";

export const HOST_CREWS = "crews.v1";
export const HOST_CREW_TASKS = "crews.tasks.v1";
export const HOST_CREW_DELETE = "crews.delete.v1";
/** Library members carry specialty groups and crews remember which profile a member came from. */
export const HOST_CREW_AGENT_GROUPS = "crews.agent-groups.v1";
export const CREW_CAPABILITIES = [
  "code",
  "review",
  "image-generation",
  "vision",
  "browser",
  "terminal",
  "subagents",
] as const;
export type CrewCapability = (typeof CREW_CAPABILITIES)[number];
export type CrewRole = "coordinator" | "specialist" | "reviewer" | "advisor";
export type CrewCandidate = {
  id: string;
  harness: RemoteProvider;
  model: string;
  modelSettings: Record<string, string>;
  capabilities: Partial<
    Record<
      CrewCapability,
      { state: "available" | "unavailable" | "unknown"; observedAt: number; source: string }
    >
  >;
  /** Comparable owner estimates, not provider billing or invented benchmarks. */
  cost?: number;
  quality?: number;
  qualitySource?: "owner-estimate" | "review-history";
  samples?: number;
};
export type CrewAgent = {
  id: string;
  name: string;
  role: CrewRole;
  instructions: string;
  selection: "fixed" | "automatic";
  candidates: CrewCandidate[];
  /** Specialty groups such as UI or Mobile; independent from the working role. */
  groups?: string[];
  /** The library profile this member was copied from. Library edits never apply silently. */
  source?: { id: string; updatedAt: number };
};
export type CrewPolicy = {
  preset: "economy" | "balanced" | "quality";
  maxParallel: number;
  maxAssignments: number;
  maxRunMinutes: number;
  maxEstimatedCost?: number;
  minimumQuality?: number;
  costWeight?: number;
  qualityWeight?: number;
  allowUnknownCost: boolean;
  allowSubagents: boolean;
  delegateApprovals?: boolean;
};
export type SavedCrewAgent = CrewAgent & { projectId?: string; updatedAt: number };
export type CrewDefinition = {
  id: string;
  name: string;
  projectId?: string;
  agents: CrewAgent[];
  policy: CrewPolicy;
  updatedAt: number;
};
export type CrewMessage = {
  id: string;
  from: string;
  text: string;
  taskId?: string;
  createdAt: number;
  resolvedAt?: number;
};
export type CrewAssignment = {
  id: string;
  memberId: string;
  taskId: string;
  title: string;
  files?: string[];
  integration?: boolean;
  candidate: CrewCandidate;
  reason: string;
  estimatedCost?: number;
  requestFingerprint?: string;
};
export type CrewRun = {
  /** Short work title from the delivery's first line; older runs derive it from their launch. */
  title?: string;
  sourceTaskId?: string;
  requestedBySessionId?: string;
  id: string;
  projectId: string;
  definition: CrewDefinition;
  status: "active" | "paused" | "finished";
  coordinatorSessionId?: string;
  coordinatorCandidate?: CrewCandidate;
  launch?: { candidate: CrewCandidate; runtimeMode: RuntimeMode; prompt: string };
  requestFingerprint?: string;
  assignments: CrewAssignment[];
  messages: CrewMessage[];
  notifications: Record<string, string>;
  pendingDelivery?: { commandId: string; text: string; notifications: Record<string, string> };
  createdAt: number;
  updatedAt: number;
  error?: string;
};
/** A delivery's first non-empty line, shortened; never the whole prompt. */
export function crewWorkTitle(prompt: string | undefined): string | undefined {
  const line = prompt
    ?.split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
}
export const defaultCrewPolicy: CrewPolicy = {
  preset: "balanced",
  maxParallel: 2,
  maxAssignments: 20,
  maxRunMinutes: 30,
  allowUnknownCost: true,
  allowSubagents: false,
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid crew object");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid crew text");
  return value.trim();
};
const number = (value: unknown, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid crew number");
  return value;
};
export function parseCrewAgent(value: unknown): CrewAgent {
  const a = record(value);
  if (!["coordinator", "specialist", "reviewer", "advisor"].includes(String(a.role)))
    throw new Error("Invalid crew role");
  if (a.selection !== "fixed" && a.selection !== "automatic")
    throw new Error("Invalid member selection");
  if (!Array.isArray(a.candidates) || !a.candidates.length || a.candidates.length > 20)
    throw new Error("Choose at least one model per member");
  const candidates = a.candidates.map((value): CrewCandidate => {
    const c = record(value);
    if (!isRemoteProvider(c.harness)) throw new Error("Invalid crew provider");
    const settings = record(c.modelSettings ?? {});
    if (
      Object.keys(settings).length > 32 ||
      Object.values(settings).some((v) => typeof v !== "string" || v.length > 256)
    )
      throw new Error("Invalid model settings");
    const capabilities: CrewCandidate["capabilities"] = {};
    for (const [key, value] of Object.entries(record(c.capabilities ?? {}))) {
      if (!CREW_CAPABILITIES.includes(key as CrewCapability)) throw new Error("Unknown capability");
      const evidence = record(value);
      if (!["available", "unavailable", "unknown"].includes(String(evidence.state)))
        throw new Error("Invalid capability evidence");
      capabilities[key as CrewCapability] = {
        state: evidence.state as "available",
        observedAt: number(evidence.observedAt, 0, Number.MAX_SAFE_INTEGER),
        source: text(evidence.source, 500),
      };
    }
    return {
      id: text(c.id),
      harness: c.harness,
      model: text(c.model),
      modelSettings: settings as Record<string, string>,
      capabilities,
      ...(c.cost === undefined ? {} : { cost: number(c.cost, 0, 1_000_000) }),
      ...(c.quality === undefined ? {} : { quality: number(c.quality, 0, 100) }),
    };
  });
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new Error("Duplicate candidate IDs");
  let groups: string[] | undefined;
  if (a.groups !== undefined) {
    if (!Array.isArray(a.groups) || a.groups.length > 12) throw new Error("Invalid member groups");
    groups = [...new Set(a.groups.map((group) => text(group, 40)))];
  }
  let source: CrewAgent["source"];
  if (a.source !== undefined) {
    const s = record(a.source);
    source = { id: text(s.id), updatedAt: number(s.updatedAt, 0, Number.MAX_SAFE_INTEGER) };
  }
  return {
    id: text(a.id),
    name: text(a.name),
    role: a.role as CrewRole,
    instructions: typeof a.instructions === "string" ? a.instructions.slice(0, 12000) : "",
    selection: a.selection,
    candidates,
    ...(groups?.length ? { groups } : {}),
    ...(source ? { source } : {}),
  };
}

export function parseCrewDefinition(value: unknown): CrewDefinition {
  const input = record(value);
  const p = record(input.policy);
  if (!["economy", "balanced", "quality"].includes(String(p.preset)))
    throw new Error("Invalid allocation policy");
  if (!Array.isArray(input.agents) || input.agents.length < 3 || input.agents.length > 20)
    throw new Error("Choose 3 to 20 crew members, including a coordinator and reviewer");
  const agents = input.agents.map(parseCrewAgent);
  if (new Set(agents.map((a) => a.id)).size !== agents.length)
    throw new Error("Duplicate crew members");
  if (
    agents.filter((a) => a.role === "coordinator").length !== 1 ||
    agents.filter((a) => a.role === "reviewer").length !== 1 ||
    !agents.some((a) => a.role === "specialist")
  )
    throw new Error("A crew needs one coordinator, one reviewer and a specialist");
  const maxParallel = number(p.maxParallel, 1, 4);
  const maxAssignments = number(p.maxAssignments, 1, 20);
  if (!Number.isInteger(maxParallel) || !Number.isInteger(maxAssignments))
    throw new Error("Crew limits must be integers");
  return {
    id: text(input.id),
    name: text(input.name),
    ...(input.projectId === undefined ? {} : { projectId: text(input.projectId) }),
    agents,
    policy: {
      preset: p.preset as CrewPolicy["preset"],
      maxParallel,
      maxAssignments,
      maxRunMinutes: number(p.maxRunMinutes, 1, 240),
      ...(p.maxEstimatedCost === undefined
        ? {}
        : { maxEstimatedCost: number(p.maxEstimatedCost, 0, 1_000_000) }),
      ...(p.minimumQuality === undefined
        ? {}
        : { minimumQuality: number(p.minimumQuality, 0, 100) }),
      ...(p.costWeight === undefined ? {} : { costWeight: number(p.costWeight, 0, 1) }),
      ...(p.qualityWeight === undefined ? {} : { qualityWeight: number(p.qualityWeight, 0, 1) }),
      allowUnknownCost: p.allowUnknownCost === true,
      allowSubagents: p.allowSubagents === true,
      delegateApprovals: p.delegateApprovals === true,
    },
    updatedAt: typeof input.updatedAt === "number" ? input.updatedAt : 0,
  };
}

/** Required capability gates always precede preferences. Unknown is not support. */
export function selectCrewCandidate(
  agent: CrewAgent,
  policy: CrewPolicy,
  required: CrewCapability[],
  available: (candidate: CrewCandidate) => boolean,
  now = Date.now(),
): { candidate: CrewCandidate; reason: string } {
  const candidates = (
    agent.selection === "fixed" ? agent.candidates.slice(0, 1) : agent.candidates
  ).filter(
    (c) =>
      available(c) &&
      required.every((key) => {
        const e = c.capabilities[key];
        return (
          e?.state === "available" &&
          e.observedAt <= now &&
          now - e.observedAt < 24 * 60 * 60 * 1000
        );
      }) &&
      (policy.allowUnknownCost || c.cost !== undefined) &&
      (policy.maxEstimatedCost === undefined ||
        (c.cost !== undefined && c.cost <= policy.maxEstimatedCost)) &&
      (policy.minimumQuality === undefined ||
        (c.quality !== undefined && c.quality >= policy.minimumQuality)),
  );
  if (!candidates.length)
    throw new Error(
      `No eligible model for ${agent.name}. Check required capabilities, model availability, pins and policy limits.`,
    );
  const knownCosts = candidates.flatMap((c) => (c.cost === undefined ? [] : [c.cost]));
  const maxCost = Math.max(1, ...knownCosts);
  const costWeight =
    policy.costWeight ??
    (policy.preset === "economy" ? 0.85 : policy.preset === "quality" ? 0.1 : 0.5);
  const qualityWeight = policy.qualityWeight ?? 1 - costWeight;
  const score = (c: CrewCandidate) =>
    qualityWeight * ((c.quality ?? 0) / 100) -
    costWeight * (c.cost === undefined ? 1 : c.cost / maxCost);
  const candidate = [...candidates].sort(
    (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
  )[0]!;
  return {
    candidate,
    reason: `${agent.selection}; ${policy.preset}; required capabilities ${required.length ? required.join(", ") : "none"}; cost ${candidate.cost === undefined ? "unknown" : "owner estimate"}; quality ${candidate.quality === undefined ? "unmeasured" : (candidate.qualitySource ?? "owner estimate")}; samples ${candidate.samples ?? 0}`,
  };
}

/** Conservative lease comparison; root scope excludes all concurrent writers. */
export function crewScopesOverlap(a: readonly string[], b: readonly string[]): boolean {
  const normalized = (s: string) => s.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return a.some((left) =>
    b.some((right) => {
      const l = normalized(left),
        r = normalized(right);
      return l === "." || r === "." || l === r || l.startsWith(`${r}/`) || r.startsWith(`${l}/`);
    }),
  );
}
export function parseCrewScopes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 64 ||
    value.some(
      (p) =>
        typeof p !== "string" ||
        !p.trim() ||
        p.length > 500 ||
        p.includes("\0") ||
        p.includes(":") ||
        p.startsWith("/") ||
        p.startsWith("\\") ||
        p.replace(/\\/g, "/").split("/").includes(".."),
    )
  )
    throw new Error("Choose project-relative file scopes without traversal");
  return [
    ...new Set(
      value.map(
        (p: string) =>
          p
            .replace(/\\/g, "/")
            .split("/")
            .filter((part) => part && part !== ".")
            .join("/") || ".",
      ),
    ),
  ];
}
