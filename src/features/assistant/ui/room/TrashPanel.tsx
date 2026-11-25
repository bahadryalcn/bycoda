import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Text, textAttributes } from "../../../../shared/ui/Text";
import { useState } from "react";
import type { AssistantTrash } from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { InlineAction, ActionHost } from "../../../../shared/ui/ActionHost";
import { Brain, Briefcase, Clock, File, MessageSquare, Trash2 } from "../../../../shared/ui/icons";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Tooltip } from "../../../../shared/ui/Tooltip";
import { Button } from "../../../../shared/ui/Button";
import { Modal } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/ui/InlineError";
import { ConfirmDialog, type ConfirmRequest } from "../../../../shared/ui/ConfirmDialog";
import styles from "./TrashPanel.module.css";
import type { OwnerRequest } from "./assistantRoomHelpers";

const when = (at: number) => formatDate(at, { dateStyle: "medium", timeStyle: "short" });

const trashKind = {
  jobs: { Icon: Briefcase, label: "Jobs" },
  memory: { Icon: Brain, label: "Memory" },
  activity: { Icon: Clock, label: "History" },
  messages: { Icon: MessageSquare, label: "Messages" },
  notetrash: { Icon: File, label: "Notes" },
} as const satisfies Record<AssistantTrash["kind"], { Icon: typeof File; label: string }>;

export function TrashPanel({
  request,
  entries,
  onRestored,
  onClose,
}: {
  request: OwnerRequest;
  entries: AssistantTrash[];
  onRestored: (id: string) => void;
  onClose: () => void;
}) {
  const [assistantRequest] = useState(() => request);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  async function restore(id: string) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      const result = await assistantRequest({ op: "trash.restore", id });
      if (result.ok !== true)
        throw new Error(
          t("The restore could not be confirmed. Check Recently deleted before retrying."),
        );
      onRestored(id);
    } catch (cause) {
      setError(presentRemoteError(cause, { explicit: true }));
    } finally {
      setPending(null);
    }
  }
  return (
    <Modal
      title={t("Recently deleted")}
      onClose={onClose}
      size="md"
      fitViewport
      footerStart={
        <InfoPopover label={t("About recently deleted")}>
          <Text as="p" tone="muted" leading="inherit">
            {t("Deleted records are kept for seven days. Restoring a job does not restart it.")}
          </Text>
        </InfoPopover>
      }
    >
      <div className={styles.stack}>
        {!entries.length && (
          <EmptyState
            size="inline"
            kind="empty"
            inset="panel"
            description={t("Nothing deleted recently")}
          />
        )}
        {entries.length > 0 && (
          <ul className={styles.list}>
            {entries.map((entry) => {
              const { Icon, label } = trashKind[entry.kind];
              return (
                <ActionHost
                  as="li"
                  {...surfaceAttributes({ radius: "none", separator: "pane-block" }, styles.row)}
                  key={entry.id}
                >
                  <div className={styles.text}>
                    <Text as="strong" size="body" tone="inherit" weight="medium" leading="inherit">
                      {entry.title}
                    </Text>
                    <span
                      {...textAttributes(
                        { size: "caption", tone: "muted", leading: "inherit" },
                        styles.meta,
                      )}
                    >
                      <Tooltip asChild label={t(label)}>
                        <span role="img" aria-label={t("Record type: {p0}", { p0: t(label) })}>
                          <Icon className="icon-sm" />
                        </span>
                      </Tooltip>
                      <span>{when(entry.deletedAt)}</span>
                      <span>{t("Kept until {p0}", { p0: when(entry.expiresAt) })}</span>
                    </span>
                    {entry.kind === "jobs" && entry.deletedTaskCount !== undefined && (
                      <Text size="caption" tone="muted" leading="inherit">
                        {t("Includes {p0} deleted tasks. Restoring keeps them stopped.", {
                          p0: entry.deletedTaskCount,
                        })}
                      </Text>
                    )}
                  </div>
                  <Button
                    size="sm"
                    loading={pending === entry.id}
                    disabled={Boolean(pending)}
                    onClick={() => void restore(entry.id)}
                  >
                    {t("Restore")}
                  </Button>
                  <InlineAction
                    reveal="always"
                    label={t("Delete permanently")}
                    disabled={Boolean(pending)}
                    onClick={() =>
                      setConfirm({
                        title: t("Delete permanently?"),
                        message: entry.title,
                        confirmLabel: t("Delete permanently"),
                        consequences: [t("This record cannot be restored.")],
                        onConfirm: async () => {
                          await assistantRequest({ op: "trash.purge", id: entry.id });
                        },
                      })
                    }
                  >
                    <Trash2 className="icon-sm" />
                  </InlineAction>
                </ActionHost>
              );
            })}
          </ul>
        )}
        {error && <InlineError className={styles.error}>{error}</InlineError>}
        {confirm && <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />}
      </div>
    </Modal>
  );
}
