import { useState } from "react";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";
import { newSession } from "../../../src/features/sessions/model/session";
import {
  modelsFor,
  resolveModel,
  findModel,
  setHarnessModels,
} from "../../../src/features/sessions/model/models";
import { ModelSourceContext } from "../../../src/features/sessions/ui/modelSource";
import type { BackgroundSessionTarget } from "../../../src/features/tasks/model/backgroundSession";

setHarnessModels("codex", [
  { id: "codex:fixture", harness: "codex", name: "Codex fixture", settings: [] },
]);

/** Real transcript/composer; page-local session state, never native or provider execution. */
export function CrewCoordinatorFixture({ target }: { target: BackgroundSessionTarget }) {
  const [session, setSession] = useState(() => ({
    ...newSession("codex", target.cwd, "codex:fixture"),
    id: target.sessionId,
    title: "Crew lead",
    blocks: [
      {
        id: "owner",
        role: "user" as const,
        text: "Build the requested settings changes and review them.",
      },
      {
        id: "lead",
        role: "assistant" as const,
        text: "UI and review members are working. Their results stay linked to this task.",
      },
    ],
  }));
  const noop = () => {};
  const props: SessionPaneProps = {
    session,
    visible: true,
    focused: true,
    inSplit: true,
    composerFocused: false,
    recents: [],
    hideProjectPicker: true,
    onFocus: noop,
    onClose: noop,
    onCwdChange: noop,
    onBranchChange: noop,
    onWorkspaceModeChange: noop,
    onWorktreeBaseChange: noop,
    onModelChange: (_id, harness, model) => setSession((value) => ({ ...value, harness, model })),
    onModelSettingsChange: noop,
    onRuntimeModeChange: noop,
    onSubmit: () => {
      setSession((value) => ({
        ...value,
        blocks: [
          ...value.blocks,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Fixture send recorded. No Host turn started.",
          },
        ],
      }));
      return false;
    },
    onSaveDraft: () => false,
    onRemoveDraft: () => false,
    onStop: () => {
      setSession((value) => ({ ...value, busy: false }));
    },
    onCompactContext: () => false,
    onPlaceSessionInFolder: noop,
    onDeleteQueuedMessage: noop,
    onEditQueuedMessage: noop,
    onQueuedMessageEditingChange: noop,
    onSteerQueuedMessage: () => false,
    onResumeQueue: () => false,
    onUsageLimitResumeAtReset: noop,
    onUsageLimitDismiss: noop,
    onApproval: noop,
    onQuestionReply: noop,
    onOpenFile: noop,
    onOpenDiff: noop,
    onOpenPlan: noop,
    onBuildPlan: noop,
    onNewTerminal: noop,
  };
  return (
    <ModelSourceContext.Provider
      value={{
        modelsFor,
        resolve: resolveModel,
        find: findModel,
        available: () => true,
        probed: () => true,
        refresh: () => {},
      }}
    >
      <SessionPane {...props} />
    </ModelSourceContext.Provider>
  );
}
