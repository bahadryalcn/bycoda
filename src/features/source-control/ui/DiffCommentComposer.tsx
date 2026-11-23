import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { t, useLocale } from "../../../shared/i18n/git";
import { useState } from "react";
import { MessageSquarePlus, X } from "../../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import {
  diffCommentLocation,
  formatDiffComment,
  readDiffCommentDraft,
  writeDiffCommentDraft,
} from "../model/diffComment";
import { requestAddToChat } from "../../sessions/public/quoteDraft";
import type { UnifiedLine } from "../model/unifiedDiff";

export type DiffCommentComposerTarget = {
  line: UnifiedLine;
  anchor: PopoverAnchor;
};

type DiffCommentComposerProps = {
  path: string;
  target: DiffCommentComposerTarget;
  onDismiss: () => void;
};

export function DiffCommentComposer(props: DiffCommentComposerProps) {
  // Keyed by line so a draft never follows the composer onto another line.
  const { path, target } = props;
  return (
    <DiffCommentComposerBody
      key={`${target.line.kind}\0${diffCommentLocation({ path, line: target.line })}`}
      {...props}
    />
  );
}

function DiffCommentComposerBody({ path, target, onDismiss }: DiffCommentComposerProps) {
  useLocale();
  const draftTarget = { path, line: target.line };
  const [comment, setComment] = useState(() => readDiffCommentDraft(draftTarget));
  const location = diffCommentLocation(draftTarget);
  const updateComment = (next: string) => {
    setComment(next);
    writeDiffCommentDraft(draftTarget, next);
  };
  const discard = () => {
    writeDiffCommentDraft(draftTarget, "");
    onDismiss();
  };
  const addToChat = () => {
    const text = formatDiffComment(draftTarget, comment);
    if (!text) return;
    requestAddToChat(text, "plain");
    discard();
  };

  return (
    <Popover
      anchor={target.anchor}
      side="right"
      align="start"
      gap={6}
      width={320}
      // An outside press keeps unsent text; Escape and Cancel discard it.
      onDismiss={(reason) => {
        if (reason === "outside" && comment.trim()) return;
        discard();
      }}
      kind="dialog"
      aria-label={t("Comment on {p0}", { p0: location })}
      variant="compact"
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
            onClick={discard}
          >
            <X className="icon-xs" strokeWidth={1.75} />
          </Button>
        </div>
        <TextareaField
          hideLabel
          label={t("Comment")}
          autoFocus
          minRows={3}
          maxRows={8}
          autosize
          value={comment}
          onChange={(event) => updateComment(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && comment.trim()) {
              event.preventDefault();
              addToChat();
            }
          }}
          placeholder={t("Leave a comment…")}
          className="w-full"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            motion="none"
            type="submit"
            shortcut="Mod+Enter"
            disabled={!comment.trim()}
            startIcon={<MessageSquarePlus className="icon-sm" strokeWidth={1.75} />}
          >
            {t("Add to chat")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
