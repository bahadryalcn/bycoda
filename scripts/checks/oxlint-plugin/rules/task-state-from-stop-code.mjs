import { defineRule } from "../define-rule.mjs";

const EQUALITY = new Set(["===", "!==", "==", "!="]);
const TEXT_METHODS = new Set([
  "startsWith",
  "endsWith",
  "includes",
  "match",
  "trim",
  "toLowerCase",
]);

/** `<anything>.error`, written without computed access. */
const isErrorMember = (node) =>
  node?.type === "MemberExpression" && !node.computed && node.property.name === "error";

/** `undefined`, `null` and an empty value are presence checks, not classification. */
const isAbsent = (node) =>
  (node.type === "Identifier" && node.name === "undefined") ||
  (node.type === "Literal" && node.value === null);

export default defineRule({
  files: ["host/tasks/**", "src/features/tasks/**", "src/shared/model/**"],
  message:
    "A task's `error` is free text for the owner to read, never for the code to branch on. Read `task.stop?.code` / `task.wait?.code` (src/shared/model/host-contracts/task-stop.ts) and show `taskStopSummary(task)`; a run's cause is `outcome.cause`.",
  create: (_context, report) => ({
    BinaryExpression(node) {
      if (!EQUALITY.has(node.operator)) return;
      const left = isErrorMember(node.left);
      const right = isErrorMember(node.right);
      // Two errors compared with each other detect a change, not a kind of failure.
      if (left === right) return;
      const other = left ? node.right : node.left;
      if (!isAbsent(other)) report(node);
    },
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.computed) return;
      const method = callee.property.name;
      // task.error.startsWith(...), task.error?.includes(...), task.error.trim().toLowerCase()
      if (TEXT_METHODS.has(method)) {
        let target = callee.object;
        while (target.type === "CallExpression" && target.callee.type === "MemberExpression")
          target = target.callee.object;
        if (isErrorMember(target)) report(node);
        return;
      }
      // /pattern/.test(task.error)
      if (method === "test" && node.arguments.some(isErrorMember)) report(node);
    },
  }),
});
