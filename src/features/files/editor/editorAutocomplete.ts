import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

export const editorAutocomplete: Extension = autocompletion({
  activateOnTyping: true,
  selectOnOpen: true,
  defaultKeymap: true,
});

/** Local declarations remain useful while offline and in unsaved stylesheets. */
export function cssVariableCompletions(context: CompletionContext) {
  if (context.state.doc.length > 512 * 1024) return null;
  const prefix = context.matchBefore(/--[\w-]*/);
  if (!prefix) return null;
  const before = context.state.sliceDoc(Math.max(0, prefix.from - 20), prefix.from);
  if (!/var\(\s*$/.test(before)) return null;
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  for (let current = node; current; current = current.parent!) {
    if (/comment|string/i.test(current.name)) return null;
  }
  const declarations = new Map<string, string>();
  syntaxTree(context.state).iterate({
    enter(node) {
      if (node.name !== "Declaration") return;
      const variable = node.node.getChild("VariableName");
      const colon = node.node.getChild(":");
      if (!variable || !colon) return false;
      const label = context.state.sliceDoc(variable.from, variable.to);
      if (label.startsWith("--")) {
        declarations.set(
          label,
          context.state.sliceDoc(colon.to, Math.min(node.to, colon.to + 160)).trim(),
        );
      }
      return false;
    },
  });
  return {
    from: prefix.from,
    // Keep the value in the info pane so CodeMirror can deduplicate this richer
    // result with the CSS language's built-in same-label variable suggestion.
    options: [...declarations].map(([label, info]) => ({ label, info, type: "variable" })),
    validFor: /^--[\w-]*$/,
  };
}
