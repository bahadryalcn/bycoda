import { useLocale } from "../../../shared/i18n";
import { Text } from "../../../shared/ui/Text";
import { useSavedThemes } from "../model/savedThemes";
import { backgroundDisplayName } from "../model/backgroundNames";

/** The same name beside current global/project previews and in their saved-choice controls. */
export function BackgroundName({ path }: { path: string | null }) {
  useLocale();
  const themes = useSavedThemes();
  return path ? (
    <Text as="div" size="caption" weight="medium" truncate>
      {backgroundDisplayName(path, themes)}
    </Text>
  ) : null;
}
