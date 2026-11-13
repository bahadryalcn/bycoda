import { ActionHost, actionContentAttributes } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { useState } from "react";
import { projectName } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineError } from "../../../shared/ui/InlineError";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { FolderOpen, Pin, Trash2 } from "../../../shared/ui/icons";
import type { ManagedWorkspace } from "../model/contracts";
import { lifecycleLabel } from "../model/workspacePresentation";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import styles from "./WorkspaceManagedRow.module.css";

export function WorkspaceManagedRow({
  workspace,
  title,
  missing = false,
  cleanupDueAt,
  reviewDisabled,
  pinning,
  pinError,
  removing = false,
  onReview,
  onReveal,
  pin,
  remove,
}: {
  workspace: ManagedWorkspace;
  title: string;
  /** The managed folder is not on disk. */
  missing?: boolean;
  /** Epoch ms when automatic cleanup becomes due. */
  cleanupDueAt?: number;
  reviewDisabled: boolean;
  pinning: boolean;
  pinError?: string;
  /** Removal of this workspace runs in the background. */
  removing?: boolean;
  onReview: () => void;
  onReveal: () => void;
  /** Omit `disabledReason` when the toggle is available. */
  pin: { disabledReason?: string; onToggle: () => void };
  /** Delete the directory, review a blocked cleanup or retire the record of a missing folder. */
  remove: { label: string; disabledReason?: string; onRemove: () => void };
}) {
  const [open, setOpen] = useState(false);
  const branch = workspace.branchRef.replace(/^refs\/heads\//, "");
  const blocked = workspace.directoryState === "blocked";
  const dotTone =
    missing || blocked ? "warning" : workspace.state === "active" ? "info" : "secondary";
  const cleanup =
    cleanupDueAt === undefined
      ? undefined
      : cleanupDueAt <= wallClockNow()
        ? t("Cleanup pending")
        : t("Cleanup {p0}", { p0: formatRelativeTime(cleanupDueAt) });
  const caption = [projectName(workspace.path), title !== branch ? branch : undefined, cleanup]
    .filter(Boolean)
    .join(" · ");
  return (
    <ActionHost
      role="listitem"
      {...surfaceAttributes(
        { radius: "none", separator: "block" },
        `settings-collection-row ${styles.row}`,
      )}
      interactionOpen={open}
      data-open={open || undefined}
    >
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        chevron="end"
        summary={
          <span className={styles.main}>
            <StatusDot tone={dotTone} size="compact" className={styles.dot} />
            <span className={`settings-collection-main ${styles.identity}`}>
              <span className={styles.line}>
                <Tooltip label={title} when="overflow">
                  <Text
                    as="span"
                    size="secondary"
                    tone="inherit"
                    weight="medium"
                    leading="inherit"
                    truncate
                    className={styles.title}
                  >
                    {title}
                  </Text>
                </Tooltip>
                <Badge size="sm">{lifecycleLabel(workspace.state)}</Badge>
                {missing && (
                  <Badge size="sm" tone="warning">
                    {t("Missing folder")}
                  </Badge>
                )}
                {blocked && (
                  <Badge size="sm" tone="warning">
                    {t("Cleanup blocked")}
                  </Badge>
                )}
                {workspace.directoryState === "removed" && (
                  <Badge size="sm">{t("Directory removed")}</Badge>
                )}
                {(removing ||
                  workspace.directoryState === "pendingRemoval" ||
                  workspace.directoryState === "removing") && (
                  <Badge size="sm">{t("Removing directory…")}</Badge>
                )}
                {workspace.pinned && <Badge size="sm">{t("Pinned")}</Badge>}
              </span>
              <Tooltip label={caption} when="overflow">
                <Text
                  size="caption"
                  tone="muted"
                  leading="inherit"
                  truncate
                  className={`${styles.caption} font-mono`}
                >
                  {caption}
                </Text>
              </Tooltip>
              {pinError && <InlineError className="break-words">{pinError}</InlineError>}
            </span>
          </span>
        }
        summaryActions={
          <div
            {...actionContentAttributes(
              { phase: "rest", hide: "dim", focus: "within" },
              `settings-collection-actions ${styles.actions}`,
            )}
          >
            <Button size="sm" disabled={reviewDisabled || removing} onClick={onReview}>
              {t("Review changes")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={t("Reveal folder")}
              disabled={missing || workspace.directoryState === "removed"}
              disabledReason={t("This folder is not on disk.")}
              onClick={onReveal}
            >
              <FolderOpen className="icon-sm" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={workspace.pinned ? t("Unpin workspace") : t("Pin workspace")}
              tooltipDetails={[t("Pinned workspaces are never cleaned up automatically.")]}
              pressed={workspace.pinned}
              loading={pinning}
              disabled={!!pin.disabledReason || removing}
              disabledReason={pin.disabledReason}
              onClick={pin.onToggle}
            >
              <Pin className="icon-sm" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              iconOnly
              label={remove.label}
              disabled={!!remove.disabledReason || removing}
              disabledReason={
                removing ? t("Deletion is running in the background.") : remove.disabledReason
              }
              onClick={remove.onRemove}
            >
              <Trash2 className="icon-sm" />
            </Button>
          </div>
        }
      >
        <div className={styles.details}>
          <DescriptionList size="sm">
            <DescriptionItem term={t("Folder")} monospace>
              {workspace.path}
            </DescriptionItem>
            <DescriptionItem term={t("Branch")} monospace>
              {workspace.branchRef}
            </DescriptionItem>
            <DescriptionItem term={t("Workspace ID")} monospace>
              {workspace.id}
            </DescriptionItem>
            <DescriptionItem term={t("Owner")} monospace>
              {workspace.owner.kind} · {workspace.owner.id}
            </DescriptionItem>
          </DescriptionList>
        </div>
      </Disclosure>
    </ActionHost>
  );
}
