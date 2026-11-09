import { useState } from "react";
import type { AssistantTrash } from "../../../../shared/model/host-contracts/assistant";
import { formatDate, t } from "../../../../shared/i18n";
import { InlineAction, ActionHost } from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Modal } from "../../../../shared/ui/Modal";
import { InlineError } from "../../../../shared/ui/InlineError";
import { ConfirmDialog, type ConfirmRequest } from "../../../../shared/ui/ConfirmDialog";
import { Trash2 } from "../../../../shared/ui/icons";
import styles from "./TrashPanel.module.css";
import type { OwnerRequest } from "./assistantRoomHelpers";

const when = (at: number) => formatDate(at, { dateStyle: "medium", timeStyle: "short" });

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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }
  return (
    <Modal title={t("Recently deleted")} onClose={onClose} size="md" fitViewport>
      <div className={styles.stack}>
        <p className={styles.hint}>
          {t("Deleted records are kept for seven days. Restoring a job does not restart it.")}
        </p>
        {!entries.length && <p className={styles.empty}>{t("Nothing deleted recently")}</p>}
        {entries.length > 0 && (
          <ul className={styles.list}>
            {entries.map((entry) => (
              <ActionHost as="li" className={styles.row} key={entry.id}>
                <div className={styles.text}>
                  <strong>{entry.title}</strong>
                  <span className={styles.meta}>
                    <Badge size="xs">
                      {t(
                        entry.kind === "jobs"
                          ? "Jobs"
                          : entry.kind === "memory"
                            ? "Memory"
                            : entry.kind === "activity"
                              ? "History"
                              : entry.kind === "messages"
                                ? "Messages"
                                : "Notes",
                      )}
                    </Badge>
                    <span>{when(entry.deletedAt)}</span>
                    <span>{t("Kept until {p0}", { p0: when(entry.expiresAt) })}</span>
                  </span>
                  {entry.kind === "jobs" && entry.deletedTaskCount !== undefined && (
                    <span className={styles.meta}>
                      {t("Includes {p0} deleted tasks. Restoring keeps them stopped.", {
                        p0: entry.deletedTaskCount,
                      })}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  loading={pending === entry.id}
                  disabled={Boolean(pending)}
                  // ast-grep-ignore: ts-void-promise-without-catch -- restore() reports its own failures in state
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
            ))}
          </ul>
        )}
        {error && <InlineError className={styles.error}>{error}</InlineError>}
        {confirm && <ConfirmDialog request={confirm} onSettle={() => setConfirm(null)} />}
      </div>
    </Modal>
  );
}
