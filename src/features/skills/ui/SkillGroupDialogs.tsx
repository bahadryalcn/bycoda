import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import {
  createSkillGroup,
  renameSkillGroup,
  deleteSkillGroup,
  listSkillGroups,
  skillGroupInvocation,
  type SkillGroup,
} from "../index";
import { slugSkillName } from "../model/skills";
import { isImeComposition } from "../../../shared/lib/keyboard";

export type GroupEdit =
  | { kind: "create"; skillNames: string[] }
  | { kind: "rename" | "delete"; group: SkillGroup };
export function SkillGroupDialogs({
  edit,
  onClose,
  onCreated,
}: {
  edit: GroupEdit;
  onClose: () => void;
  /** A new group opens in the membership editor. */
  onCreated?: (group: SkillGroup) => void;
}) {
  useLocale();
  const [name, setName] = useState(edit.kind === "create" ? "" : edit.group.name);
  const [command, setCommand] = useState(
    edit.kind === "create" ? "" : (edit.group.invocation ?? ""),
  );
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
      const invocation = slugSkillName(command);
      if (command.replace(/^\/+/, "").trim() && !invocation)
        throw new Error(t("Use lowercase letters, numbers, and hyphens."));
      const id = edit.kind === "create" ? undefined : edit.group.id;
      const effective = skillGroupInvocation({ name, invocation });
      if (
        listSkillGroups().some(
          (group) => group.id !== id && skillGroupInvocation(group) === effective,
        )
      )
        throw new Error(t("Another group already uses /{p0}", { p0: effective }));
      if (edit.kind === "create")
        onCreated?.(
          createSkillGroup({
            name,
            skillNames: edit.skillNames,
            ...(invocation ? { invocation } : {}),
          }),
        );
      else renameSkillGroup(edit.group.id, name, invocation);
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
        <ModalActions reason={name.trim() ? undefined : t("Enter a name.")}>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            disabledReason={name.trim() ? undefined : t("Enter a name.")}
            onClick={save}
          >
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
          if (event.key === "Enter" && !isImeComposition(event.nativeEvent) && name.trim()) {
            event.preventDefault();
            save();
          }
        }}
      />
      <TextField
        label={t("Command")}
        monospace
        value={command}
        placeholder={`/${skillGroupInvocation({ name })}`}
        onChange={(event) => setCommand(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isImeComposition(event.nativeEvent) && name.trim()) {
            event.preventDefault();
            save();
          }
        }}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </Modal>
  );
}
