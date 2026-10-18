import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useMemo, useRef } from "react";
import type { Submit } from "../helpers/types";
import { type OrchestrationWorkerDetail } from "../../../features/orchestration/ui/OrchestrationActions";
import { focusWindowLiveAgent } from "../../model/useWindowLiveAgents";
import {
  type OrchestrationProposal,
  withOrchestrationProposal,
  validateOrchestrationSettings,
} from "../../../features/orchestration/model/orchestrationPlan";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { upsertSession } from "../../../features/sessions/data/sessionStore";
import { message } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";

export interface OrchestrationActionsDeps {
  onOpenApprovalSession: (sessionId: string) => void;
  queueWorkerPanes: (workers: OrchestrationWorkerDetail[]) => void;
  onSubmit: Submit;
  liveAgents: Parameters<typeof focusWindowLiveAgent>[0][];
  unopenedRemoteRef: MutableRefObject<{ project: string; session: { id: string } }[]>;
  dismissRemoteFinished: (sessionId: string) => void;
  onSelectRemoteSession: (project: string, remoteSessionId: string) => void;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
}

export function useOrchestrationActions({
  onOpenApprovalSession,
  queueWorkerPanes,
  onSubmit,
  liveAgents,
  unopenedRemoteRef,
  dismissRemoteFinished,
  onSelectRemoteSession,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setServersViewOpen,
}: OrchestrationActionsDeps) {
  const confirmingOrchestration = useRef(new Set<string>());
  const updateOrchestrationCard = useCallback(
    (leadId: string, blockId: string, proposal: OrchestrationProposal) => {
      const next = sessionsRef.current.map((session) =>
        session.id === leadId ? withOrchestrationProposal(session, blockId, proposal) : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      return next.find((session) => session.id === leadId);
    },
    [],
  );
  const orchestrationActions = useMemo(
    () => ({
      open: onOpenApprovalSession,
      openAgents: queueWorkerPanes,
      update: (leadId: string, blockId: string, edited: OrchestrationProposal) => {
        const session = sessionsRef.current.find((entry) => entry.id === leadId);
        const proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
        if (
          !session ||
          session.busy ||
          proposal?.status !== "ready" ||
          confirmingOrchestration.current.has(leadId)
        )
          return;
        // Keep the discovered catalog authoritative while allowing task and parallelism edits.
        const settings = validateOrchestrationSettings({
          ...proposal.settings,
          maxWorkers: edited.settings.maxWorkers,
        });
        updateOrchestrationCard(leadId, blockId, {
          ...proposal,
          settings,
          tasks: edited.tasks,
        });
      },
      confirm: async (leadId: string, blockId: string) => {
        if (confirmingOrchestration.current.has(leadId)) return;
        confirmingOrchestration.current.add(leadId);
        let proposal: OrchestrationProposal | undefined;
        try {
          await orchestrator.hydrate(leadId);
          const session = sessionsRef.current.find((entry) => entry.id === leadId);
          proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
          if (!session || session.busy || proposal?.status !== "ready")
            throw new Error("Wait for the proposal to finish before confirming.");
          if (
            session.harness !== proposal.author.harness ||
            session.model !== proposal.author.model
          )
            throw new Error(
              "The lead model has changed. Switch back to the model shown on this card, or generate a new proposal.",
            );
          const starting = updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "starting",
          })!;
          // Save the edited card before anything can execute.
          await upsertSession(starting);
          await orchestrator.startApproved(leadId, blockId, proposal);
          updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "approved",
          });
        } catch (error) {
          if (proposal)
            updateOrchestrationCard(leadId, blockId, {
              ...proposal,
              status: "ready",
            });
          throw error;
        } finally {
          confirmingOrchestration.current.delete(leadId);
        }
      },
      retry: (leadId: string, blockId: string) => {
        const session = sessionsRef.current.find((entry) => entry.id === leadId);
        const proposal = session?.blocks.find((block) => block.id === blockId)?.orchestration;
        if (!session || session.busy || !proposal) return;
        onSubmit(leadId, proposal.request, [], {
          intent: "orchestrate",
          orchestrationRetry: proposal,
        });
      },
    }),
    [onOpenApprovalSession, queueWorkerPanes, onSubmit, updateOrchestrationCard],
  );

  const onSelectLiveAgent = useCallback(
    (sessionId: string) => {
      const elsewhere = liveAgents.find(
        (agent) => agent.id === sessionId && agent.ownerWindowLabel,
      );
      if (elsewhere) {
        void focusWindowLiveAgent(elsewhere).catch((error) => {
          void message(String(error), {
            get title() {
              return t("Open conversation window");
            },
          });
        });
        return;
      }

      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      const remote = unopenedRemoteRef.current.find(({ session }) => session.id === sessionId);
      if (remote) {
        dismissRemoteFinished(sessionId);
        onSelectRemoteSession(remote.project, sessionId);
      } else onOpenApprovalSession(sessionId);
    },
    [dismissRemoteFinished, onOpenApprovalSession, onSelectRemoteSession, liveAgents],
  );
  return { orchestrationActions, onSelectLiveAgent };
}
