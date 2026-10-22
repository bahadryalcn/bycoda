import { invoke } from "@tauri-apps/api/core";
import { requestAppUi } from "../../../app/model/appUiControl";
export type MobilePtyContext = {
  environmentId: string;
  sourceSessionId: string;
  projectCwd: string;
  workingCwd: string;
  actorId: string;
  valid: () => boolean;
  authorize: () => Promise<boolean>;
};
const fields: Record<string, string[]> = {
  list: [],
  create: ["requestId", "profileId", "cols", "rows"],
  attach: ["terminalId", "epoch", "requestId", "after", "freshRenderer"],
  read: ["terminalId", "epoch", "after", "limit"],
  write: ["terminalId", "epoch", "leaseId", "inputSequence", "dataBase64"],
  status: ["terminalId", "epoch", "leaseId", "requestId"],
  resize: ["terminalId", "epoch", "leaseId", "cols", "rows"],
  detach: ["terminalId", "epoch", "leaseId"],
  close: ["terminalId", "epoch", "requestId"],
};
export function createMobilePtyControl(
  deps = {
    call: (action: string, input: Record<string, unknown>) =>
      invoke("mobile_pty_call", { action, input }),
    eligible: async (context: MobilePtyContext) => {
      await requestAppUi(
        {
          cwd: context.projectCwd,
          sessionId: context.sourceSessionId,
          title: "",
          deadline: Date.now() + 12000,
        },
        "terminals.pty.guard",
        {},
      );
    },
  },
) {
  return async (context: MobilePtyContext, action: string, input: Record<string, unknown>) => {
    const keys = fields[action.replace(/^ptyMobile\./, "")];
    if (
      !action.startsWith("ptyMobile.") ||
      !keys ||
      Object.keys(input).some((key) => !keys.includes(key))
    )
      throw new Error("Unsupported mobile PTY field");
    if (
      !context.valid() ||
      context.projectCwd.startsWith("remote://") ||
      context.workingCwd.startsWith("remote://")
    )
      throw new Error("Mobile PTY source is unavailable or private");
    // Actual focused conversation/project/lifecycle guard. A source registration alone grants no PTY control.
    await deps.eligible(context);
    if (
      !["ptyMobile.list", "ptyMobile.read", "ptyMobile.status"].includes(action) &&
      !(await context.authorize())
    )
      throw new Error("Mobile PTY caller authorization expired or was revoked");
    if (!context.valid()) throw new Error("Mobile PTY source changed before the native operation");
    const result = await deps.call(action, {
      ...input,
      environmentId: context.environmentId,
      sessionId: context.sourceSessionId,
      projectCwd: context.workingCwd,
      actorId: context.actorId,
    });
    if (!context.valid())
      throw new Error("Mobile PTY source changed; inspect the original operation without replay");
    return result;
  };
}
export const handleMobilePty = createMobilePtyControl();
