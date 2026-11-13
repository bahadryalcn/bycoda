import { ActionHost, actionContentAttributes } from "../../../shared/ui/ActionHost";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n/git";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DetailedInlineError } from "../../../shared/ui/ErrorDetails";
import { Heading } from "../../../shared/ui/Heading";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { FolderOpen, Trash2 } from "../../../shared/ui/icons";
import type { Worktree } from "../model/worktrees";
import styles from "./WorktreesPage.module.css";

/** One unmanaged worktree: same grammar as WorkspaceManagedRow (dot, identity, actions, details). */
export function WorktreeRow({
  tree,
  selected,
  sessionCount,
  identityHint,
  warning,
  revealError,
  deleteDisabledReason,
  removing = false,
  onReveal,
  onDelete,
}: {
  tree: Worktree;
  /** This worktree is the folder the page is showing. */
  selected: boolean;
  sessionCount: number;
  identityHint: string;
  /** Why deletion is unavailable here; shown as a warning under the caption. */
  warning?: string;
  revealError?: string;
  /** Why Delete is unavailable; omit when it is available. */
  deleteDisabledReason?: string;
  /** Deletion of this worktree runs in the background. */
  removing?: boolean;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const folderName = projectName(tree.path);
  const head = t("Detached at {p0}", { p0: tree.head.slice(0, 7) });
  const sessions = `${sessionCount}${t(" session")}${sessionCount === 1 ? "" : "s"}${t(" in this worktree")}`;
  const caption = [tree.branch ?? head, sessions].join(" · ");
  const statusTone =
    tree.missing || tree.dirty ? "warning" : tree.dirty == null ? "neutral" : "success";
  return (
    <ActionHost
      role="listitem"
      {...surfaceAttributes(
        { radius: "none", separator: "block" },
        `settings-collection-row ${styles.row}`,
      )}
    >
      <StatusDot
        tone={tree.missing ? "warning" : "secondary"}
        size="compact"
        className={styles.dot}
      />
      <div className={`settings-collection-main ${styles.identity}`}>
        <div className={styles.line}>
          <Tooltip label={identityHint} when={identityHint === folderName ? "overflow" : "always"}>
            <Heading size="item" leading="inherit" truncate className={styles.title}>
              {folderName}
            </Heading>
          </Tooltip>
          <Badge size="sm" tone={statusTone}>
            {tree.missing
              ? t("Missing folder")
              : tree.dirty == null
                ? t("Status unavailable")
                : tree.dirty
                  ? t("Uncommitted changes")
                  : t("Clean")}
          </Badge>
          {selected && (
            <Badge size="sm" tone="info">
              {t("Selected project folder")}
            </Badge>
          )}
          {!!tree.unpushed && (
            <Tooltip label={t("Counted against remote branches already fetched locally.")} asChild>
              <Badge size="sm" tone="info">
                {tree.unpushed}
                {t(" unpublished commit")}
                {tree.unpushed === 1 ? "" : "s"}
              </Badge>
            </Tooltip>
          )}
          {tree.unpushed == null && !tree.missing && (
            <Tooltip
              label={t(
                "Commits not on a remote could not be counted. Nothing was fetched or checked remotely.",
              )}
              asChild
            >
              <Badge size="sm" tone="neutral">
                {t("Publication unknown")}
              </Badge>
            </Tooltip>
          )}
          {removing && <Badge size="sm">{t("Removing directory…")}</Badge>}
          {tree.locked && (
            <Badge size="sm" tone="warning">
              {t("Locked")}
            </Badge>
          )}
        </div>
        <Tooltip label={caption} when="overflow">
          <Text size="caption" tone="muted" leading="inherit" truncate className={styles.caption}>
            {caption}
          </Text>
        </Tooltip>
        <Tooltip label={prettyCwd(tree.path)} when="overflow">
          <Text size="caption" tone="muted" leading="inherit" truncate className={styles.caption}>
            {prettyCwd(tree.path)}
          </Text>
        </Tooltip>
        {warning && <InlineMessage tone="warning">{warning}</InlineMessage>}
        {revealError && <DetailedInlineError error={revealError} retry={{ onRetry: onReveal }} />}
      </div>
      <div
        {...actionContentAttributes(
          { phase: "rest", hide: "dim" },
          `settings-collection-actions ${styles.rowActions}`,
        )}
      >
        <Button
          size="sm"
          iconOnly
          label={t("Reveal {p0}", { p0: tree.branch ?? "worktree" })}
          variant="ghost"
          motion="none"
          type="button"
          disabled={tree.missing}
          tooltip={t("Reveal folder")}
          onClick={onReveal}
        >
          <FolderOpen className="icon-sm" />
        </Button>
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          tone="danger"
          label={t("Delete {p0}", { p0: tree.branch ?? "worktree" })}
          disabled={!!deleteDisabledReason || removing}
          disabledReason={
            removing ? t("Deletion is running in the background.") : deleteDisabledReason
          }
          onClick={onDelete}
        >
          <Trash2 className="icon-sm" />
        </Button>
      </div>
    </ActionHost>
  );
}
