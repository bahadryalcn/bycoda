import { useCallback, type MutableRefObject } from "react";
import { runShellCommand } from "../../../platform/tauri/fs";
import { loadTerminalProfile } from "../../../features/terminal/model/terminalProfiles";
import {
  finishShellBlock,
  SHELL_FOLLOW_UP_PROMPT,
  shellBlock,
  type ShellResult,
} from "../../../features/sessions/model/shellRun";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { sessionsRef, setSessions } from "../../../features/sessions/model/sessionsStore";

export interface SessionShellDeps {
  removingSessionIds: MutableRefObject<Set<string>>;
  /** Read lazily: the submit ref is declared later in Workspace. */
  getSubmitSessionRef: () => MutableRefObject<(sessionId: string, text: string) => unknown>;
}

export function useSessionShell({ removingSessionIds, getSubmitSessionRef }: SessionShellDeps) {
  /** Runs a `!command` in the session's working copy and shows it in the
   * transcript. The next message carries its output to the model. */
  const runSessionShell = useCallback((sessionId: string, command: string): boolean => {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (
      !session ||
      session.worktreeRemoved ||
      session.inboxAsk ||
      session.orchestrationLeadId ||
      removingSessionIds.current.has(sessionId)
    )
      return false;
    const blockId = crypto.randomUUID();
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id === sessionId
          ? {
              ...entry,
              blocks: [...entry.blocks, shellBlock(blockId, command)],
            }
          : entry,
      ),
    );
    void runShellCommand(sessionWorkCwd(session), command, loadTerminalProfile())
      .catch((error): ShellResult => ({
        output: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
      }))
      .then((result) => {
        const finish = (entries: Session[]) =>
          entries.map((entry) =>
            entry.id === sessionId
              ? {
                  ...entry,
                  blocks: entry.blocks.map((block) =>
                    block.id === blockId ? finishShellBlock(block, result) : block,
                  ),
                }
              : entry,
          );
        // The follow-up reads sessionsRef, so it must hold the output now.
        sessionsRef.current = finish(sessionsRef.current);
        setSessions(finish);
        // Hand the result to the agent so it carries on without another message.
        if (sessionsRef.current.some((entry) => entry.id === sessionId)) {
          void getSubmitSessionRef().current(sessionId, SHELL_FOLLOW_UP_PROMPT);
        }
      });
    return true;
  }, []);

  return { runSessionShell };
}
