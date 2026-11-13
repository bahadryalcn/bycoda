import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Modal } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import type { AudienceFilter, SocialList } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import { errorMessage, isFilterEmpty } from "./audienceModel";
import { useFormFooter, useTouched } from "./formFooter";
import { SegmentFilterFields } from "./SegmentFilterFields";

export type SegmentBuilderProps = {
  client: SocialClient;
  /** The segment being edited. Omit to create a new one. */
  list?: SocialList;
  onClose: () => void;
  onSaved: (list: SocialList) => void;
};

/**
 * Builds or edits a dynamic segment: a name and at least one condition. The list keeps updating as
 * people change. Editing keeps the segment's id and project scope; its members are never stored.
 */
export function SegmentBuilder({ client, list: existing, onClose, onSaved }: SegmentBuilderProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [filter, setFilter] = useState<AudienceFilter>(() => ({ ...existing?.filter }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { touched, touch } = useTouched();

  const nameReason = name.trim() ? undefined : t("Enter a name for the segment.");
  const saveReason =
    nameReason ?? (isFilterEmpty(filter) ? t("Add at least one condition.") : undefined);

  async function save() {
    if (saveReason) return;
    setSaving(true);
    setError(undefined);
    try {
      const list = await client.lists.save({
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        kind: "dynamic",
        filter,
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
    blockedReason: saveReason,
    saveLabel: t("Save segment"),
    onSave: () => void save().catch(() => undefined),
    onCancel: onClose,
  });

  return (
    <Modal
      title={existing ? t("Edit segment") : t("New segment")}
      description={t(
        "A segment shows everyone who matches these conditions, and updates by itself.",
      )}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      {...footer}
    >
      <div className="audience-stack">
        <TextField
          label={t("Segment name")}
          value={name}
          disabled={saving}
          error={touched("name") ? nameReason : undefined}
          onBlur={() => touch("name")}
          onChange={(event) => setName(event.target.value)}
        />
        <SegmentFilterFields value={filter} onChange={setFilter} disabled={saving} />
      </div>
    </Modal>
  );
}
