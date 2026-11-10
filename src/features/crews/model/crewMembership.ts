import type { CrewDefinition } from "./crew";

/** Library profile id to the ids of the crews that follow it through a member's `source`. */
export function memberOf(
  definitions: readonly Pick<CrewDefinition, "id" | "agents">[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const definition of definitions)
    for (const member of definition.agents) {
      if (!member.source) continue;
      const crews = result.get(member.source.id) ?? [];
      if (!crews.includes(definition.id)) crews.push(definition.id);
      result.set(member.source.id, crews);
    }
  return result;
}
