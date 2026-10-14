import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { Check, Copy } from "../../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { formatAbsoluteTime, formatRelativeTime, orderGraphRefs } from "../model/gitGraphDisplay";
import type { HistoryItemViewModel } from "../model/gitGraph";
import { GraphAvatar, RefPill } from "./GitGraphParts";

const CARD_WIDTH = 320;

/** Details of the hovered commit. Placement and dismissal belong to the list. */
export function GitGraphHoverCard({
  commit,
  row,
  anchor,
  side,
  onEnter,
  onLeave,
}: {
  commit: GitHistoryCommit;
  row: HistoryItemViewModel;
  anchor: PopoverAnchor;
  side: "right" | "bottom";
  onEnter: () => void;
  onLeave: () => void;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current != null) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const refs = useMemo(() => orderGraphRefs(row.refs, commit.head), [row.refs, commit.head]);

  const copy = () => {
    void navigator.clipboard.writeText(commit.sha).then(() => {
      setCopied(true);
      if (copiedTimer.current != null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <Popover
      anchor={anchor}
      side={side}
      align="start"
      gap={6}
      width={CARD_WIDTH}
      maxHeight={320}
      role="group"
      aria-label={t("Commit details")}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className="space-y-2 p-3 text-[12px] text-content"
    >
      <p className="font-medium leading-snug break-words">{commit.subject || commit.shortSha}</p>
      <div className="flex items-center gap-2 text-content/70">
        <GraphAvatar name={commit.author} size={18} />
        <span className="min-w-0 truncate">{commit.author || t("Unknown author")}</span>
      </div>
      <p className="text-content/55">
        {formatAbsoluteTime(commit.timestamp)} ({formatRelativeTime(commit.timestamp, Date.now())})
      </p>
      <div className="flex items-center gap-1.5">
        <code className="font-mono text-[11px] text-content/70">{commit.shortSha}</code>
        <button
          type="button"
          title={t("Copy commit ID")}
          aria-label={t("Copy commit ID")}
          onClick={copy}
          className="grid size-5 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
        >
          {copied ? (
            <Check className="size-3" strokeWidth={2} />
          ) : (
            <Copy className="size-3" strokeWidth={1.75} />
          )}
        </button>
      </div>
      {refs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {refs.map((ref) => (
            <RefPill key={`${ref.kind}:${ref.name}`} refInfo={ref} />
          ))}
        </div>
      ) : null}
      {commit.parents.length > 0 ? (
        <p className="text-content/55">
          {commit.parents.length > 1 ? t("Parents") : t("Parent")}{" "}
          <code className="font-mono text-[11px]">
            {commit.parents.map((parent) => parent.slice(0, 7)).join(", ")}
          </code>
        </p>
      ) : null}
    </Popover>
  );
}
