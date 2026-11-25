import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import { ChevronRight } from "../../../shared/ui/icons";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

/**
 * The "from → to" route shared by every handoff surface (composer card and
 * transcript card). It inherits the text size and tone of the line it sits in,
 * so each surface still chooses its own typography while the icons, chevron
 * and spacing stay identical.
 */
export function HarnessRoute({ from, to }: { from: HarnessId; to: HarnessId }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <HarnessIcon harness={from} className="icon-sm shrink-0" />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {HARNESS_TITLE[from]}
      </Text>
      <ChevronRight className="icon-sm shrink-0" tone="secondary" aria-hidden />
      <HarnessIcon harness={to} className="icon-sm shrink-0" />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {HARNESS_TITLE[to]}
      </Text>
    </span>
  );
}

/** "1 file" / "N files" for a handoff, or nothing when no file count is known. */
export function HandoffFileCount({ files, className }: { files?: number; className?: string }) {
  const t = useT();
  if (files == null || files <= 0) return null;
  return (
    <Text as="div" size="micro" tone="secondary" className={className}>
      {files === 1 ? t("{p0} file", { p0: files }) : t("{p0} files", { p0: files })}
    </Text>
  );
}
