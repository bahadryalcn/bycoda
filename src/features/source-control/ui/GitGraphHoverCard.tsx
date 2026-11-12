import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
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
    <Text as="div" size="caption" tone="primary" className="space-y-2">
      <Text
        as="p"
        size="inherit"
        tone="inherit"
        weight="medium"
        leading="snug"
        className="break-words"
      >
        {commit.subject || commit.shortSha}
      </Text>
      <Text as="div" size="inherit" tone="secondary" className="flex items-center gap-2">
        <GraphAvatar name={commit.author} size={18} />
        <Text size="inherit" tone="inherit" truncate className="min-w-0">
          {commit.author || t("Unknown author")}
        </Text>
      </Text>
      <Text as="p" size="inherit" tone="secondary">
        {formatAbsoluteTime(commit.timestamp)} ({formatRelativeTime(commit.timestamp, Date.now())})
      </Text>
      <div className="flex items-center gap-1.5">
        <Code size="micro" tone="secondary">
          {commit.shortSha}
        </Code>
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
        <Text as="p" size="inherit" tone="secondary">
          {commit.parents.length > 1 ? t("Parents") : t("Parent")}{" "}
          <Code size="micro">{commit.parents.map((parent) => parent.slice(0, 7)).join(", ")}</Code>
        </Text>
      ) : null}
    </Text>
  );
}
