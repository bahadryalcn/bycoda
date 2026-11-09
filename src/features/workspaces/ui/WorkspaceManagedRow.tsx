import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { useId, useState, type MouseEventHandler } from "react";
import { projectName } from "../../../shared/lib/paths";
import { t } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ChevronDown, ChevronUp, MoreHorizontal } from "../../../shared/ui/icons";
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
  menuOpen,
  onReview,
  onMenu,
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
  menuOpen: boolean;
  onReview: () => void;
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
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
    <div
      role="listitem"
      className={`settings-collection-row ${styles.row}`}
      data-open={open || undefined}
    >
      <StatusDot tone={dotTone} size="compact" className={styles.dot} />
      <div className={`settings-collection-main ${styles.identity}`}>
        <div className={styles.line}>
          <Tooltip label={title} when="overflow">
            <span className={styles.title}>{title}</span>
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
          {(workspace.directoryState === "pendingRemoval" ||
            workspace.directoryState === "removing") && (
            <Badge size="sm">{t("Removing directory…")}</Badge>
          )}
          {workspace.pinned && <Badge size="sm">{t("Pinned")}</Badge>}
        </div>
        <Tooltip label={caption} when="overflow">
          <span className={styles.caption}>{caption}</span>
        </Tooltip>
        {pinError && <InlineError className="break-words">{pinError}</InlineError>}
      </div>
      <div className={`settings-collection-actions ${styles.actions}`}>
        <Button size="sm" disabled={reviewDisabled} onClick={onReview}>
          {t("Review changes")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={t("Details")}
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp className="icon-sm" /> : <ChevronDown className="icon-sm" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          label={t("More actions")}
          loading={pinning}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onMenu}
        >
          <MoreHorizontal className="icon-sm" />
        </Button>
      </div>
      {open && (
        <div id={detailsId} className={styles.details}>
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
      )}
    </div>
  );
}
