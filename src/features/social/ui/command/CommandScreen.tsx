import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Heading } from "../../../../shared/ui/Heading";
import { InlineError } from "../../../../shared/ui/InlineError";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
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
import { useCommandTarget } from "./useCommandTarget";
import { WaitingForYou } from "./WaitingForYou";
import "./command.css";

/**
 * Command: one sentence in, a visible plan out, the live activity below, and the owner's queue
 * on the side. The global AI stop lives in the shell bar, so it is not repeated here.
 */
export function CommandScreen({ client, machineId, projectId, active, target }: SocialScreenProps) {
  const state = useCommandScreen(client, projectId, active);
  const navigation = useCommandTarget(target, active, state.text, state.setText, state.scopeKey);
  const modelRequired = isModelRequired(state.error);
  const [humanCount, setHumanCount] = useState(0);
  const approvalCount = (state.actions ?? []).filter((item) => item.status === "queued").length;
  return (
    <div className="command-screen">
      <div className="command-top">
        {navigation.prompt ? (
          <InlineMessage
            tone="neutral"
            action={
              <>
                <Button
                  variant="link"
                  disabled={
                    state.text.length + navigation.prompt.length + (state.text.trim() ? 2 : 0) >
                    2000
                  }
                  onClick={navigation.apply}
                >
                  {t("Add to request")}
                </Button>
                <Button variant="link" onClick={navigation.dismiss}>
                  {t("Dismiss")}
                </Button>
              </>
            }
          >
            {navigation.prompt}
          </InlineMessage>
        ) : null}
        <CommandInput
          text={state.text}
          busy={!!state.busy}
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
              busy={!!state.busy}
              onApprove={state.approve}
              onRun={state.runPlan}
            />
          ) : null}
          <Heading size="section">{t("Activity")}</Heading>
          <ActivityFeed items={state.actions} onUndo={state.undo} />
          <CollectionFooter
            hasMore={!!state.next}
            loading={state.loadingMore}
            error={state.moreError ?? state.activityError}
            onLoadMore={() => {
              void state.loadMore().catch(() => undefined);
            }}
            onRetry={() => {
              void (state.moreError ? state.loadMore() : state.refresh()).catch(() => undefined);
            }}
          />
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
          <ReportPanel report={state.report} busy={!!state.busy} onLoad={state.loadReport} />
        </aside>
      </div>
    </div>
  );
}
