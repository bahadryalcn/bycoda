import { defineRule, isMethodCall } from "../define-rule.mjs";

const isHandler = (node) =>
  isMethodCall(node, "catch") || (isMethodCall(node, "then") && node.arguments.length === 2);

/** Any `try` with a `catch` inside the function, at any depth. */
function hasTryCatch(node) {
  if (!node || typeof node.type !== "string") return false;
  if (node.type === "TryStatement" && node.handler) return true;
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value) ? value.some(hasTryCatch) : hasTryCatch(value)) return true;
  }
  return false;
}

function handlesRejection(call) {
  if (isHandler(call)) return true;
  // `.catch(...).finally(...)`: the rejection is handled before the finally.
  if (isMethodCall(call, "finally")) return isHandler(call.callee.object);
  const callee = call.callee;
  return (
    callee.type === "ArrowFunctionExpression" &&
    callee.async &&
    call.arguments.length === 0 &&
    hasTryCatch(callee.body)
  );
}

export default defineRule({
  files: ["host/**", "packages/**"],
  message:
    "A `void`-discarded promise with no rejection handler becomes an unhandled rejection; the Host logs it through guardUnhandledRejections (host/server/support.ts) and marks the service degraded, and the failed work is silently lost. Append `.catch(...)` that logs or reports (a `.finally()` alone does not handle the rejection), pass a rejection handler as the second `then` argument, or await it inside a try/catch (an async IIFE whose body has a try/catch is fine).",
  create: (_context, report) => ({
    UnaryExpression(node) {
      if (node.operator !== "void") return;
      const call =
        node.argument.type === "ChainExpression" ? node.argument.expression : node.argument;
      if (call.type === "CallExpression" && !handlesRejection(call)) report(node);
    },
  }),
});
