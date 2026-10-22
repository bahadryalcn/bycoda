import { invoke } from "@tauri-apps/api/core";
import type { MutableRefObject, SetStateAction, Dispatch } from "react";
import {
  closeTerminalInDock,
  findProjectTerminal,
  mapProjectTerminal,
  type ProjectTerminalDock,
} from "../../../features/projects/model/projectTerminal";
import { isLocalProject } from "../../../features/projects/model/recents";
import { confirmCloseTerminal } from "../../../features/terminal/model/terminalClose";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import type { AppUiContext, AppUiInput } from "../../model/appUiControl";

export type ConversationTerminalDeps = {
  docks: MutableRefObject<ProjectTerminalDock[]>;
  setDocks: Dispatch<SetStateAction<ProjectTerminalDock[]>>;
  open: (cwd: string, profile?: string, terminalId?: string) => boolean;
  stillActive: (context: AppUiContext) => boolean;
};

/** Session-owned terminals use the existing dock and native PTY commands. No shell command input,
 * arbitrary cwd/profile, remote fallback, terminal adoption, or confirmation bypass. */
export function createConversationTerminalControl(getDeps: () => ConversationTerminalDeps) {
  const closed = new Set<string>();
  return async (
    context: AppUiContext,
    action: "terminals.create" | "terminals.close" | "terminals.interrupt",
    input: AppUiInput,
  ): Promise<unknown> => {
    const deps = getDeps();
    const active = () =>
      (context.deadline === undefined || Date.now() < context.deadline) &&
      isLocalProject(context.cwd) &&
      !isProjectLockedIn(getGroupLockView().lock, context.cwd) &&
      getDeps().stillActive(context);
    if (!active()) throw new Error("Calling conversation is not active in its local workspace.");
    const prefix = `conversation-terminal:${encodeURIComponent(context.sessionId)}:`;
    const id = action === "terminals.create" ? `${prefix}${input.requestId}` : input.terminalId!;
    if (!id.startsWith(prefix)) throw new Error("Terminal was not created by this conversation.");
    const file = () =>
      findProjectTerminal(getDeps().docks.current, context.cwd)?.pane.files.find(
        (file) => file.id === id && file.terminal,
      );
    if (action === "terminals.create") {
      if (closed.has(id))
        throw new Error(
          "This request's terminal was closed. Use a new requestId to create another.",
        );
      if (!deps.open(context.cwd, undefined, id))
        throw new Error("Project terminal is unavailable.");
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (!active())
          throw new Error(
            "Conversation changed during terminal creation. Read terminals.list before retrying.",
          );
        if (file()) {
          try {
            await invoke("pty_status", { id });
            return { terminalId: id, created: true, running: true };
          } catch {
            /* PTY mounting/spawn has not acknowledged yet. */
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(
        "Terminal spawn acknowledgement timed out. Read terminals.list before retrying with the same requestId.",
      );
    }
    if (closed.has(id)) {
      if (action === "terminals.interrupt")
        throw new Error("Conversation terminal is already closed.");
      return { terminalId: id, closed: true };
    }
    const target = file();
    if (!target) throw new Error("Conversation terminal is not present in this project's dock.");
    if (action === "terminals.interrupt") {
      // PTY line discipline interprets Ctrl-C; never send a process-tree signal or caller bytes.
      await invoke("pty_write", { id, data: "\u0003" });
      return { terminalId: id, accepted: true, bytes: 1 };
    }
    if (!(await confirmCloseTerminal(target)))
      return { terminalId: id, closed: false, cancelled: true };
    if (!active() || file() !== target)
      throw new Error("Conversation or terminal changed during close confirmation.");
    // Strict native ownership check; do not use killPty's best-effort cleanup wrapper as acceptance.
    await invoke("pty_kill", { id });
    closed.add(id);
    getDeps().setDocks((previous) =>
      mapProjectTerminal(previous, context.cwd, (dock) => closeTerminalInDock(dock, id)),
    );
    return { terminalId: id, closed: true };
  };
}
