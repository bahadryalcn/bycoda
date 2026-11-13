import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Modal } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialList } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import { errorMessage } from "./audienceModel";
import { useFormFooter, useTouched } from "./formFooter";

export type ListDialogProps = {
  client: SocialClient;
  /** The list being renamed. Omit to create a new one. */
  list?: SocialList;
  onClose: () => void;
  onSaved: (list: SocialList) => void;
};

/** A static list: people are added to it explicitly from the table or a capture rule. Renaming keeps its people. */
export function ListDialog({ client, list: existing, onClose, onSaved }: ListDialogProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { touched, touch } = useTouched();
  const nameReason = name.trim() ? undefined : t("Enter a name for the list.");

  async function save() {
    if (nameReason) return;
    setSaving(true);
    setError(undefined);
    try {
      const list = await client.lists.save({
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        kind: "static",
        projectIds: existing?.projectIds ?? [],
      });
      onSaved(list);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const footer = useFormFooter({
    saving,
    error,
    blockedReason: nameReason,
    saveLabel: existing ? t("Save name") : t("Create list"),
    onSave: () => void save().catch(() => undefined),
    onCancel: onClose,
  });

  return (
    <Modal
      title={existing ? t("Rename list") : t("New list")}
      description={
        existing
          ? t("The people in this list stay in it.")
          : t("Add people to it from the table after you create it.")
      }
      onClose={() => {
        if (!saving) onClose();
      }}
      {...footer}
    >
      <TextField
        label={t("List name")}
        value={name}
        disabled={saving}
        error={touched("name") ? nameReason : undefined}
        onBlur={() => touch("name")}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}
