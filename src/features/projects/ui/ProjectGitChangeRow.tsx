import { DiffStat } from "../../../shared/ui/DiffStat";
import { Text } from "../../../shared/ui/Text";
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
    <Text
      as="div"
      size="secondary"
      tone="secondary"
      {...rest}
      className={["flex min-w-0 items-center gap-2 px-1", className].filter(Boolean).join(" ")}
    >
      <FileDiff className="icon-sm shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <Text size="inherit" tone="inherit" truncate className="min-w-0 tabular-nums">
        {files}
        {files && change.hasLines ? " · " : ""}
        <DiffStat additions={change.additions} deletions={change.deletions} />
      </Text>
    </Text>
  );
}
