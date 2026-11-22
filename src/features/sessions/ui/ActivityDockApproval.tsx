import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import type { Block } from "../model/session";
import { approvalDetail } from "../model/approvalDetail";
import { approvalSummary } from "./approvalPresentation";
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
  const full = approvalDetail(block);
  const summary = approvalSummary(block);
  return (
    <div className="flex min-w-0 items-center gap-1.5" data-no-drag="" data-dock-approval="">
      <Text
        size="caption"
        tone="secondary"
        truncate
        className="max-w-48 min-w-0 font-mono"
        data-dock-approval-summary=""
      >
        {summary}
      </Text>
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
        tooltip={decision.blocked ? reason : full === summary ? undefined : full}
        onClick={() => void decision.decide("allow")}
      >
        {t("Allow")}
      </Button>
    </div>
  );
}
