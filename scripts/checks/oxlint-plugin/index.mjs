import literalTranslationKey from "./rules/literal-translation-key.mjs";
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
import buttonPressedProp from "./rules/button-pressed-prop.mjs";
import graphemeSafeTruncate from "./rules/grapheme-safe-truncate.mjs";
import handledBackgroundPromise from "./rules/handled-background-promise.mjs";
import safeTimestampRender from "./rules/safe-timestamp-render.mjs";
import sharedFormattersOnly from "./rules/shared-formatters-only.mjs";
import sharedResizeObserver from "./rules/shared-resize-observer.mjs";
import sharedContainerAppearance from "./rules/shared-container-appearance.mjs";
import suppressionHasReason from "./rules/suppression-has-reason.mjs";
import transcriptInkRoles from "./rules/transcript-ink-roles.mjs";
import transcriptRowTrigger from "./rules/transcript-row-trigger.mjs";
import dialogSingleTranslator from "./rules/dialog-single-translator.mjs";
import iconButtonNeedsLabel from "./rules/icon-button-needs-label.mjs";
import menuUsesDropdown from "./rules/menu-uses-dropdown.mjs";
import toastNeedsTone from "./rules/toast-needs-tone.mjs";
import noRawErrorText from "./rules/no-raw-error-text.mjs";
import translationSlotNames from "./rules/translation-slot-names.mjs";
import taskStateFromStopCode from "./rules/task-state-from-stop-code.mjs";
import utf8ChildLocale from "./rules/utf8-child-locale.mjs";
import wholeSentenceTranslation from "./rules/whole-sentence-translation.mjs";

export const rules = {
  "app-locale-formatting": appLocaleFormatting,
  "compiler-owns-memo": compilerOwnsMemo,
  "compiler-stays-on": compilerStaysOn,
  "effect-names-its-sync": effectNamesItsSync,
  "button-pressed-prop": buttonPressedProp,
  "grapheme-safe-truncate": graphemeSafeTruncate,
  "handled-background-promise": handledBackgroundPromise,
  "safe-timestamp-render": safeTimestampRender,
  "shared-formatters-only": sharedFormattersOnly,
  "shared-resize-observer": sharedResizeObserver,
  "shared-container-appearance": sharedContainerAppearance,
  "suppression-has-reason": suppressionHasReason,
  "transcript-ink-roles": transcriptInkRoles,
  "transcript-row-trigger": transcriptRowTrigger,
  "dialog-single-translator": dialogSingleTranslator,
  "icon-button-needs-label": iconButtonNeedsLabel,
  "menu-uses-dropdown": menuUsesDropdown,
  "toast-needs-tone": toastNeedsTone,
  "literal-translation-key": literalTranslationKey,
  "no-raw-error-text": noRawErrorText,
  "translation-slot-names": translationSlotNames,
  "task-state-from-stop-code": taskStateFromStopCode,
  "utf8-child-locale": utf8ChildLocale,
  "whole-sentence-translation": wholeSentenceTranslation,
};

export default { meta: { name: "bycoda" }, rules };
