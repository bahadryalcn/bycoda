import { useSyncExternalStore, type ReactNode } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { RUNTIME_MODE_LABEL } from "../../sessions/model/session";
import { automationScheduleLabel } from "../model/automations";
import { dateTimeFormat, useT } from "../../../shared/i18n";
import {
  automationProposalSnapshot,
  subscribeAutomationProposal,
  closeAutomationProposal,
  saveAutomationProposal,
} from "../model/automationProposalStore";

/** One read-only fact of the proposal: a plain label and its value, not a disabled input. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt>
        <Text size="caption" tone="muted" weight="medium">
          {label}
        </Text>
      </dt>
      <dd className="m-0 min-w-0">
        <Text size="body" tone="primary" className="break-words">
          {children}
        </Text>
      </dd>
    </div>
  );
}

/** A concrete owner confirmation; preparing or cancelling never creates an automation. */
export function AutomationProposalDialog() {
  const state = useSyncExternalStore(subscribeAutomationProposal, automationProposalSnapshot);
  const t = useT();
  if (!state) return null;
  const proposal = state.proposal;
  const busy = state.status === "saving";
  const saved = state.status === "saved";
  const execution = state.saveInput ?? state.session;
  return (
    <Modal
      title={t("Automation")}
      onClose={closeAutomationProposal}
      closeDisabled={busy}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={busy} onClick={closeAutomationProposal}>
            {saved ? t("Close") : t("Cancel")}
          </Button>
          {proposal && !saved ? (
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                void saveAutomationProposal();
              }}
            >
              {t("Create")}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="flex flex-col gap-3">
        {state.status === "preparing" ? <Text>{t("Preparing…")}</Text> : null}
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {saved ? <Alert tone="success">{t("Saved")}</Alert> : null}
        {proposal ? (
          <dl className="flex min-w-0 flex-col gap-3">
            <Fact label={t("Name")}>{proposal.name}</Fact>
            <Fact label={t("Instructions")}>
              <span className="block max-h-40 overflow-y-auto whitespace-pre-wrap">
                {proposal.instruction}
              </span>
            </Fact>
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
              <Fact label={t("Host")}>{state.machine?.name ?? ""}</Fact>
              <Fact label={t("Project")}>{state.session.cwd}</Fact>
              <Fact label={t("Schedule")}>{automationScheduleLabel(proposal.schedule)}</Fact>
              <Fact label={t("Time zone")}>{proposal.preview.timeZone}</Fact>
              <Fact label={t("Next run")}>
                {dateTimeFormat(undefined, {
                  timeZone: proposal.preview.timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(state.saved?.nextRunAt ?? proposal.preview.nextRunAt)}
              </Fact>
              <Fact label={t("Output")}>
                {proposal.outputTarget === "room" ? t("Assistant room") : t("Task")}
              </Fact>
              <Fact label={t("Model")}>
                <ModelLabel harness={execution.harness} model={execution.model} />
              </Fact>
              <Fact label={t("Mode")}>{t(RUNTIME_MODE_LABEL[execution.runtimeMode])}</Fact>
            </div>
          </dl>
        ) : null}
      </div>
    </Modal>
  );
}
