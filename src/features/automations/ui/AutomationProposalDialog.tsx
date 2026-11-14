import { useSyncExternalStore } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
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
        {state.error ? (
          <Alert tone="danger" title={t("Automation")}>
            {state.error}
          </Alert>
        ) : null}
        {saved ? (
          <Alert tone="success" title={t("Saved")}>
            {state.saved?.name}
          </Alert>
        ) : null}
        {proposal ? (
          <>
            <TextField label={t("Name")} value={proposal.name} readOnly />
            <TextareaField label={t("Instructions")} value={proposal.instruction} readOnly />
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3">
              <TextField label={t("Host")} value={state.machine?.name ?? ""} readOnly />
              <TextField label={t("Project")} value={state.session.cwd} readOnly />
              <TextField
                label={t("Schedule")}
                value={automationScheduleLabel(proposal.schedule)}
                readOnly
              />
              <TextField label={t("Time zone")} value={proposal.preview.timeZone} readOnly />
              <TextField
                label={t("Next run")}
                value={dateTimeFormat(undefined, {
                  timeZone: proposal.preview.timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(state.saved?.nextRunAt ?? proposal.preview.nextRunAt)}
                readOnly
              />
              <TextField
                label={t("Output")}
                value={proposal.outputTarget === "room" ? t("Assistant Room") : t("Task")}
                readOnly
              />
              <TextField
                label={t("Model")}
                value={`${execution.harness} · ${execution.model}`}
                readOnly
              />
              <TextField label={t("Mode")} value={execution.runtimeMode} readOnly />
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
