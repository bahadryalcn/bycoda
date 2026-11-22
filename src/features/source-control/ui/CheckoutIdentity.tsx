import { Badge } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n/git";
import { useFormat } from "../../../shared/i18n";
import { FolderGit2, GitBranch } from "../../../shared/ui/icons";
import { MiddleTruncate } from "../../../shared/ui/MiddleTruncate";
import type { GitDiffIndex } from "../../../platform/tauri/fs";
import type { Worktree } from "../model/worktrees";
import { AheadBehindCount } from "./AheadBehindCount";
import styles from "./CheckoutHeader.module.css";

type CheckoutSource = {
  index: Pick<GitDiffIndex, "branch" | "head"> | null;
  checkout?: Worktree;
};

/** The branch a checkout shows: the live index first, then the worktree listing. */
export function checkoutBranch({ index, checkout }: CheckoutSource): string | null | undefined {
  return index ? index.branch : checkout?.branch;
}

/**
 * The one row format of a worktree or repository: a single leading icon (branch for worktrees,
 * repository for separate repositories), the bold title, then muted folder or branch and an
 * optional muted marker. Paths never show here; they belong in the row's tooltip.
 */
export function CheckoutIdentity({
  title,
  detail,
  marker,
  repository = false,
  icon = true,
}: {
  /** False when the host row (a picker option) already draws the leading icon. */
  icon?: boolean;
  title: string;
  /** Muted text after the title, end-truncated. */
  detail?: string;
  /** Muted marker after the detail, such as "This session". */
  marker?: string;
  /** A separate repository rather than a worktree. */
  repository?: boolean;
}) {
  const Icon = repository ? FolderGit2 : GitBranch;
  return (
    <span className={styles.identity}>
      {icon ? <Icon aria-hidden className="icon-xs shrink-0" tone="secondary" /> : null}
      <Text size="caption" leading="inherit" tone="primary" weight="medium" className={styles.name}>
        {/* The branch keeps its discriminating end (e.g. `…-fix-login`) and shows the full name on clip. */}
        <MiddleTruncate className="min-w-0">{title}</MiddleTruncate>
      </Text>
      {detail ? (
        <Text size="caption" leading="inherit" tone="secondary" truncate className={styles.path}>
          {detail}
        </Text>
      ) : null}
      {marker ? (
        <Text size="caption" leading="inherit" tone="secondary" className={styles.marker}>
          {marker}
        </Text>
      ) : null}
    </span>
  );
}

/**
 * Change chip (a dot with the count when known) and muted sync arrows, in the order every row
 * and header shows them. `changes` is the file count when Git was read; `dirty` alone shows
 * the dot for a row built from the worktree record.
 */
export function CheckoutStatus({
  changes,
  dirty,
  ahead = 0,
  behind = 0,
}: {
  changes?: number;
  dirty?: boolean | null;
  ahead?: number;
  behind?: number;
}) {
  const format = useFormat();
  const count = changes ?? 0;
  return (
    <span className={styles.summary}>
      {count > 0 ? (
        <Badge
          size="xs"
          variant="dot"
          tone="warning"
          appearance="subtle"
          label={`${t("Changes")}: ${format.formatNumber(count)}`}
        >
          {format.formatNumber(count)}
        </Badge>
      ) : changes === undefined && dirty ? (
        <Badge size="xs" variant="dot" tone="warning" label={t("Changes")} />
      ) : null}
      <AheadBehindCount ahead={ahead} behind={behind} hideZero />
    </span>
  );
}
