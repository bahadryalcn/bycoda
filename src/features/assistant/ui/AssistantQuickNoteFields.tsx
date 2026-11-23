import type { AssistantQuickNoteAction } from "../../../shared/model/assistantQuick";
import { normalizeAssistantQuickNoteAction } from "../../../shared/model/assistantQuick";
import { t } from "../../../shared/i18n";
import { TextField } from "../../../shared/ui/TextField";
import { Text } from "../../../shared/ui/Text";
import { TextareaField } from "../../../shared/ui/TextareaField";
import styles from "./AssistantNoteCard.module.css";
export function AssistantQuickNoteFields({
  value,
  onChange,
  disabled = false,
}: {
  value: AssistantQuickNoteAction;
  onChange: (value: AssistantQuickNoteAction) => void;
  disabled?: boolean;
}) {
  const update = (patch: Partial<AssistantQuickNoteAction>) => {
    if (!disabled) onChange({ ...value, ...patch });
  };
  // The normalized title is only worth showing when it differs from what the owner typed.
  const savedTitle = normalizeAssistantQuickNoteAction(value).title;
  return (
    <div className={styles.quickFields}>
      <TextField
        label={t("Note title")}
        value={value.title}
        maxLength={200}
        disabled={disabled}
        onChange={(event) => update({ title: event.currentTarget.value })}
      />
      <TextareaField
        label={t("Note content")}
        value={value.body}
        maxLength={100000}
        minRows={3}
        maxRows={10}
        disabled={disabled}
        onChange={(event) => update({ body: event.currentTarget.value })}
      />
      {savedTitle !== value.title && (
        <Text as="p" tone="muted" leading="inherit" className={styles.savedTitle}>
          {t("Saved title")}: {savedTitle}
        </Text>
      )}
    </div>
  );
}
