import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { createSkillGroup, renameSkillGroup, deleteSkillGroup, type SkillGroup } from "../index";

export type GroupEdit =
  | { kind: "create"; skillNames: string[] }
  | { kind: "rename" | "delete"; group: SkillGroup };
export function SkillGroupDialogs({ edit, onClose }: { edit: GroupEdit; onClose: () => void }) {
  useLocale();
  const [name, setName] = useState(edit.kind === "create" ? "" : edit.group.name);
  const [error, setError] = useState<string | null>(null);
  if (edit.kind === "delete")
    return (
      <ConfirmDialog
        request={{
          title: t("Delete group"),
          message: t("Delete {p0}? Skills stay installed.", { p0: edit.group.name }),
          confirmLabel: t("Delete"),
          onConfirm: () => deleteSkillGroup(edit.group.id),
        }}
        onSettle={onClose}
      />
    );
  const save = () => {
    try {
      if (edit.kind === "create") createSkillGroup({ name, skillNames: edit.skillNames });
      else renameSkillGroup(edit.group.id, name);
      onClose();
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <Modal
      title={edit.kind === "create" ? t("New group") : t("Rename group")}
      onClose={onClose}
      size="sm"
      footer={
        <ModalActions>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <TextField
        label={t("Group name")}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim()) {
            event.preventDefault();
            save();
          }
        }}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Modal>
  );
}
