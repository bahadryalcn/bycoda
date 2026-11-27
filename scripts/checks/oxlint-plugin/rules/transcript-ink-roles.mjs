import path from "node:path";
import { defineRule, isString } from "../define-rule.mjs";

// Full ink (`--color-content`) as a text color: the Tailwind utilities `text-(--color-content)`,
// `text-content` and the arbitrary forms `text-[var(--color-content)]` / `text-[color:var(...)]`.
const FULL_INK_CLASS =
  /(?<![\w-])text-(?:\(--color-content\)|content(?![\w-])|\[(?:color:)?var\(--color-content\)\])/;
// Global chrome ink as a text color; transcript files must use the transcript ink roles instead.
const CHROME_INK_CLASS =
  /(?<![\w-])text-(?:\(--ui-text-(?:secondary|muted)\)|\[(?:color:)?var\(--ui-text-(?:secondary|muted)\)\])/;
// Inline `style={{ color: "var(--color-content)" }}`.
const FULL_INK_STYLE = /var\(--color-content\)/;
// The transcript files that own the reading surface and its chrome (K12 §6.3).
const TRANSCRIPT_FILE =
  /^(?:AgentTranscript[^/]*|SubagentCards|SubagentAnatomy|SessionReview|TranscriptMessageActions)\.tsx$/;

const styleText = (value) => {
  if (value?.type === "Literal") return typeof value.value === "string" ? value.value : "";
  if (value?.type === "TemplateLiteral") return value.quasis.map((q) => q.value.raw).join("");
  return "";
};

export default defineRule({
  files: ["src/features/sessions/ui/**/*.tsx"],
  message:
    "Transcript text ink must come from the transcript ink roles, not full or global text tokens: `--color-content` flattens the hierarchy (commands, chips and icons read as loud as the emphasis they support), and `--ui-text-secondary` / `--ui-text-muted` do not follow the reading surface. Use `text-(--transcript-ink-emphasis)` for emphasis, `text-(--transcript-ink-body)` for body text, and `text-(--transcript-ink-chrome)` / `text-(--transcript-ink-chrome-active)` for chrome at rest and active. If a full-ink use is real emphasis, keep it with `// oxlint-disable-next-line bycoda/transcript-ink-roles -- <what is emphasized>` on the line above.",
  create: (context, report) => {
    const file = path.basename(context.filename.replaceAll("\\", "/"));
    const transcriptFile = TRANSCRIPT_FILE.test(file);
    const checkText = (text, node) => {
      if (FULL_INK_CLASS.test(text) || (transcriptFile && CHROME_INK_CLASS.test(text)))
        report(node);
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
