import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { Block } from "../model/session";
import { approvalDetail } from "../model/approvalDetail";
import { useApprovalDecisionContext } from "./ApprovalDecisionContext";
import { useApprovalCardOnScreen } from "./approvalCardVisibility";
import { useApprovalDecisionControl } from "./useApprovalDecisionControl";

/**
 * Deny/Allow for the oldest pending tool approval, beside the dock's "Needs your input".
 * Hidden while the transcript's own approval card is on screen, so one decision has one place.
 */
export function DockApprovalActions({ blocks }: { blocks: Block[] }) {
  const context = useApprovalDecisionContext();
  const block = blocks.find((candidate) => candidate.approval && !candidate.approval.decided);
  if (!context || !block) return null;
  return <ConnectedDockApproval key={block.id} block={block} context={context} />;
}

function ConnectedDockApproval({
  block,
  context,
}: {
  block: Block;
  context: NonNullable<ReturnType<typeof useApprovalDecisionContext>>;
}) {
  const t = useT();
  const requestId = block.approval!.requestId;
  const onScreen = useApprovalCardOnScreen(context.session.id, requestId);
  const decision = useApprovalDecisionControl(context.session, requestId, context.dispatch, block);
  if (onScreen) return null;
  const reason = decision.feedback ?? undefined;
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-no-drag="" data-dock-approval="">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        motion="none"
        loading={decision.pending && decision.decision === "deny"}
        disabled={decision.blocked}
        tooltip={decision.blocked ? reason : undefined}
        onClick={() => void decision.decide("deny")}
      >
        {t("Deny")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        type="button"
        motion="none"
        loading={decision.pending && decision.decision === "allow"}
        disabled={decision.blocked}
        tooltip={decision.blocked ? reason : approvalDetail(block)}
        onClick={() => void decision.decide("allow")}
      >
        {t("Allow")}
      </Button>
    </div>
  );
}
