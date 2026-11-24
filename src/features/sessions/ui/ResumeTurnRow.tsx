import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { memo } from "react";
import { useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { BrandMark } from "../../../shared/ui/BrandMark";
import { Disclosure } from "../../../shared/ui/Disclosure";
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
  const summary =
    kind === "restart"
      ? t("{p0} restarted and resumed this turn", {
          p0: PRODUCT_IDENTITY.displayName,
        })
      : t("Resumed this turn");
  return (
    <div
      data-prompt-anchor={block.id}
      data-resume-turn
      className={`${embedded ? "" : "px-4"} pbs-1 pbe-2 font-sans`}
    >
      <Disclosure
        variant="step"
        chevron="end"
        tone="secondary"
        summary={
          <>
            <BrandMark variant="smallMark" className="icon-sm shrink-0" />
            {summary}
          </>
        }
        className="max-w-full"
      >
        <Text
          as="p"
          size="caption"
          tone="secondary"
          {...surfaceAttributes(
            { frame: "pane", edge: "left" },
            "ms-1.5 mt-1 ps-4 whitespace-pre-wrap break-words",
          )}
        >
          {block.text}
        </Text>
      </Disclosure>
    </div>
  );
});
