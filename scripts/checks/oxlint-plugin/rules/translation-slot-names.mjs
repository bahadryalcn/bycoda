import { defineRule, isString } from "../define-rule.mjs";

/** Placeholders the runtime fills: `{p0}`, `{p1}`… (src/shared/i18n/core.ts translateAt). */
const NAMED_SLOT = /\{(?!p\d+\})[A-Za-z_]\w*\}/;

/** The message argument: `t(message, values)` or `translateAt(locale, message, values)`. */
const messageArgument = (node) => {
  if (node.type !== "CallExpression" || node.optional || node.callee.type !== "Identifier")
    return undefined;
  if (node.callee.name === "t") return node.arguments[0];
  if (node.callee.name === "translateAt") return node.arguments[1];
  return undefined;
};

const staticText = (node) => {
  if (isString(node)) return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return undefined;
};

export default defineRule({
  files: ["src/**"],
  message:
    'Named placeholders such as "{name}" stay on screen as raw text: the translator only fills positional slots. Use positional slots and pass the values by position: t("Add {p0}", { p0: name }).',
  create: (_context, report) => ({
    CallExpression(node) {
      const message = messageArgument(node);
      const text = message && staticText(message);
      if (text !== undefined && NAMED_SLOT.test(text)) report(message);
    },
  }),
});
