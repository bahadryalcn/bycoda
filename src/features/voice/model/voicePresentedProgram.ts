import { presentedSpecs } from "./voicePresentedCatalog";
import type { VoicePresentedResult } from "./voicePresentedResult";
import type { PresentedNode, PresentedSpec } from "./voicePresentedSpec";

const specByName = new Map(presentedSpecs.map((spec) => [spec.name, spec]));

/** The custom OpenUI action a Button runs; its node number tells the view which button was pressed. */
export const PRESENTED_ACTION = "present";

const variable = (id: string) => "$" + id;

/** `{"$bind":"id"}` becomes the OpenUI variable `$id`; everything else is a JSON literal. */
function literal(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const [key, item] = entries[0] ?? [];
    if (entries.length === 1 && key === "$bind" && typeof item === "string") return variable(item);
    return `{${entries.map(([name, entry]) => `${JSON.stringify(name)}: ${literal(entry)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export type PresentedProgram = {
  program: string;
  /** Each field id with the component that owns it, in document order. */
  fields: { id: string; type: string }[];
};

/**
 * Turns a validated view into OpenUI Lang. Only literals, field variables and node references
 * enter the program, and every string is a JSON literal, so model text never becomes code.
 */
export function compilePresentedProgram(result: VoicePresentedResult): PresentedProgram {
  const statements: string[] = [];
  const declarations: string[] = [];
  const fields: PresentedProgram["fields"] = [];
  let next = 0;
  const emit = (node: PresentedNode): string => {
    const spec = specByName.get(node.type) as PresentedSpec;
    const index = next++;
    const name = `n${index}`;
    const refs = (node.children ?? []).map(emit);
    const args = Object.keys(spec.props.shape).map((key) => {
      const value = node[key];
      if (key === spec.bound && typeof node.id === "string") {
        fields.push({ id: node.id, type: node.type });
        // A choice with no starting value starts on its first option, as its control shows it.
        const first = Array.isArray(node.options)
          ? (node.options[0] as { value?: unknown })
          : undefined;
        const start = value ?? first?.value;
        if (start !== undefined) declarations.push(`${variable(node.id)} = ${literal(start)}`);
        return variable(node.id);
      }
      if (node.type === "Button" && key === "action")
        return `@${PRESENTED_ACTION}(${index}, ${literal({ label: node.label, ...(value as object) })})`;
      if (key === "requires" && Array.isArray(value))
        return `[${value.map((id: string) => variable(id)).join(", ")}]`;
      return literal(value);
    });
    if (spec.children) args.push(`[${refs.join(", ")}]`);
    while (args.length && args[args.length - 1] === "null") args.pop();
    statements.push(`${name} = ${spec.name}(${args.join(", ")})`);
    return name;
  };
  const top = (result.blocks ?? []).map(emit);
  const root = `root = PresentedAnswer(${literal(result.title)}, ${literal(result.summary)}, [${top.join(", ")}])`;
  return { program: [root, ...statements, ...declarations].join("\n"), fields };
}
