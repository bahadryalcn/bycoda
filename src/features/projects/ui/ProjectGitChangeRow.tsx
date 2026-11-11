import type { ComponentProps } from "react";
import { useT } from "../../../shared/i18n";
import { formatInteger } from "../../../shared/lib/numbers";
import { FileDiff } from "../../../shared/ui/icons";
import type { ProjectGitChange } from "./projectGitChange";

/**
 * One informational line for a menu: the Changes icon, the changed-file count and the line churn with the
 * same added/removed colors the project row uses. Reads as "3 files · +12 -4".
 */
export function ProjectGitChangeRow({
  change,
  className,
  ...rest
}: { change: ProjectGitChange } & ComponentProps<"div">) {
  const t = useT();
  const files =
    change.files > 0
      ? t(change.files === 1 ? "{p0} file" : "{p0} files", { p0: formatInteger(change.files) })
      : "";
  return (
    <div
      {...rest}
      className={[
        "flex min-w-0 items-center gap-2 px-1 text-ui-secondary text-(--ui-text-secondary)",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <FileDiff className="icon-sm shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 truncate tabular-nums">
        {files}
        {files && change.hasLines ? " · " : ""}
        {change.additions > 0 ? (
          <span className="text-diff-add-fg">+{formatInteger(change.additions)}</span>
        ) : null}
        {change.additions > 0 && change.deletions > 0 ? " " : ""}
        {change.deletions > 0 ? (
          <span className="text-diff-del-fg">-{formatInteger(change.deletions)}</span>
        ) : null}
      </span>
    </div>
  );
}
