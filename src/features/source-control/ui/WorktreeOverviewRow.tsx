import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { FolderTree, GitBranch } from "../../../shared/ui/icons";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { t, useLocale } from "../../../shared/i18n/git";
import { worktreeRowDetail, worktreeRowTitle } from "../model/worktreeRows";
import type { Worktree } from "../model/worktrees";
import { AheadBehindCount } from "./AheadBehindCount";
import styles from "./CheckoutHeader.module.css";

/**
 * A worktree row of the All-worktrees overview while it is collapsed. It is drawn from the
 * worktree record alone (title, path, dirty, unpushed), so a collapsed row reads no Git state and
 * mounts no changes panel; expanding it swaps in the full panel.
 */
export function CollapsedWorktreeRow({
  tree,
  current,
  onExpand,
}: {
  tree: Worktree;
  current: boolean;
  onExpand: () => void;
}) {
  useLocale();
  const title = worktreeRowTitle(tree);
  const Icon = tree.isMain ? GitBranch : FolderTree;
  return (
    <Text
      as="header"
      size="inherit"
      tone="primary"
      className={styles.header}
      data-worktree-row={tree.path}
      data-current-checkout={current || undefined}
    >
      <Button
        size="sm"
        variant="item"
        motion="none"
        expanded={false}
        chevron="start"
        onClick={onExpand}
        tooltip={`${title} · ${tree.path}`}
        className={styles.disclosure}
      >
        <span className={styles.identity}>
          <Icon aria-hidden className="icon-xs shrink-0" tone="secondary" />
          <Text
            size="caption"
            leading="inherit"
            tone="primary"
            weight="medium"
            className={styles.name}
          >
            <MiddleTruncate className="min-w-0">{title}</MiddleTruncate>
          </Text>
          <Text size="caption" leading="inherit" tone="secondary" truncate className={styles.path}>
            {worktreeRowDetail(tree)}
          </Text>
        </span>
        {current ? (
          <Text size="caption" leading="inherit" tone="accent" className={styles.current}>
            {t("Current")}
          </Text>
        ) : null}
      </Button>
      <span className={styles.summary}>
        {tree.dirty ? (
          <Badge size="xs" appearance="subtle">
            {t("Changes")}
          </Badge>
        ) : null}
        <AheadBehindCount ahead={tree.unpushed ?? 0} behind={0} hideZero />
      </span>
    </Text>
  );
}
