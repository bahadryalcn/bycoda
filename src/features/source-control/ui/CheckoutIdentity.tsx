import { t } from "../../../shared/i18n/git";
import type { GitDiffIndex } from "../../../platform/tauri/fs";
import type { Worktree } from "../model/worktrees";
import styles from "./CheckoutHeader.module.css";

/** A folder identifies the checkout; its live branch remains subordinate. */
export function CheckoutIdentity({
  cwd,
  name,
  checkout,
  index,
  showReference = true,
}: {
  cwd: string;
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
      <span className={styles.name}>{name}</span>
      {showReference && reference ? (
        <span className={styles.path} title={cwd}>
          {checkout ? `${t(checkout.isMain ? "Main working copy" : "Worktree")} · ` : ""}
          {reference}
        </span>
      ) : null}
    </span>
  );
}
