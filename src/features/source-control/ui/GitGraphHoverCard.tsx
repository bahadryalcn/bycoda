import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo } from "react";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { Check, Copy } from "../../../shared/ui/icons";
import { InlineError } from "../../../shared/ui/InlineError";
import { formatAbsoluteTime, formatRelativeTime, orderGraphRefs } from "../model/gitGraphDisplay";
import type { HistoryItemViewModel } from "../model/gitGraph";
import { GraphAvatar, RefPill } from "./GitGraphParts";
import { copyText } from "../../../platform/tauri/clipboard";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";

/**
 * Details of the hovered commit, the content of the row's shared `HoverCard` (see GitGraphList):
 * placement, hover intent and dismissal belong to the card.
 */
export function GitGraphHoverCard({
  commit,
  row,
}: {
  commit: GitHistoryCommit;
  row: HistoryItemViewModel;
}) {
  useLocale();
  // The card can be reused for another commit; its outcome and any copy in flight belong to one SHA.
  const {
    copy: runCopy,
    copied,
    error: copyError,
  } = useCopyFeedback({
    resetKeys: [commit.sha],
    successMs: 1200,
  });
  const refs = useMemo(() => orderGraphRefs(row.refs, commit.head), [row.refs, commit.head]);

  const copy = () => {
    runCopy(() => copyText(commit.sha));
  };

  return (
    <div className="space-y-2">
      <p className="font-medium leading-snug break-words">{commit.subject || commit.shortSha}</p>
      <div className="flex items-center gap-2 text-(--ui-text-secondary)">
        <GraphAvatar name={commit.author} size={18} />
        <span className="min-w-0 truncate">{commit.author || t("Unknown author")}</span>
      </div>
      <p className="text-(--ui-text-secondary)">
        {formatAbsoluteTime(commit.timestamp)} ({formatRelativeTime(commit.timestamp, Date.now())})
      </p>
      <div className="flex items-center gap-1.5">
        <code className="font-mono text-ui-micro text-(--ui-text-secondary)">
          {commit.shortSha}
        </code>
        <Button
          variant="ghost"
          motion="none"
          type="button"
          size="sm"
          iconOnly
          label={t("Copy commit ID")}
          onClick={copy}
        >
          {copied ? (
            <Check className="icon-xs" strokeWidth={2} />
          ) : (
            <Copy className="icon-xs" strokeWidth={1.75} />
          )}
        </Button>
      </div>
      {refs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {refs.map((ref) => (
            <RefPill key={`${ref.kind}:${ref.name}`} refInfo={ref} />
          ))}
        </div>
      ) : null}
      {copyError ? <InlineError>{copyError}</InlineError> : null}
      {commit.parents.length > 0 ? (
        <p className="text-(--ui-text-secondary)">
          {commit.parents.length > 1 ? t("Parents") : t("Parent")}{" "}
          <code className="font-mono text-ui-micro">
            {commit.parents.map((parent) => parent.slice(0, 7)).join(", ")}
          </code>
        </p>
      ) : null}
    </div>
  );
}
