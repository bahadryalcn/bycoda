import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n/git";
import { GitBranch } from "../../../shared/ui/icons";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import { shortSha } from "../../../shared/lib/shortSha";
import type { GitDiffIndex } from "../../../platform/tauri/fs";
import type { Worktree } from "../model/worktrees";
import styles from "./CheckoutHeader.module.css";

type CheckoutSource = {
  index: Pick<GitDiffIndex, "branch" | "head"> | null;
  checkout?: Worktree;
};

/** The branch a checkout shows: the live index first, then the worktree listing. */
export function checkoutBranch({ index, checkout }: CheckoutSource): string | null | undefined {
  return index ? index.branch : checkout?.branch;
}

/** A folder identifies the checkout; its live branch follows on the same line, subordinate. */
export function CheckoutIdentity({
  name,
  checkout,
  index,
  showReference = true,
}: CheckoutSource & {
  name: string;
  showReference?: boolean;
}) {
  const branch = checkoutBranch({ index, checkout });
  const head = index ? index.head : checkout?.head;
  const reference = branch ?? (head ? `${t("Detached HEAD")} · ${shortSha(head)}` : undefined);
  const prefix = checkout ? `${t(checkout.isMain ? "Main worktree" : "Worktree")} · ` : "";
  return (
    <span className={styles.identity}>
      <Text
        size="caption"
        leading="inherit"
        tone="primary"
        weight="medium"
        truncate
        className={styles.name}
      >
        {name}
      </Text>
      {showReference && reference ? (
        <Text size="caption" leading="inherit" tone="secondary" className={styles.path}>
          <GitBranch aria-hidden className="icon-xs shrink-0" />
          <Text as="span" size="inherit" tone="inherit" className={styles.reference}>
            {prefix ? <span className="min-w-0 truncate">{prefix}</span> : null}
            {branch ? (
              // The branch keeps its discriminating end (e.g. `…-fix-login`) and shows the full name on clip.
              <MiddleTruncate className="min-w-0">{branch}</MiddleTruncate>
            ) : (
              <span className="min-w-0 truncate">{reference}</span>
            )}
          </Text>
        </Text>
      ) : null}
    </span>
  );
}
