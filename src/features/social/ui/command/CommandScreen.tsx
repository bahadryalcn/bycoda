import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { InlineError } from "../../../../shared/ui/InlineError";
import type { SocialScreenProps } from "../shell/screens";
import { NeedsHumanList } from "../browser/NeedsHumanList";
import { ActivityFeed } from "./ActivityFeed";
import { AiSetupCard } from "./AiSetupCard";
import { CommandInput } from "./CommandInput";
import { isModelRequired } from "./commandModel";
import { PlanSteps } from "./PlanSteps";
import { ReportPanel } from "./ReportPanel";
import { SummaryCards } from "./SummaryCards";
import { useCommandScreen } from "./useCommandScreen";
import { WaitingForYou } from "./WaitingForYou";
import "./command.css";

/**
 * Command: one sentence in, a visible plan out, the live activity below, and the owner's queue
 * on the side. The global AI stop lives in the shell bar, so it is not repeated here.
 */
export function CommandScreen({ client, machineId, projectId, active }: SocialScreenProps) {
  const state = useCommandScreen(client, projectId);
  const modelRequired = isModelRequired(state.error);
  const [humanCount, setHumanCount] = useState(0);
  const approvalCount = (state.actions ?? []).filter((item) => item.status === "queued").length;
  return (
    <div className="command-screen">
      <div className="command-top">
        <CommandInput
          text={state.text}
          busy={state.busy === "plan"}
          onChange={state.setText}
          onSubmit={state.submit}
        />
      </div>
      {modelRequired ? (
        <AiSetupCard busy={state.busy === "model"} onSave={state.saveModel} />
      ) : null}
      {state.error && !modelRequired ? <InlineError>{state.error}</InlineError> : null}
      <SummaryCards summary={state.summary} approvalCount={approvalCount} />
      <div className="command-layout">
        <div className="command-main">
          {state.plan ? (
            <PlanSteps
              plan={state.plan}
              results={state.results}
              approved={state.approved}
              busy={state.busy === "run"}
              onApprove={state.approve}
              onRun={state.runPlan}
            />
          ) : null}
          <h3 className="command-section-title">{t("Activity")}</h3>
          <ActivityFeed items={state.actions} onUndo={state.undo} />
        </div>
        <aside className="command-side">
          <WaitingForYou approvalCount={approvalCount} humanCount={humanCount}>
            <NeedsHumanList
              client={client}
              machineId={machineId}
              active={active}
              onCountChange={setHumanCount}
            />
          </WaitingForYou>
          <ReportPanel
            report={state.report}
            busy={state.busy === "report"}
            onLoad={state.loadReport}
          />
        </aside>
      </div>
    </div>
  );
}
