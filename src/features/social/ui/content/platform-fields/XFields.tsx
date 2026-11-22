import { InfoPopover } from "../../../../../shared/ui/InfoPopover";
import { t } from "../../../../../shared/i18n";

/** X takes up to four images or one video; the rule is enforced with the attachment (contentRules). */
export function XFields() {
  return (
    <InfoPopover className="self-start shrink-0">
      {t("X posts take either up to four images or one video.")}
    </InfoPopover>
  );
}
