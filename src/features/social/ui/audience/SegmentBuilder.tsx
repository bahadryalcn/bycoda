import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { DisabledReason } from "../common/DisabledReason";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import type { AudienceFilter, SocialList } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import { errorMessage, isFilterEmpty } from "./audienceModel";
import { SegmentFilterFields } from "./SegmentFilterFields";

export type SegmentBuilderProps = {
  client: SocialClient;
  onClose: () => void;
  onCreated: (list: SocialList) => void;
};

/** Builds a dynamic segment: a name and at least one condition. The list keeps updating as people change. */
export function SegmentBuilder({ client, onClose, onCreated }: SegmentBuilderProps) {
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<AudienceFilter>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const nameMissing = !name.trim();
  const filterMissing = isFilterEmpty(filter);
  const saveReason = nameMissing
    ? t("Enter a name for the segment.")
    : filterMissing
      ? t("Add at least one condition.")
      : undefined;

  const saveState = saveReason
    ? { disabled: true as const, reason: saveReason }
    : { disabled: false as const };

  async function save() {
    if (saveReason) return;
    setSaving(true);
    setError(undefined);
    try {
      const list = await client.lists.save({
        name: name.trim(),
        kind: "dynamic",
        filter,
        projectIds: [],
      });
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
      title={t("New segment")}
      description={t(
        "A segment shows everyone who matches these conditions, and updates by itself.",
      )}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
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
            {t("Save segment")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <div className="audience-stack">
        <TextField
          label={t("Segment name")}
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
        <SegmentFilterFields value={filter} onChange={setFilter} disabled={saving} />
      </div>
    </Modal>
  );
}
