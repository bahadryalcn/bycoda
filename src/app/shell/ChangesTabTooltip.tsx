import type { ReactNode } from "react";
import type { BoundFormat, t } from "../../shared/i18n";
import { Badge } from "../../shared/ui/Badge";
import { DiffStat } from "../../shared/ui/DiffStat";
import { GitBranch } from "../../shared/ui/icons";
import { Text } from "../../shared/ui/Text";

/** The checkout the Changes tab totals follow, split for display. */
export type ChangeScope = {
  title: string;
  folder?: string;
  /** `title` is a branch name. */
  branch?: boolean;
  /** The checkout belongs to the open session. */
  session?: boolean;
};

/**
 * Detail lines of the Changes tab tooltip: the checkout (branch, folder, session mark) or the
 * project path, then the file count and coloured line churn.
 */
export function changesTooltipDetails({
  scope,
  path,
  files,
  additions,
  deletions,
  translate,
  format,
}: {
  scope: ChangeScope | null;
  /** Shown instead of `scope` when the tab follows a project root rather than a checkout. */
  path?: string;
  files: number;
  additions: number;
  deletions: number;
  translate: typeof t;
  format: BoundFormat;
}): ReactNode[] {
  const lines: ReactNode[] = [];
  if (path)
    lines.push(
      <Text wrap="anywhere" size="inherit" tone="inherit">
        {path}
      </Text>,
    );
  else if (scope)
    lines.push(
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {scope.branch ? <GitBranch aria-hidden className="icon-xs shrink-0" /> : null}
        <Text wrap="anywhere" size="inherit" tone="primary" weight="medium">
          {scope.title}
        </Text>
        {scope.folder && scope.folder !== scope.title ? (
          <Text wrap="anywhere" size="inherit" tone="inherit">
            {scope.folder}
          </Text>
        ) : null}
        {scope.session ? (
          <Badge size="xs" tone="accent" appearance="subtle" className="shrink-0">
            {translate("This session")}
          </Badge>
        ) : null}
      </span>,
    );
  if (files > 0 || additions > 0 || deletions > 0)
    lines.push(
      <span className="flex flex-wrap items-center gap-2 tabular-nums">
        {files > 0 ? (
          <span className="whitespace-nowrap">
            {translate(files === 1 ? "{p0} file" : "{p0} files", {
              p0: format.formatNumber(files, { maximumFractionDigits: 0 }),
            })}
          </span>
        ) : null}
        <DiffStat additions={additions} deletions={deletions} weight="medium" />
      </span>,
    );
  return lines;
}
