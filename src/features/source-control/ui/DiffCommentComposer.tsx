import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n/git";
import { useState } from "react";
import { MessageSquarePlus, X } from "../../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import { diffCommentLocation, formatDiffComment } from "../model/diffComment";
import { MOD } from "../../../platform/tauri/platform";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import type { UnifiedLine } from "../model/unifiedDiff";

export type DiffCommentComposerTarget = {
  line: UnifiedLine;
  anchor: PopoverAnchor;
};

export function DiffCommentComposer({
  path,
  target,
  onDismiss,
}: {
  path: string;
  target: DiffCommentComposerTarget;
  onDismiss: () => void;
}) {
  useLocale();
  const [comment, setComment] = useState("");
  const location = diffCommentLocation({ path, line: target.line });
  const addToChat = () => {
    const text = formatDiffComment({ path, line: target.line }, comment);
    if (!text) return;
    requestAddToChat(text, "plain");
    onDismiss();
  };

  return (
    <Popover
      anchor={target.anchor}
      side="right"
      align="start"
      gap={6}
      width={320}
      onDismiss={onDismiss}
      role="dialog"
      aria-label={t("Comment on {p0}", { p0: location })}
      className="p-2"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          addToChat();
        }}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <OverflowTooltip label={location}>
            <span className="min-w-0 flex-1 truncate font-mono text-ui-caption text-(--ui-text-secondary)">
              {location}
            </span>
          </OverflowTooltip>
          <Button
            size="sm"
            iconOnly
            label={t("Cancel comment")}
            variant="ghost"
            motion="none"
            type="button"
            onClick={onDismiss}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        </div>
        <TextareaField
          hideLabel
          label=""
          autoFocus
          minRows={3}
          maxRows={8}
          autosize
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && comment.trim()) {
              event.preventDefault();
              addToChat();
            }
          }}
          placeholder={t("Leave a comment…")}
          className="w-full"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-ui-caption text-(--ui-text-secondary)">
            {MOD}
            {t("↩ to add")}
          </span>
          <Button
            size="sm"
            variant="primary"
            motion="none"
            type="submit"
            disabled={!comment.trim()}
            className="inline-flex items-center gap-1.5 disabled:cursor-default"
          >
            <MessageSquarePlus className="icon-sm" strokeWidth={1.75} />
            {t("Add to chat")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
