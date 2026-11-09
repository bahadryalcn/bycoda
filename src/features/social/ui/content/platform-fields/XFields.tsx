import { t } from "../../../../../shared/i18n";

/** X takes up to four images or one video; the rule is enforced with the attachment (contentRules). */
export function XFields() {
  return (
    <p className="content-platform-note">
      {t("X posts take either up to four images or one video.")}
    </p>
  );
}
