import { useContext } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { GitBranch } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import type { Block } from "../model/session";
import { TranscriptBranchContext } from "./transcriptBranchContext";

/** First row of a branched session: where it was cut from, with a way back to that reply. */
export function BranchOriginRow({
  origin,
  embedded = false,
}: {
  origin: NonNullable<Block["branchOrigin"]>;
  embedded?: boolean;
}) {
  const t = useT();
  const branch = useContext(TranscriptBranchContext);
  const label = t("Branched from {p0}", { p0: origin.title });
  return (
    <div className={`min-w-0 pbs-1 pbe-2 font-sans ${embedded ? "" : "px-4"}`} data-branch-origin>
      <Text
        as="div"
        size="body"
        tone="secondary"
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        <GitBranch className="icon-sm shrink-0" tone="muted" aria-hidden="true" />
        {branch ? (
          <Button
            motion="none"
            variant="ghost"
            type="button"
            className="min-w-0"
            onClick={() => branch.openSource(origin.sessionId, origin.blockId)}
          >
            <Text size="inherit" truncate>
              {label}
            </Text>
          </Button>
        ) : (
          <Text size="inherit" truncate className="min-w-0">
            {label}
          </Text>
        )}
      </Text>
    </div>
  );
}
