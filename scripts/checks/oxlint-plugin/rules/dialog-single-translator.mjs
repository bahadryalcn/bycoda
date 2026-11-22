import { defineRule } from "../define-rule.mjs";

const GIT_I18N = /(^|\/)i18n\/git$/;
const ANY_I18N = /(^|\/)i18n(\/(index|core))?$/;
const GIT_CONFIRMS = new Set(["confirmGitAction"]);

const importsT = (node) =>
  node.specifiers.some(
    (specifier) => specifier.type === "ImportSpecifier" && specifier.local.name === "t",
  );

const hasCancelLabel = (object) =>
  object.properties.some(
    (property) =>
      property.type === "Property" && !property.computed && property.key.name === "cancelLabel",
  );

/**
 * One dialog speaks one language. The Git language is its own preference (`i18n/git`) while the shared
 * Cancel default follows the interface language, so a Git-worded dialog can show "Cancel" in another
 * language. `confirmGitAction` words its dialog in the Git language, so their callers
 * must not word the text with the interface translator either.
 */
export default defineRule({
  files: ["src/**/*.{ts,tsx}"],
  message:
    'A dialog worded with the Git translator (`i18n/git`) keeps the shared default Cancel, which follows the interface language, so title and button end up in different languages. Pass `cancelLabel: t("Cancel")` from the same translator, or word the whole dialog with one translator; confirmGitAction callers outside the Git feature must use the interface translator for every string, so give them their own confirmInApp call.',
  create: (_context, report) => {
    let gitT = false;
    let interfaceT = false;
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !importsT(node)) return;
        if (GIT_I18N.test(node.source.value)) gitT = true;
        else if (ANY_I18N.test(node.source.value)) interfaceT = true;
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const name = node.callee.name;
        if (name === "confirmInApp" && gitT) {
          const [request] = node.arguments;
          if (request?.type === "ObjectExpression" && !hasCancelLabel(request)) report(node);
        } else if (GIT_CONFIRMS.has(name) && interfaceT && !gitT) {
          report(node);
        }
      },
    };
  },
});
