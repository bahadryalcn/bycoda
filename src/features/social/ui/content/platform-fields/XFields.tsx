import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";

/** X takes up to four images or one video; the rule is enforced with the attachment (contentRules). */
export function XFields() {
  return (
    <Text as="p" size="caption" tone="muted" leading="inherit" className="content-platform-note">
      {t("X posts take either up to four images or one video.")}
    </Text>
  );
}
