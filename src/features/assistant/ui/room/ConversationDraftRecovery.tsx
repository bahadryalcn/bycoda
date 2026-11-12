import { Text } from "../../../../shared/ui/Text";
import { formatDate, t } from "../../../../shared/i18n";
import { formatBytes } from "../../../../shared/i18n/format";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import styles from "./Conversation.module.css";
import type { ConversationContext } from "./ConversationTypes";

/** Saved-draft picker. The caller decides when the dialog is allowed to show. */
export function ConversationDraftRecovery({ c }: { c: ConversationContext }) {
  const {
    draftRecovery,
    setDraftRecovery,
    setError,
    loadDraftBackups,
    selectDraftBackup,
    restoreDraftBackup,
  } = c;
  if (!draftRecovery) return null;
  const report = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  return (
    <Modal
      title={t("Recover draft")}
      onClose={() => {
        if (!draftRecovery.loading) setDraftRecovery(null);
      }}
      size="md"
      fitViewport
      footer={
        <ModalActions>
          <Button
            variant="ghost"
            disabled={draftRecovery.loading}
            onClick={() => setDraftRecovery(null)}
          >
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            loading={draftRecovery.loading}
            disabled={draftRecovery.selectedText === undefined}
            onClick={() => void restoreDraftBackup().catch(report)}
          >
            {t("Restore draft")}
          </Button>
        </ModalActions>
      }
    >
      {draftRecovery.error && <InlineError>{draftRecovery.error}</InlineError>}
      <SearchableSelect
        hideLabel
        label={t("Saved draft")}
        value={draftRecovery.selected}
        options={draftRecovery.backups.map((item, index) => ({
          value: item.hash,
          label: t("Draft {p0}", { p0: index + 1 }),
          description: formatBytes(item.bytes),
        }))}
        onChange={(value) => void selectDraftBackup(value).catch(report)}
        disabled={draftRecovery.loading || draftRecovery.backups.length === 0}
      />
      <TextareaField
        label={t("Draft preview")}
        readOnly
        minRows={3}
        maxRows={8}
        autosize
        value={draftRecovery.selectedText ?? ""}
      />
      {draftRecovery.selectedSavedAt != null && (
        <Text as="p" size="caption" tone="secondary" leading="inherit" className={styles.note}>
          {formatDate(draftRecovery.selectedSavedAt, { dateStyle: "medium", timeStyle: "short" })}
        </Text>
      )}
      {draftRecovery.next && (
        <CollectionFooter
          standalone
          hasMore
          loadMoreButtonProps={{ variant: "secondary", disabled: draftRecovery.loading }}
          loadMoreLabel={t("Load more")}
          onLoadMore={() => {
            const current = draftRecovery;
            setDraftRecovery({ ...current, loading: true });
            void loadDraftBackups(
              current.threadId,
              current.environmentId,
              current.next,
              current.revision,
            ).catch(report);
          }}
        />
      )}
      <Button
        disabled={draftRecovery.loading}
        onClick={() => {
          const current = draftRecovery;
          setDraftRecovery({
            ...current,
            backups: [],
            selected: "",
            selectedText: undefined,
            selectedSavedAt: undefined,
            next: undefined,
            revision: undefined,
            loading: true,
          });
          void loadDraftBackups(current.threadId, current.environmentId).catch(report);
        }}
      >
        {t("Refresh")}
      </Button>
      {!draftRecovery.loading && !draftRecovery.backups.length && !draftRecovery.error && (
        <p>{t("No saved drafts found.")}</p>
      )}
    </Modal>
  );
}
