import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
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
            <Text truncate className="min-w-0 flex-1">
              <Code size="inherit">{location}</Code>
            </Text>
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
          <Text size="caption" tone="secondary">
            {MOD}
            {t("↩ to add")}
          </Text>
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
