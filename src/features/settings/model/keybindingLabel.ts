import { t } from "../../../shared/i18n";

/**
 * Splits off the category of a translated binding ("App: Search", "应用：快速输入"). The category
 * is already the group title, so the row shows only the action. Matches the ASCII and the
 * full-width colon because translators use either. The category's own translation is not
 * matched on purpose: zh-CN translates "App" as 应用程序 but the binding as 应用：…
 */
const CATEGORY_SEPARATOR = /^[^:：]+[:：]\s*/;

/**
 * Row label for a keybinding: the translated command without its category. Commands stay
 * English keys (override ids, filter and group keys); only the displayed text is translated.
 */
export function keybindingActionLabel(
  command: string,
  translate: (message: string) => string = t,
): string {
  const label = translate(command);
  const action = label.replace(CATEGORY_SEPARATOR, "");
  // shortcut: a label that is only a category keeps its full text rather than rendering empty.
  return action || label;
}
