import { useQuery } from "@tanstack/react-query";
import { listSkills } from "../../../platform/tauri/fs";
import { remoteRequest } from "../../connections/public/connections";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { MCP_PROVIDER_LABELS } from "../../settings/public/mcp";
import { loadMcpSettings } from "../../settings/public/mcpSettingsCache";
import { HOST_CREW_TOOLS } from "./crew";
import { CREW_TOOL_LIMITS, validCrewToolAction } from "./crewTools";

/** One Host tool a member profile can list, as the Host reports it (`crews.schema` with `hostTools`). */
export type CrewHostTool = { action: string; write: boolean; summary: string };
/** A name the owner can pick for a member profile, with what it is. */
export type CrewToolChoice = { value: string; description?: string; meta?: string; group?: string };

const MAX_HOST_TOOLS = 2000;

/** Reads the Host's tool list; an older Host sends none, and malformed rows are dropped. */
export function parseCrewHostTools(value: unknown): CrewHostTool[] {
  const rows = (value as { hostTools?: unknown } | null)?.hostTools;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const tools: CrewHostTool[] = [];
  for (const row of rows.slice(0, MAX_HOST_TOOLS)) {
    const tool = row as Partial<CrewHostTool> | null;
    if (typeof tool?.action !== "string" || !validCrewToolAction(tool.action)) continue;
    if (seen.has(tool.action)) continue;
    seen.add(tool.action);
    tools.push({
      action: tool.action,
      write: tool.write === true,
      summary: typeof tool.summary === "string" ? tool.summary.slice(0, 400) : "",
    });
  }
  return tools;
}

const groupOf = (action: string) => action.split(".")[0];

/**
 * Picker rows for Host tools: each group with several tools gets an "all of it" row (the group
 * id, which the Host matches as a prefix) ahead of its tools. `labels` supplies the localized text.
 */
export function crewHostToolChoices(
  tools: readonly CrewHostTool[],
  labels: { all: (count: number) => string; reads: string; writes: string },
): CrewToolChoice[] {
  const groups = new Map<string, CrewHostTool[]>();
  for (const tool of tools) {
    const group = groupOf(tool.action);
    groups.set(group, [...(groups.get(group) ?? []), tool]);
  }
  return [...groups].flatMap(([group, members]) => [
    ...(members.length > 1 && !members.some((tool) => tool.action === group)
      ? [{ value: group, description: labels.all(members.length), group }]
      : []),
    ...members.map((tool) => ({
      value: tool.action,
      description: tool.summary || undefined,
      meta: tool.write ? labels.writes : labels.reads,
      group,
    })),
  ]);
}

/** Keeps saved names that the list does not know (another machine, an older entry) choosable. */
export function withSelectedChoices(
  choices: readonly CrewToolChoice[],
  selected: readonly string[],
): CrewToolChoice[] {
  const known = new Set(choices.map((choice) => choice.value));
  return [...choices, ...selected.filter((value) => !known.has(value)).map((value) => ({ value }))];
}

/** Names with the same value merge; their `meta` texts are joined. */
export function mergeNamedChoices(rows: readonly CrewToolChoice[]): CrewToolChoice[] {
  const merged = new Map<string, CrewToolChoice>();
  for (const row of rows) {
    const value = row.value.trim().slice(0, CREW_TOOL_LIMITS.nameChars);
    if (!value) continue;
    const previous = merged.get(value);
    if (!previous) merged.set(value, { ...row, value });
    else if (row.meta && !previous.meta?.split(", ").includes(row.meta))
      merged.set(value, {
        ...previous,
        meta: previous.meta ? `${previous.meta}, ${row.meta}` : row.meta,
      });
  }
  return [...merged.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** One pickable list: rows once read, its load state, and whether this project can list it at all. */
export type CrewToolCatalog<T> = {
  data: T[] | undefined;
  loading: boolean;
  error: string | undefined;
  /** False when this project cannot list it (no Host project, or a project on another machine). */
  available: boolean;
  retry: () => void;
};

const catalog = <T>(
  query: { data?: T[]; isFetching: boolean; error: unknown; refetch: () => unknown },
  available: boolean,
): CrewToolCatalog<T> => ({
  data: query.data,
  loading: available && query.isFetching,
  error:
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? String(query.error)
        : undefined,
  available,
  retry: () => void query.refetch(),
});

/**
 * What the owner can pick for a member's tools: the Host's own tools, and the MCP servers and
 * skills installed on this computer. Lists are only picked from, never typed; a list this project
 * cannot read says so instead.
 */
export function useCrewToolCatalogs(input: {
  cwd: string;
  machineId: string | undefined;
  projectId: string | undefined;
  /** Lists load only while they are shown. */
  active: boolean;
}) {
  const { cwd, machineId, projectId, active } = input;
  const local = !!cwd && cwd !== "~" && !isRemoteProjectPath(cwd);
  const hosted = !!machineId && !!projectId;
  const options = { staleTime: 60_000, retry: false } as const;
  const hostTools = useQuery({
    ...options,
    queryKey: [HOST_CREW_TOOLS, "catalog", machineId, projectId],
    enabled: active && hosted,
    queryFn: async () =>
      parseCrewHostTools(
        await remoteRequest(machineId!, "crews.schema", { projectId, hostTools: true }),
      ),
  });
  const mcpServers = useQuery({
    ...options,
    queryKey: [HOST_CREW_TOOLS, "mcp", cwd],
    enabled: active && local,
    queryFn: async () => {
      const snapshot = await loadMcpSettings(cwd, false, { claudeHealth: false });
      if (snapshot.error) throw new Error(snapshot.error);
      return mergeNamedChoices(
        snapshot.servers.map((server) => ({
          value: server.name,
          meta: MCP_PROVIDER_LABELS[server.provider],
        })),
      );
    },
  });
  const skills = useQuery({
    ...options,
    queryKey: [HOST_CREW_TOOLS, "skills", cwd],
    enabled: active && local,
    queryFn: async () =>
      mergeNamedChoices(
        (await listSkills(cwd)).map((skill) => ({
          value: skill.name,
          description: skill.description || undefined,
        })),
      ),
  });
  return {
    hostTools: catalog(hostTools, hosted),
    mcpServers: catalog(mcpServers, local),
    skills: catalog(skills, local),
  };
}
