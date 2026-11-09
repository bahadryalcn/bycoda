import { t } from "../../../shared/i18n";
import { setQuickComposerShortcut } from "../../quick-composer/model/quickComposer";
import {
  loadQuickComposerEnabled,
  loadQuickComposerShortcut,
  saveQuickComposerEnabled,
  saveQuickComposerShortcut,
} from "./settings";

/** Writes the Quick Composer shortcut state, rolling every completed write back when one fails. */
export async function persistQuickComposerShortcut(
  nextEnabled: boolean,
  nextShortcut: string,
  writeShortcut: boolean,
  writeEnabled: boolean,
): Promise<void> {
  const previousEnabled = loadQuickComposerEnabled();
  const previousShortcut = loadQuickComposerShortcut();
  let nativeAttempted = false;
  let shortcutWritten = false;
  let enabledWritten = false;
  try {
    if (nextEnabled || previousEnabled) {
      nativeAttempted = true;
      await setQuickComposerShortcut(nextEnabled, nextShortcut);
    }
    if (writeShortcut) {
      shortcutWritten = true;
      if (saveQuickComposerShortcut(nextShortcut) === false)
        throw new Error(t("Could not save changes"));
    }
    if (writeEnabled) {
      enabledWritten = true;
      if (saveQuickComposerEnabled(nextEnabled) === false)
        throw new Error(t("Could not save changes"));
    }
  } catch (reason) {
    const failures = [String(reason)];
    const rollback = async (action: () => boolean | void | Promise<void>) => {
      try {
        if ((await action()) === false) throw new Error(t("Could not save changes"));
      } catch (error) {
        failures.push(t("Restoring the previous shortcut failed: {p0}", { p0: String(error) }));
      }
    };
    if (shortcutWritten) await rollback(() => saveQuickComposerShortcut(previousShortcut));
    if (enabledWritten) await rollback(() => saveQuickComposerEnabled(previousEnabled));
    if (nativeAttempted)
      await rollback(() => setQuickComposerShortcut(previousEnabled, previousShortcut));
    throw new Error(failures.join(" "));
  }
}
