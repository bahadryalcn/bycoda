import { useMemo, useState, type ReactNode } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { t, useLocale } from "../../../shared/i18n";
import type { GithubPrDiff } from "../model/githubTasks";
import { mergePrDiff, parsePrPatch, type PrDiffFile } from "../../source-control/model/prDiff";
import { blocksFromLines, type UnifiedLine } from "../../source-control/model/unifiedDiff";
import {
  UnifiedDiffView,
  type UnifiedDiffFileModel,
} from "../../source-control/ui/UnifiedDiffView";

type Props = {
  diff: GithubPrDiff;
  /** When true, show the whole file (no fold rows). */
  fullFile?: boolean;
  focusPath?: string;
  /** Provider context controls belong to the Code area, not the PR tabs. */
  contextControl?: ReactNode;
};

export function InboxPrDiff({ diff, fullFile = false, focusPath, contextControl }: Props) {
  useLocale();
  const [picked, setPicked] = useState<{ path: string; request: number } | null>(null);
  const files = useMemo(() => {
    const parsed = mergePrDiff(diff.files, parsePrPatch(diff.patch));
    const context = fullFile ? Number.POSITIVE_INFINITY : undefined;
    return parsed.map((file) => toModel(file, diff.truncated, context, diff.headOid));
  }, [diff, fullFile]);
  const selectedPath =
    picked && files.some((file) => file.path === picked.path) ? picked.path : focusPath;
  // A Summary selection is authoritative when the parent asks to reveal a file.
  const [previousFocus, setPreviousFocus] = useState(focusPath);
  if (previousFocus !== focusPath) {
    setPreviousFocus(focusPath);
    setPicked(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-inbox-code>
      {contextControl || files.length > 6 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" aria-label={t("Code")}>
          {contextControl}
          {files.length > 6 ? (
            <div className="min-w-0 flex-1 basis-56">
              <SearchableSelect
                label={t("Changed files")}
                placeholder={t("Choose a file…")}
                searchPlaceholder={t("Search files…")}
                value={selectedPath ?? ""}
                onChange={(path) =>
                  setPicked((previous) => ({ path, request: (previous?.request ?? 0) + 1 }))
                }
                options={files.map((file) => ({
                  value: file.path,
                  label: file.label ?? file.path,
                  keywords: file.path,
                  description: `+${file.additions} −${file.deletions}`,
                }))}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <UnifiedDiffView
        files={files}
        truncated={diff.truncated}
        totals={{ additions: diff.additions, deletions: diff.deletions }}
        fill={false}
        fileLayout="cards"
        initialExpansion="first"
        focusPath={selectedPath}
        focusRequest={picked?.request}
      />
    </div>
  );
}

function toModel(
  file: PrDiffFile,
  truncated: boolean,
  context?: number,
  revision?: string,
): UnifiedDiffFileModel {
  const lines = file.lines.map(toUnifiedLine);
  return {
    id: file.path,
    path: file.path,
    label:
      file.status === "renamed" && file.previousPath
        ? `${file.previousPath} → ${file.path}`
        : file.path,
    binary: file.binary,
    emptyMessage:
      !file.binary && file.lines.length === 0
        ? truncated
          ? "Patch unavailable because this change is too large"
          : "No textual diff"
        : undefined,
    additions: file.additions,
    deletions: file.deletions,
    // File identity preserves expansion while fold reveals are bound to the
    // actual revision and line range, rather than a reused ordinal alone.
    blocks: blocksFromLines(lines, context).map((block) =>
      block.kind === "fold"
        ? {
            ...block,
            id: JSON.stringify([
              revision,
              block.id,
              block.lines[0]?.oldNumber,
              block.lines[0]?.newNumber,
              block.lines[block.lines.length - 1]?.oldNumber,
              block.lines[block.lines.length - 1]?.newNumber,
            ]),
          }
        : block,
    ),
  };
}

function toUnifiedLine(line: PrDiffFile["lines"][number]): UnifiedLine {
  return {
    kind: line.kind,
    text: line.text,
    oldNumber: line.oldNumber,
    newNumber: line.newNumber,
  };
}
