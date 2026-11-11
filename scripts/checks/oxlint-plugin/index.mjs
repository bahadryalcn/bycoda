/**
 * Repository lint rules, switched on in scripts/checks/lint-config.mjs. One file per rule in rules/; each
 * carries its message and file scope, and docs/reference/rules.md is
 * generated from these definitions. A rule is named after what the code must do, not after
 * the violation.
 */
import appLocaleFormatting from "./rules/app-locale-formatting.mjs";
import compilerOwnsMemo from "./rules/compiler-owns-memo.mjs";
import compilerStaysOn from "./rules/compiler-stays-on.mjs";
import effectNamesItsSync from "./rules/effect-names-its-sync.mjs";
import graphemeSafeTruncate from "./rules/grapheme-safe-truncate.mjs";
import handledBackgroundPromise from "./rules/handled-background-promise.mjs";
import safeTimestampRender from "./rules/safe-timestamp-render.mjs";
import sharedFormattersOnly from "./rules/shared-formatters-only.mjs";
import sharedResizeObserver from "./rules/shared-resize-observer.mjs";
import suppressionHasReason from "./rules/suppression-has-reason.mjs";
import utf8ChildLocale from "./rules/utf8-child-locale.mjs";
import wholeSentenceTranslation from "./rules/whole-sentence-translation.mjs";

export const rules = {
  "app-locale-formatting": appLocaleFormatting,
  "compiler-owns-memo": compilerOwnsMemo,
  "compiler-stays-on": compilerStaysOn,
  "effect-names-its-sync": effectNamesItsSync,
  "grapheme-safe-truncate": graphemeSafeTruncate,
  "handled-background-promise": handledBackgroundPromise,
  "safe-timestamp-render": safeTimestampRender,
  "shared-formatters-only": sharedFormattersOnly,
  "shared-resize-observer": sharedResizeObserver,
  "suppression-has-reason": suppressionHasReason,
  "utf8-child-locale": utf8ChildLocale,
  "whole-sentence-translation": wholeSentenceTranslation,
};

export default { meta: { name: "bycoda" }, rules };
