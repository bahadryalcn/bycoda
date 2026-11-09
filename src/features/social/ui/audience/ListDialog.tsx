import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialList } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason } from "../common/DisabledReason";
import { errorMessage } from "./audienceModel";

export type ListDialogProps = {
  client: SocialClient;
  onClose: () => void;
  onCreated: (list: SocialList) => void;
};

/** A static list: people are added to it explicitly from the table or a capture rule. */
export function ListDialog({ client, onClose, onCreated }: ListDialogProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const saveState = name.trim()
    ? { disabled: false as const }
    : { disabled: true as const, reason: t("Enter a name for the list.") };

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setError(undefined);
    try {
      const list = await client.lists.save({ name: name.trim(), kind: "static", projectIds: [] });
      onCreated(list);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("New list")}
      description={t("Add people to it from the table after you create it.")}
      onClose={() => {
        if (!saving) onClose();
      }}
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <DisabledReason
            variant="primary"
            loading={saving}
            {...saveState}
            onClick={() => void save().catch(() => undefined)}
          >
            {t("Create list")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <TextField
        label={t("List name")}
        value={name}
        disabled={saving}
        onChange={(event) => setName(event.target.value)}
      />
    </Modal>
  );
}
