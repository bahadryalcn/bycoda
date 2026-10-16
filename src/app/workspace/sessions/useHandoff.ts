import { type MutableRefObject, useCallback } from "react";
import { formatSessionTitle, newSession, sessionDisplayTitle, sessionWorkCwd, type Block, type ModelTarget, type Session } from "../../../features/sessions/model/session";
import { harnessForTurn, turnEditedFiles, turnUserRequest } from "../../../features/sessions/model/secondOpinion";
import { HANDOFF_TITLE, buildDeterministicHandoff, buildHandoffComposerCard, sessionThroughTurn } from "../../../features/sessions/model/handoff";
import { mergeModelSettings, resolveModel } from "../../../features/sessions/model/models";
import type { OpenSessionBeside } from "./useSecondOpinion";

export interface HandoffDeps {
  sessionsRef: MutableRefObject<Session[]>;
  openSessionBeside: OpenSessionBeside;
}

/** Starts a handoff session beside the source with the deterministic brief. */
export function useHandoff({ sessionsRef, openSessionBeside }: HandoffDeps) {
  const onHandoff = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find((session) => session.id === sourceId);
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const sliced = sessionThroughTurn(source, turn);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(sliced.blocks, cwd);
      const display = sessionDisplayTitle(source.title, source.harness);
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(resolveModel(harness, model), modelSettings),
        title: formatSessionTitle(harness, display === "New session" ? HANDOFF_TITLE : display),
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside],
  );
  return { onHandoff };
}
