import { useSyncExternalStore } from "react";
import { t } from "../../../shared/i18n";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import {
  KEYBINDINGS,
  keybindingShortcutLabel,
  subscribeKeybindings,
} from "../../settings/model/settings";
import type { GuideShortcut } from "../model/guideTopics";

/** User-facing shortcut names with the keys currently bound (custom or disabled included). */
export function GuideShortcuts({ items }: { items: readonly GuideShortcut[] }) {
  const snapshot = useSyncExternalStore(
    subscribeKeybindings,
    () =>
      JSON.stringify(
        items.map(({ command }) =>
          keybindingShortcutLabel(
            command,
            KEYBINDINGS.find((binding) => binding.command === command)?.keys ?? "",
          ),
        ),
      ),
    () => "[]",
  );
  const keys: (string | null)[] = JSON.parse(snapshot);
  return (
    <DescriptionList size="sm">
      {items.map(({ command, label }, index) => (
        <DescriptionItem key={command} term={label}>
          {keys[index] ? <ShortcutKbd size="xs">{keys[index]}</ShortcutKbd> : t("Disabled")}
        </DescriptionItem>
      ))}
    </DescriptionList>
  );
}
