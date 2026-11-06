import type { MouseEventHandler } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { FolderTree, GitBranch, MoreHorizontal } from "../../../shared/ui/icons";
import type { ManagedWorkspace } from "../model/contracts";
import { lifecycleLabel } from "../model/workspacePresentation";
import styles from "./WorkspacePolicySettings.module.css";

export function WorkspaceManagedRow({
  workspace,
  title,
  reviewDisabled,
  pinning,
  pinError,
  menuOpen,
  onReview,
  onMenu,
}: {
  workspace: ManagedWorkspace;
  title: string;
  reviewDisabled: boolean;
  pinning: boolean;
  pinError?: string;
  menuOpen: boolean;
  onReview: () => void;
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  const branch = workspace.branchRef.replace(/^refs\/heads\//, "");
  return (
    <div role="listitem" className={`settings-collection-row ${styles.workspaceRow}`}>
      <FolderTree aria-hidden className={styles.treeIcon} />
      <div className={`settings-collection-main ${styles.identity}`}>
        <div className={styles.workspaceHeading}>
          <Tooltip label={title} when="overflow">
            <span className={styles.workspaceTitle}>{title}</span>
          </Tooltip>
          <span className={styles.lifecycle}>
            <StatusDot tone={workspace.state === "active" ? "info" : "secondary"} size="compact" />
            {lifecycleLabel(workspace.state)}
          </span>
          {workspace.pinned && <Badge size="sm">{t("Pinned")}</Badge>}
          {workspace.directoryState === "blocked" && (
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
        </div>
        {title !== branch && (
          <p className={styles.branch}>
            <GitBranch aria-hidden className="icon-xs shrink-0" />
            <Tooltip label={branch} when="overflow">
              <span className={styles.ellipsis}>{branch}</span>
            </Tooltip>
          </p>
        )}
        <details className={styles.details}>
          <summary>{t("Details")}</summary>
          <dl className={styles.detailValues}>
            <dt>{t("Folder")}</dt>
            <dd>{workspace.path}</dd>
            <dt>{t("Branch")}</dt>
            <dd>{workspace.branchRef}</dd>
            <dt>{t("Workspace ID")}</dt>
            <dd>{workspace.id}</dd>
            <dt>{t("Owner")}</dt>
            <dd>
              {workspace.owner.kind} · {workspace.owner.id}
            </dd>
          </dl>
        </details>
        {pinError && <InlineError className="break-words">{pinError}</InlineError>}
      </div>
      <div className={`settings-collection-actions ${styles.rowActions}`}>
        <Button size="sm" disabled={reviewDisabled} onClick={onReview}>
          {t("Review changes")}
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
    </div>
  );
}
