import { useId, useState, type MouseEventHandler } from "react";
import { t } from "../../../shared/i18n/git";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { ChevronDown, ChevronUp, FolderOpen, MoreHorizontal } from "../../../shared/ui/icons";
import type { Worktree } from "../model/worktrees";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import styles from "./WorktreesPage.module.css";

/** One unmanaged worktree: same grammar as WorkspaceManagedRow (dot, identity, actions, details). */
export function WorktreeRow({
  tree,
  selected,
  sessionCount,
  identityHint,
  warning,
  revealError,
  menuOpen,
  onReveal,
  onMenu,
}: {
  tree: Worktree;
  /** This worktree is the folder the page is showing. */
  selected: boolean;
  sessionCount: number;
  identityHint: string;
  /** Why deletion is unavailable here; shown as a warning under the caption. */
  warning?: string;
  revealError?: string;
  menuOpen: boolean;
  onReveal: () => void;
  onMenu: MouseEventHandler<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const folderName = projectName(tree.path);
  const head = t("Detached at {p0}", { p0: tree.head.slice(0, 7) });
  const sessions = `${sessionCount}${t(" session")}${sessionCount === 1 ? "" : "s"}${t(" in this worktree")}`;
  const caption = [tree.branch ?? head, sessions].join(" · ");
  const statusTone =
    tree.missing || tree.dirty ? "warning" : tree.dirty == null ? "neutral" : "success";
  return (
    <div
      role="listitem"
      className={`settings-collection-row ${styles.row}`}
      data-open={open || undefined}
    >
      <StatusDot
        tone={tree.missing ? "warning" : "secondary"}
        size="compact"
        className={styles.dot}
      />
      <div className={`settings-collection-main ${styles.identity}`}>
        <div className={styles.line}>
          <Tooltip label={identityHint} when={identityHint === folderName ? "overflow" : "always"}>
            <span className={styles.title}>{folderName}</span>
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
            <Badge
              size="sm"
              tone="info"
              title={t("Counted against remote branches already fetched locally.")}
            >
              {tree.unpushed}
              {t(" unpublished commit")}
              {tree.unpushed === 1 ? "" : "s"}
            </Badge>
          )}
          {tree.unpushed == null && !tree.missing && (
            <Badge
              size="sm"
              tone="neutral"
              title={t(
                "Commits not on a remote could not be counted. Nothing was fetched or checked remotely.",
              )}
            >
              {t("Publication unknown")}
            </Badge>
          )}
          {tree.locked && (
            <Badge size="sm" tone="warning">
              {t("Locked")}
            </Badge>
          )}
        </div>
        <Tooltip label={caption} when="overflow">
          <span className={styles.caption}>{caption}</span>
        </Tooltip>
        {warning && <InlineMessage tone="warning">{warning}</InlineMessage>}
        {revealError && <InlineError retry={{ onRetry: onReveal }}>{revealError}</InlineError>}
      </div>
      <div className={`settings-collection-actions ${styles.rowActions}`}>
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
          label={t("Details")}
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp className="icon-sm" /> : <ChevronDown className="icon-sm" />}
        </Button>
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          label={t("Actions for {p0}", { p0: tree.branch ?? "worktree" })}
          tooltip={t("More actions")}
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
              {prettyCwd(tree.path)}
            </DescriptionItem>
            <DescriptionItem term={t("Branch")} monospace>
              {tree.branch ?? head}
            </DescriptionItem>
          </DescriptionList>
        </div>
      )}
    </div>
  );
}
