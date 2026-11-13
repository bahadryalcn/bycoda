import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n/git";
import { GitBranch } from "../../../shared/ui/icons";
import type { GitDiffIndex } from "../../../platform/tauri/fs";
import type { Worktree } from "../model/worktrees";
import styles from "./CheckoutHeader.module.css";

/** A folder identifies the checkout; its live branch follows on the same line, subordinate. */
export function CheckoutIdentity({
  name,
  checkout,
  index,
  showReference = true,
}: {
  name: string;
  checkout?: Worktree;
  index: Pick<GitDiffIndex, "branch" | "head"> | null;
  showReference?: boolean;
}) {
  const branch = index ? index.branch : checkout?.branch;
  const head = index ? index.head : checkout?.head;
  const reference = branch ?? (head ? `${t("Detached")} · ${head.slice(0, 7)}` : undefined);
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
          <Text as="span" size="inherit" tone="inherit" truncate className={styles.reference}>
            {checkout ? `${t(checkout.isMain ? "Main working copy" : "Worktree")} · ` : ""}
            {reference}
          </Text>
        </Text>
      ) : null}
    </span>
  );
}
