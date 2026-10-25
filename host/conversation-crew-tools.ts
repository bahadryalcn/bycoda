import type { HostCrews } from "./crews";

const text = { type: "string", minLength: 1, maxLength: 300 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const pageFields = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
  search: { type: "string", maxLength: 200 },
};
const scope = { enum: ["global", "project"] };

/** Discovery complements orchestration without exposing owner-only deletion. */
export const CONVERSATION_CREW_READ_TOOLS = {
  "crews.definitions.list": object({ ...pageFields, scope }),
  "crews.definition.get": object({ definitionId: text }, ["definitionId"]),
  "crews.agents.list": object({
    ...pageFields,
    scope,
    group: text,
    role: { enum: ["coordinator", "specialist", "reviewer", "advisor"] },
  }),
  "crews.agent.get": object({ agentId: text }, ["agentId"]),
  "crews.runs.list": object({
    ...pageFields,
    definitionId: text,
    status: { enum: ["active", "paused", "finished"] },
  }),
};

type View = Awaited<ReturnType<HostCrews["list"]>>;
const matches = (search: unknown, ...values: (string | undefined)[]) =>
  typeof search !== "string" ||
  values.some((value) => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
const inScope = (scope: unknown, projectId?: string) =>
  scope === undefined || (scope === "global" ? !projectId : !!projectId);

function page<T>(items: T[], input: Record<string, unknown>) {
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error("Provide bounded crew pagination");
  const next = offset + limit;
  return {
    items: items.slice(offset, next),
    total: items.length,
    offset,
    ...(next < items.length ? { nextOffset: next } : {}),
  };
}

/** Input view must come from HostCrews' project-scoped, principal-redacted view. */
export function callConversationCrewRead(
  action: string,
  input: Record<string, unknown>,
  view: View,
): unknown {
  if (action === "crews.definition.get") {
    const definition = view.definitions.find((item) => item.id === input.definitionId);
    if (!definition) throw new Error("Crew definition is not available to this project");
    return definition;
  }
  if (action === "crews.agent.get") {
    const agent = view.agents.find((item) => item.id === input.agentId);
    if (!agent) throw new Error("Crew library agent is not available to this project");
    return agent;
  }
  if (action === "crews.definitions.list")
    return page(
      view.definitions
        .filter(
          (item) =>
            inScope(input.scope, item.projectId) && matches(input.search, item.id, item.name),
        )
        .map(({ id, name, projectId, updatedAt, agents }) => ({
          id,
          name,
          projectId,
          updatedAt,
          memberCount: agents.length,
        })),
      input,
    );
  if (action === "crews.agents.list")
    return page(
      view.agents
        .filter(
          (item) =>
            inScope(input.scope, item.projectId) &&
            (input.role === undefined || item.role === input.role) &&
            (input.group === undefined || item.groups?.includes(String(input.group))) &&
            matches(input.search, item.id, item.name, ...(item.groups ?? [])),
        )
        .map(({ id, name, role, groups, projectId, updatedAt, candidates }) => ({
          id,
          name,
          role,
          groups,
          projectId,
          updatedAt,
          candidateCount: candidates.length,
        })),
      input,
    );
  if (action === "crews.runs.list")
    return page(
      view.runs
        .filter(
          (item) =>
            (input.definitionId === undefined || item.definition.id === input.definitionId) &&
            (input.status === undefined || item.status === input.status) &&
            matches(input.search, item.id, item.title, item.definition.name),
        )
        .map(
          ({
            id,
            title,
            definition,
            status,
            createdAt,
            updatedAt,
            coordinatorSessionId,
            coordinatorStatus,
            tasks,
          }) => ({
            id,
            title,
            definitionId: definition.id,
            definitionName: definition.name,
            status,
            createdAt,
            updatedAt,
            coordinatorSessionId,
            coordinatorStatus,
            taskCount: tasks.length,
          }),
        ),
      input,
    );
  throw new Error("Unknown crew discovery action");
}
