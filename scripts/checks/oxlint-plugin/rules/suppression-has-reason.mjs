import { defineRule } from "../define-rule.mjs";

// The directive must open the comment, so prose that merely mentions one does not match.
const DIRECTIVE =
  /^(\/\/+|\/\*+)\s*(oxlint-disable|eslint-disable|ast-grep-ignore|ui-drift-ignore|@ts-expect-error|@ts-ignore)/;
const REASON = /\s--\s+\S/;

export default defineRule({
  files: ["src/**", "host/**", "packages/**"],
  message:
    "A suppression comment needs a reason so the next reader can tell a justified exception from a silenced defect. Append ` -- <why this line is safe>` in the same comment, for example `// oxlint-disable-next-line no-restricted-imports -- scratch file, not read at startup`.",
  create: (context, report) => ({
    Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        const text = context.sourceCode.text.slice(comment.range[0], comment.range[1]);
        if (DIRECTIVE.test(text) && !REASON.test(text)) report(comment);
      }
    },
  }),
});
