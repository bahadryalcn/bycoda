import { calleeName, defineRule } from "../define-rule.mjs";

const EFFECT = /^(React\.)?use(Layout|Insertion)?Effect$/;

export default defineRule({
  files: ["src/**"],
  message:
    "Stop and reconsider before adding this effect. Computable from props or state? Compute it in render. A response to a user action? Do it in that handler. Resetting state when a prop changes? Key the component on that prop. Telling a parent or store that a value changed? Do it where the change happens. Reading a value from outside React? Use `useSyncExternalStore` or a store hook. Loading data? Use the query or store that owns it. An effect is right only when it keeps something outside React in step with this component while mounted: a DOM node, listener, timer, observer, native event, connection or a resource held until unmount. Moving the same logic into a ref or store to dodge this rule is not a fix. If the effect does that, name what it keeps in step on the line above: `// oxlint-disable-next-line bycoda/effect-names-its-sync -- <what it syncs with and why>`.",
  create: (_context, report) => ({
    CallExpression(node) {
      if (EFFECT.test(calleeName(node.callee) ?? "")) report(node);
    },
  }),
});
