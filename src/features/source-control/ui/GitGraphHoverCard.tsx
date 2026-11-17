import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { t, useLocale } from "../../../shared/i18n/git";
import { useMemo } from "react";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { formatAbsoluteTime, formatRelativeTime, orderGraphRefs } from "../model/gitGraphDisplay";
import type { HistoryItemViewModel } from "../model/gitGraph";
import { GraphAvatar, RefPill } from "./GitGraphParts";

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
  const refs = useMemo(() => orderGraphRefs(row.refs, commit.head), [row.refs, commit.head]);

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
        <CopyButton
          motion="none"
          type="button"
          size="sm"
          iconOnly
          label={t("Copy commit ID")}
          text={commit.sha}
          resetKeys={[commit.sha]}
        />
      </div>
      {refs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {refs.map((ref) => (
            <RefPill key={`${ref.kind}:${ref.name}`} refInfo={ref} />
          ))}
        </div>
      ) : null}
      {commit.parents.length > 0 ? (
        <Text as="p" size="inherit" tone="secondary">
          {commit.parents.length > 1 ? t("Parents") : t("Parent")}{" "}
          <Code size="micro">{commit.parents.map((parent) => parent.slice(0, 7)).join(", ")}</Code>
        </Text>
      ) : null}
    </Text>
  );
}
