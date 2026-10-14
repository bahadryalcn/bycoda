import { useCallback } from "react";
import { remoteProjectFor } from "../../../features/connections/model/remoteProjects";
import type { PlanBuildTarget } from "../../../features/sessions/model/session";
import { buildRemotePlan } from "../../../features/connections/model/remoteSessionActions";
import { saveLastModelSettings } from "../../../features/sessions/model/models";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Submit } from "../helpers/types";

export interface PlanActionDeps {
  onSubmit: (...args: Parameters<Submit>) => unknown;
}

// Plan card edits and build requests. Verbatim from Workspace.
export function usePlanActions({ onSubmit }: PlanActionDeps) {
  const onUpdatePlan = useCallback((sessionId: string, blockId: string, text: string) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (remoteProjectFor(session.cwd)) return session;
        if (session.id !== sessionId || session.busy) return session;
        return {
          ...session,
          blocks: session.blocks.map((block) => {
            if (
              block.id !== blockId ||
              block.role !== "plan" ||
              block.plan?.status === "streaming" ||
              block.plan?.status === "building" ||
              block.plan?.status === "built"
            ) {
              return block;
            }
            const originalText = block.plan?.originalText ?? block.text;
            return {
              ...block,
              text,
              plan: {
                ...(block.plan ?? { status: "ready" as const }),
                status: "ready" as const,
                originalText,
                edited: text !== originalText,
              },
            };
          }),
        };
      }),
    );
  }, []);

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session && remoteProjectFor(session.cwd)) {
        buildRemotePlan(sessionId, blockId, target);
        return;
      }
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !!block.orchestration ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  return { onUpdatePlan, onBuildPlan };
}
