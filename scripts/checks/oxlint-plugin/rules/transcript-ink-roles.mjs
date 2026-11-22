import { defineRule, isString } from "../define-rule.mjs";

// Full ink (`--color-content`) as a text color: the Tailwind utilities `text-(--color-content)`,
// `text-content` and the arbitrary forms `text-[var(--color-content)]` / `text-[color:var(...)]`.
const FULL_INK_CLASS =
  /(?<![\w-])text-(?:\(--color-content\)|content(?![\w-])|\[(?:color:)?var\(--color-content\)\])/;
// Inline `style={{ color: "var(--color-content)" }}`.
const FULL_INK_STYLE = /var\(--color-content\)/;

const styleText = (value) => {
  if (value?.type === "Literal") return typeof value.value === "string" ? value.value : "";
  if (value?.type === "TemplateLiteral") return value.quasis.map((q) => q.value.raw).join("");
  return "";
};

export default defineRule({
  files: ["src/features/sessions/ui/**/*.tsx"],
  message:
    'Full text ink (`--color-content`) on transcript chrome flattens the hierarchy: commands, chips and icons read as loud as the emphasis they support. Use `--ui-text-secondary` (or `--ui-text-muted` for the resting state) through `text-(--ui-text-secondary)` / `text-(--ui-text-muted)` or the `Text tone="secondary"` prop. Full ink is for emphasis only; if this is emphasis, keep it with `// oxlint-disable-next-line bycoda/transcript-ink-roles -- <what is emphasized>` on the line above.',
  create: (_context, report) => {
    const checkText = (text, node) => {
      if (FULL_INK_CLASS.test(text)) report(node);
    };
    return {
      Literal(node) {
        if (isString(node)) checkText(node.value, node);
      },
      TemplateElement(node) {
        checkText(node.value.cooked ?? node.value.raw, node);
      },
      Property(node) {
        const { key } = node;
        const isColorKey =
          !node.computed &&
          ((key.type === "Identifier" && key.name === "color") ||
            (key.type === "Literal" && key.value === "color"));
        if (isColorKey && FULL_INK_STYLE.test(styleText(node.value))) report(node);
      },
    };
  },
});
