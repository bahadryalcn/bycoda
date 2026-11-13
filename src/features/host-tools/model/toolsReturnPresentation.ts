import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { readWorkspaceTransfer, toolsTransferEdits } from "../toolsTransferLedger";
import type { ToolsSession } from "../toolsSessionRegistry";

export const RETURN_PRESENTATION_MS = 30000;

/** The final editable snapshot comparison is synchronous: no digest wait can admit a newer edit. */
export function assertToolsReturnUnchanged(
  session: ToolsSession,
  view: { tab: NonNullable<ToolsSession["initialTab"]>; machine: string } | undefined,
  submitted: string,
  message: string,
) {
  const current = {
    ...session,
    initialTab: view?.tab ?? session.initialTab,
    initialMachine: view?.machine ?? session.initialMachine,
  };
  if (JSON.stringify(toolsTransferEdits(current, readWorkspaceTransfer(current))) !== submitted)
    throw new Error(message);
}

/** A timed-out native hide cannot be cancelled; reveal only its still-owned retained pane. */
export async function hideReturnedTools(
  window: { hide: () => Promise<void>; show: () => Promise<void> },
  canReveal: () => boolean,
  report: (cause: unknown) => void,
  label: string,
) {
  let expired = false;
  const hide = window.hide();
  void hide
    .then(async () => {
      if (expired && canReveal()) await withTimeout(window.show(), RETURN_PRESENTATION_MS, label);
    })
    .catch(report);
  try {
    await withTimeout(hide, RETURN_PRESENTATION_MS, label);
  } catch (cause) {
    expired = cause instanceof TimeoutError;
    throw cause;
  }
}
