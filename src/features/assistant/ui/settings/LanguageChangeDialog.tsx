import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { Text } from "../../../../shared/ui/Text";
import { Sparkles } from "../../../../shared/ui/icons";
import { languageDisplayName, type LanguageChange } from "../../model/languageBoundSettings";

/**
 * Asks what to do with settings written for the previous spoken language: write them again with
 * the AI builder, review them by hand, or keep the language as it was. Nothing is saved here.
 */
export function LanguageChangeDialog({
  change,
  onRewrite,
  onReview,
  onCancel,
}: {
  change: LanguageChange;
  onRewrite: () => void;
  onReview: () => void;
  onCancel: () => void;
}) {
  const to = languageDisplayName(change.to);
  const body = change.from
    ? t(
        "Your language was {p0} and you are switching to {p1}. These settings were arranged for {p0}:",
        { p0: languageDisplayName(change.from), p1: to },
      )
    : t(
        "Your settings were arranged for another language and you are switching to {p0}. These settings may no longer fit:",
        { p0: to },
      );
  return (
    <Modal
      title={t("Settings written for another language")}
      onClose={onCancel}
      size="sm"
      footer={
        <ModalActions>
          <Button variant="ghost" type="button" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="button" onClick={onReview}>
            {t("I will review them myself")}
          </Button>
          <Button
            variant="primary"
            type="button"
            startIcon={<Sparkles className="icon-sm" />}
            onClick={onRewrite}
          >
            {t("Create again with AI")}
          </Button>
        </ModalActions>
      }
    >
      <Text as="p" leading="inherit">
        {body}
      </Text>
      <ul className="mt-2 list-disc ps-5">
        {change.items.map((item) => (
          <li key={item.key}>
            <Text as="span" leading="inherit">
              {item.label}
            </Text>
          </li>
        ))}
      </ul>
      <Text as="p" tone="secondary" size="secondary" leading="inherit" className="mt-2">
        {t("Create again with AI writes them in {p0}. Nothing changes until you confirm.", {
          p0: to,
        })}
      </Text>
    </Modal>
  );
}
