import { z } from "zod";
import { presentedSpecs } from "./voicePresentedCatalog";
import { normalizeLegacyPresentedInput } from "./voicePresentedLegacy";
import { credentialText, type PresentedNode, type PresentedSpec } from "./voicePresentedSpec";

export type { VoicePresentedActionButton } from "./voicePresentedActions";

export const PRESENTED_MAX_DEPTH = 6;
export const PRESENTED_MAX_NODES = 120;

const variant = (spec: PresentedSpec) =>
  spec.props.extend({
    type: z.literal(spec.name),
    ...(spec.children
      ? {
          children: z
            .array(z.lazy(() => nodeSchema))
            .max(24)
            .optional(),
        }
      : {}),
  });

/** Every node is one catalog component: `type` names it, the rest are its exact props. */
const nodeSchema = z.lazy(() =>
  z.discriminatedUnion(
    "type",
    presentedSpecs.map(variant) as unknown as [
      ReturnType<typeof variant>,
      ...ReturnType<typeof variant>[],
    ],
    { error: () => "Unknown component type. Call workspace.live_work.catalog for the list." },
  ),
) as unknown as z.ZodType<PresentedNode>;

const displayText = (max: number) => z.string().trim().min(1).max(max);

const bindRefs = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) for (const item of value) bindRefs(item, found);
  else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]![0] === "$bind" && typeof entries[0]![1] === "string")
      found.push(entries[0]![1]);
    else for (const [, item] of entries) bindRefs(item, found);
  }
  return found;
};
const stray$bind = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(stray$bind)
    : Boolean(value) &&
      typeof value === "object" &&
      Object.entries(value as object).some(
        ([key, item]) =>
          (key === "$bind" && Object.keys(value as object).length !== 1) || stray$bind(item),
      );
const credentialIn = (value: unknown): boolean =>
  typeof value === "string"
    ? credentialText(value)
    : Array.isArray(value)
      ? value.some(credentialIn)
      : Boolean(value) &&
        typeof value === "object" &&
        Object.values(value as object).some(credentialIn);

const specByName = new Map(presentedSpecs.map((spec) => [spec.name, spec]));

/** Whole-view rules a single node cannot see: size, field ids, bindings, tab placement, secrets. */
function checkTree(blocks: readonly PresentedNode[], ctx: z.RefinementCtx) {
  const fields = new Map<string, string>();
  const binds: { id: string; path: (string | number)[] }[] = [];
  let count = 0;
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  const visit = (
    node: PresentedNode,
    path: (string | number)[],
    depth: number,
    ancestors: readonly string[],
  ) => {
    const spec = specByName.get(node.type);
    if (!spec) return;
    count += 1;
    if (depth > PRESENTED_MAX_DEPTH)
      issue(`Nesting is limited to ${PRESENTED_MAX_DEPTH} levels.`, path);
    if (spec.parent && spec.parent !== ancestors[ancestors.length - 1])
      issue(`${spec.name} is only valid directly inside ${spec.parent}.`, path);
    if (spec.within && !ancestors.includes(spec.within))
      issue(`${spec.name} is only valid inside ${spec.within}.`, path);
    if (spec.children === "tabs" && node.children?.some((child) => child.type !== "Tab"))
      issue("Tabs may contain only Tab nodes.", [...path, "children"]);
    const { type: _type, children, action, ...props } = node;
    if (credentialIn(props)) issue("This looks like a credential. Remove it.", path);
    if (typeof node.id === "string" && spec.bound) {
      if (fields.has(node.id)) issue(`Field id "${node.id}" is used twice.`, [...path, "id"]);
      fields.set(node.id, spec.name);
    }
    if (action !== undefined) {
      if (stray$bind(action)) issue("$bind must be an object with only the $bind key.", path);
      for (const id of bindRefs(action)) binds.push({ id, path: [...path, "action"] });
    }
    if (Array.isArray(node.requires))
      for (const id of node.requires)
        if (typeof id === "string") binds.push({ id, path: [...path, "requires"] });
    children?.forEach((child, index) =>
      visit(child, [...path, "children", index], depth + 1, [...ancestors, node.type]),
    );
  };
  blocks.forEach((node, index) => visit(node, ["blocks", index], 1, []));
  if (count > PRESENTED_MAX_NODES)
    issue(`A view holds at most ${PRESENTED_MAX_NODES} components.`, ["blocks"]);
  for (const { id, path } of binds)
    if (!fields.has(id)) issue(`No field has the id "${id}".`, path);
}

const presentedResult = z
  .strictObject({
    title: displayText(90).refine((value) => !credentialText(value)),
    summary: displayText(360)
      .refine((value) => !credentialText(value))
      .optional(),
    blocks: z.array(nodeSchema).min(1).max(40).optional(),
  })
  .refine((result) => result.summary !== undefined || result.blocks !== undefined, {
    message: "Send a summary or at least one block.",
  })
  .superRefine((result, ctx) => checkTree(result.blocks ?? [], ctx));

/** Accepts the earlier block kinds (text, notes, comparison, chart, copy, actions) as well. */
export const VoicePresentedResultSchema = z.preprocess(
  normalizeLegacyPresentedInput,
  presentedResult,
);

export type VoicePresentedResult = z.infer<typeof presentedResult>;
export type VoicePresentedBlock = PresentedNode;

/** The model-readable reason a view was refused, with the first few exact paths. */
export function presentedResultProblems(error: z.ZodError) {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join(".") || "view"}: ${issue.message}`)
    .join("; ");
}

const groups = ["layout", "text", "data", "feedback", "fields", "choice", "actions", "observed"];
const names = (group: string) =>
  presentedSpecs
    .filter((spec) => spec.group === group)
    .map((spec) => spec.name)
    .join(", ");

export const presentVoiceResultTool = {
  name: "workspace.live_work.present",
  description: `Show a visual answer in the right panel of the fullscreen voice call when the owner asks to see, show, list, compare, chart, copy or fill in something. This opens the fullscreen call and its drawer. Calling it again replaces the same view: use it for follow-ups, always sending the full new view; field values the owner already typed are kept for fields that keep their id. Compose any mix of components, nested freely: each block is {"type":"<Component>", ...props, "children":[...]} (containers only). Components - ${groups.map((group) => `${group}: ${names(group)}`).join("; ")}. Before using one you have not used, call workspace.live_work.catalog with its names for the exact props, examples and limits. Fields (fields and choice groups) each need a camelCase id; a Button's action is {"action":"<registered app action>","input":{...}} and any input value may be {"$bind":"<fieldId>"} to read that field when pressed, so the owner can edit a value and then press the button. Use facts from this turn only. Never include credentials, private identifiers or invented values.`,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 90 },
      summary: { type: "string", minLength: 1, maxLength: 360 },
      blocks: {
        type: "array",
        minItems: 1,
        maxItems: 40,
        items: {
          type: "object",
          required: ["type"],
          additionalProperties: true,
          properties: {
            type: { type: "string", enum: presentedSpecs.map((spec) => spec.name) },
            children: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },
};
