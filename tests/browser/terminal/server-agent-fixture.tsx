import { useState } from "react";
import type { ServerAgentSession } from "../../../src/features/connections/public/serverAgent";
import { newSession } from "../../../src/features/sessions/model/session";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";

const noop = () => {};
const no = () => false;
const handlers = {
  onFocus: noop,
  onClose: noop,
  onCwdChange: noop,
  onBranchChange: noop,
  onWorkspaceModeChange: noop,
  onWorktreeBaseChange: noop,
  onModelChange: noop,
  onModelSettingsChange: noop,
  onRuntimeModeChange: noop,
  onSubmit: no,
  onSaveDraft: no,
  onRemoveDraft: no,
  onStop: noop,
  onCompactContext: no,
  onPlaceSessionInFolder: noop,
  onDeleteQueuedMessage: noop,
  onEditQueuedMessage: noop,
  onQueuedMessageEditingChange: noop,
  onSteerQueuedMessage: no,
  onResumeQueue: no,
  onUsageLimitResumeAtReset: noop,
  onUsageLimitDismiss: noop,
  onApproval: noop,
  onQuestionReply: noop,
  onOpenFile: noop,
  onOpenDiff: noop,
  onOpenPlan: noop,
  onBuildPlan: noop,
  onNewTerminal: noop,
} satisfies Partial<SessionPaneProps>;

/** The app's actual transcript and composer, fed by the page-local session and SSH receipt. */
export function ServerAgentFixture({
  binding,
  startedAt,
}: {
  binding: ServerAgentSession;
  startedAt: number;
}) {
  const [session] = useState(() => ({
    ...newSession("codex", binding.cwd),
    id: binding.sessionId,
    busy: true,
    blocks: [
      {
        id: `${binding.sessionId}-user`,
        role: "user" as const,
        text: "Check whether the server is ready.",
        startedAt,
      },
    ],
  }));
  return (
    <SessionPane
      {...handlers}
      session={session}
      visible
      focused
      inSplit={false}
      composerFocused={false}
      recents={[]}
      hideProjectPicker
      hideSessionToolbar
      addToChatTarget={false}
      receiveTargetedQuotes
      sshActivityServerId={binding.serverId}
    />
  );
}
