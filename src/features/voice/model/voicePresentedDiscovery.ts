import { z } from "zod";
import { presentedSpecs } from "./voicePresentedCatalog";
import { PRESENTED_MAX_DEPTH, PRESENTED_MAX_NODES } from "./voicePresentedResult";
import type { PresentedGroup, PresentedSpec } from "./voicePresentedSpec";

const groupNames = [...new Set(presentedSpecs.map((spec) => spec.group))] as [
  PresentedGroup,
  ...PresentedGroup[],
];

export const presentedCatalogTool = {
  name: "workspace.live_work.catalog",
  description:
    "Look up the components workspace.live_work.present can draw. With no input it returns each group's component names and the composition rules. With names (up to 12) or a group it returns each component's exact props as JSON Schema, how it nests, and one valid example node.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      names: { type: "array", maxItems: 12, items: { type: "string" } },
      group: { type: "string", enum: groupNames },
    },
  },
};

const input = z.strictObject({
  names: z.array(z.string()).max(12).optional(),
  group: z.enum(groupNames).optional(),
});

const rules = {
  nodes: `Every block is {"type":"<Component>", ...props}; containers also take "children" (an array of nodes). At most ${PRESENTED_MAX_NODES} nodes, ${PRESENTED_MAX_DEPTH} levels.`,
  fields:
    'A fields or choice component needs a unique camelCase "id"; its "value" is the starting value. The owner edits it in the view, and edits survive an update that keeps the id.',
  buttons:
    'Button.action is {"action":"<registered action>","input":{...}} plus optional family and projectPath, sessionId or accountId. Any value inside input or those three fields may be {"$bind":"fieldId"}: at press it becomes that field\'s current value (string, number, boolean, string array, or for a period picker an object {start, end} of local dates or date-times). Empty numbers are left out; empty text is sent as "". Button.requires lists field ids that must have a value before it can be pressed. Authority stays with the app: each press is checked against the live action catalog.',
  observed:
    "Observed components (TestResult, CheckResult, ChangeResult, FailedCommands, VoiceActions) carry no data: they draw what this turn measured, or say nothing was observed.",
  text: "All text is shown as plain text.",
};

function detail(spec: PresentedSpec) {
  return {
    name: spec.name,
    group: spec.group,
    description: spec.description,
    drawnBy: spec.source,
    props: z.toJSONSchema(spec.props, { io: "input", unrepresentable: "any" }),
    ...(spec.children
      ? { children: spec.children === "tabs" ? "Tab nodes only" : "any component nodes" }
      : {}),
    ...(spec.parent ? { onlyInside: spec.parent } : {}),
    ...(spec.within ? { needsAncestor: spec.within } : {}),
    ...(spec.bound ? { fieldValue: spec.bound } : {}),
    example: spec.example,
  };
}

/** The exact, current catalog the model composes from: one source with the validator and renderer. */
export function describePresentedCatalog(raw: unknown) {
  const parsed = input.safeParse(raw ?? {});
  if (!parsed.success) throw new Error("Send names (up to 12) and/or a group.");
  const { names, group } = parsed.data;
  if (!names && !group)
    return {
      groups: Object.fromEntries(
        groupNames.map((name) => [
          name,
          presentedSpecs
            .filter((spec) => spec.group === name)
            .map((spec) => ({ name: spec.name, description: spec.description })),
        ]),
      ),
      rules,
    };
  const unknown = (names ?? []).filter(
    (name) => !presentedSpecs.some((spec) => spec.name === name),
  );
  if (unknown.length) throw new Error(`Unknown components: ${unknown.join(", ")}.`);
  const chosen = presentedSpecs.filter(
    (spec) => (!names || names.includes(spec.name)) && (!group || spec.group === group),
  );
  if (chosen.length > 12) throw new Error("Ask for at most 12 components at a time.");
  return { components: chosen.map(detail), rules };
}
