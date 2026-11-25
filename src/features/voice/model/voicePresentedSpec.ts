import { z } from "zod";

/** Where a component sits in the shared component catalog (`docs/reference/ui-components.md`). */
export type PresentedGroup =
  | "layout"
  | "text"
  | "data"
  | "feedback"
  | "fields"
  | "choice"
  | "actions"
  | "observed";

/**
 * One model-usable component. `props` are the exact named props a node may carry; their key order is
 * the OpenUI positional order. Specs are pure data: the renderer for a name lives in the UI layer and
 * a parity test keeps both sides equal.
 */
export type PresentedSpec = {
  name: string;
  group: PresentedGroup;
  /** What the owner sees and when to choose it. */
  description: string;
  /** The shared component (or composition) that draws it. */
  source: string;
  props: z.ZodObject;
  /** Prop that holds a field's value; the node's `id` names it, and `$bind` can read it. */
  bound?: string;
  /** Nodes it may contain: any component, or only Tab nodes. */
  children?: "nodes" | "tabs";
  /** A tab panel: allowed only directly inside Tabs. */
  parent?: string;
  /** Needs this component as an ancestor at any depth, because it reads state the ancestor owns. */
  within?: string;
  /** A complete valid node, shown by discovery and proven by a test. */
  example: PresentedNode;
};

export type PresentedNode = { type: string; children?: PresentedNode[]; [prop: string]: unknown };

export const defineSpec = (spec: PresentedSpec) => spec;

export const fieldId = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,23}$/, "A field id is camelCase letters and digits, at most 24.");

const credentialLike =
  /\b(?:authorization\s*[:=]|bearer\s+\S|(?:[\w-]*api[_-]?key|access[_-]?token|secret|password)\s*[:=]|(?:sk|ghp|xox[baprs]|umami)[-_][\w-]{10,})|[\w+/=_-]{40,}/i;
export const credentialText = (value: string) => credentialLike.test(value);

/** Short display text. Credential-like content is refused when the whole view is checked. */
export const shortText = (max: number) => z.string().trim().min(1).max(max);
export const gap = z.enum(["sm", "md", "lg"]).optional();
export const tone = z.enum(["neutral", "accent", "info", "success", "warning", "danger"]);
export const finite = z.number().min(-1e12).max(1e12);
export const labelValue = z.strictObject({ label: shortText(52), value: shortText(100) });
export const optionList = z
  .array(
    z.strictObject({
      value: shortText(80),
      label: shortText(80),
      description: shortText(160).optional(),
    }),
  )
  .min(1)
  .max(40);
