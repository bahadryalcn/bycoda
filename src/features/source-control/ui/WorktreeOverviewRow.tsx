import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { worktreeRowFolder, worktreeRowTitle } from "../model/worktreeRows";
import type { Worktree } from "../model/worktrees";
import { CheckoutIdentity, CheckoutStatus } from "./CheckoutIdentity";
import styles from "./CheckoutHeader.module.css";

/**
 * A worktree row of the All-worktrees overview while it is collapsed. It is drawn from the
 * worktree record alone (title, folder, dirty, unpushed), so a collapsed row reads no Git state and
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
        // The row already shows branch and folder; the hint adds where it lives.
        tooltip={tree.path}
        className={styles.disclosure}
      >
        <CheckoutIdentity
          title={worktreeRowTitle(tree)}
          detail={worktreeRowFolder(tree)}
          marker={current ? t("This session") : undefined}
        />
      </Button>
      <CheckoutStatus dirty={tree.dirty} ahead={tree.unpushed ?? 0} />
    </Text>
  );
}
