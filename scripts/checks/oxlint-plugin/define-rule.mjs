import path from "node:path";

/** Test files and fixtures; no rule of this plugin applies to them. */
export const TESTS = ["**/*.test.ts", "**/*.test.tsx", "**/test-support/**"];

const matches = (file, patterns) =>
  patterns.some((pattern) => path.posix.matchesGlob(file, pattern));

/**
 * A rule of this plugin: one message and its own file scope, so the rule file is
 * the only place the rule is defined. `create(context, report)` returns the AST visitors and
 * calls `report(node)` for each finding.
 */
export function defineRule({ files, ignores = TESTS, message, create }) {
  return {
    meta: { type: "problem", docs: { description: message }, files, ignores },
    create(context) {
      const file = path.relative(context.cwd, context.filename).replaceAll("\\", "/");
      if (!matches(file, files) || matches(file, ignores)) return {};
      return create(context, (node) => context.report({ node, message }));
    },
  };
}

/** `name` for `name(...)`, `Object.name` for a plain member callee, otherwise undefined. */
export function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    !callee.optional &&
    callee.object.type === "Identifier"
  )
    return `${callee.object.name}.${callee.property.name}`;
  return undefined;
}

/** `<anything>.name(...)` written without optional chaining. */
export const isMethodCall = (node, name) =>
  node?.type === "CallExpression" &&
  !node.optional &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  !node.callee.optional &&
  node.callee.property.name === name;

export const isString = (node) => node?.type === "Literal" && typeof node.value === "string";
