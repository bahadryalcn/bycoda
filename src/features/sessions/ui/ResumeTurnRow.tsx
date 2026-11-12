import { Text } from "../../../shared/ui/Text";
import { memo, useState } from "react";
import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import type { ResumePromptKind } from "../model/resumePrompt";
import type { Block } from "../model/session";

/**
 * The compact row for a turn the app sent to resume work. It stays collapsed
 * until the user opens it to read the prompt that was sent.
 */
export const ResumeTurnRow = memo(function ResumeTurnRow({
  block,
  kind,
  embedded = false,
}: {
  block: Block;
  kind: ResumePromptKind;
  embedded?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const summary =
    kind === "restart"
      ? t("{p0} restarted and resumed this turn", {
          p0: PRODUCT_IDENTITY.displayName,
        })
      : t("Resumed this turn");
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      data-prompt-anchor={block.id}
      data-resume-turn
      className={`${embedded ? "" : "px-4"} pbs-1.5 pbe-3 font-sans`}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        className="max-w-full"
        textTone="secondary"
        startIcon={<img src={PRODUCT_IDENTITY.smallLogoSrc} alt="" className="icon-sm shrink-0" />}
        endIcon={<Chevron className="icon-sm" aria-hidden />}
        onClick={() => setExpanded((open) => !open)}
      >
        {summary}
      </Button>
      {expanded ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          className="mt-1 ps-7 whitespace-pre-wrap break-words"
        >
          {block.text}
        </Text>
      ) : null}
    </div>
  );
});
