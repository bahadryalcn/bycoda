import { useSyncExternalStore } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import { runtimeModeLabel } from "../model/runtimeModeLabel";
import { automationScheduleLabel } from "../model/automations";
import { dateTimeFormat, useT } from "../../../shared/i18n";
import {
  automationProposalSnapshot,
  subscribeAutomationProposal,
  closeAutomationProposal,
  saveAutomationProposal,
} from "../model/automationProposalStore";

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
        {state.notice ? <Alert tone="danger">{state.notice}</Alert> : null}
        {saved ? <Alert tone="success">{t("Saved")}</Alert> : null}
        {proposal ? (
          <>
            <DescriptionList>
              <DescriptionItem term={t("Name")}>{proposal.name}</DescriptionItem>
              <DescriptionItem term={t("Instructions")}>
                <span className="block max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {proposal.instruction}
                </span>
              </DescriptionItem>
            </DescriptionList>
            <DescriptionList columns="auto">
              <DescriptionItem term={t("Host")}>{state.machine?.name ?? ""}</DescriptionItem>
              <DescriptionItem term={t("Project")}>{state.session.cwd}</DescriptionItem>
              <DescriptionItem term={t("Schedule")}>
                {automationScheduleLabel(proposal.schedule)}
              </DescriptionItem>
              <DescriptionItem term={t("Time zone")}>{proposal.preview.timeZone}</DescriptionItem>
              <DescriptionItem term={t("Next run")}>
                {dateTimeFormat(undefined, {
                  timeZone: proposal.preview.timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(state.saved?.nextRunAt ?? proposal.preview.nextRunAt)}
              </DescriptionItem>
              <DescriptionItem term={t("Output")}>
                {proposal.outputTarget === "room" ? t("Assistant room") : t("Task")}
              </DescriptionItem>
              <DescriptionItem term={t("Model")}>
                <ModelLabel harness={execution.harness} model={execution.model} />
              </DescriptionItem>
              <DescriptionItem term={t("Mode")}>
                {runtimeModeLabel(execution.runtimeMode)}
              </DescriptionItem>
            </DescriptionList>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
