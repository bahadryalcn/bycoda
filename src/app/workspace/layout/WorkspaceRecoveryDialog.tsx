import { useState, type ComponentProps } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { useT } from "../../../shared/i18n";
import { SessionRecoveryPanel } from "../../shell/SessionRecoveryPanel";
import {
  EditorDraftRecoverySection,
  type EditorDraftRecoverySectionProps,
} from "./EditorDraftRecoverySection";
import type { SessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import { RecoveryTabs, recoveryPanelId, recoveryTabId, type RecoveryTab } from "./RecoveryLayout";

const PREFIX = "workspace-recovery";

const emptyRecovery: SessionRecovery = {
  capturedAt: 0,
  dismissed: true,
  workspace: {
    tabs: [],
    sessions: [],
    activeTabId: "",
    projectCwd: "~",
    projectTerminals: [],
  },
};
type Props = Omit<ComponentProps<typeof SessionRecoveryPanel>, "recovery" | "renderContainer"> & {
  recovery: SessionRecovery | null | undefined;
  editorDraftRecovery?: EditorDraftRecoverySectionProps["recovery"];
  editorDraftRecords?: EditorDraftRecoverySectionProps["records"];
};
export function WorkspaceRecoveryDialog({
  editorDraftRecovery,
  editorDraftRecords = [],
  recovery,
  ...props
}: Props) {
  const t = useT();
  const [mode, setMode] = useState(() =>
    recovery?.workspace.sessions.length ? "sessions" : "files",
  );
  if (!editorDraftRecovery?.available)
    return recovery ? <SessionRecoveryPanel {...props} recovery={recovery} /> : null;
  const draftPending = editorDraftRecovery.pendingKeys.size > 0;
  // Keep an open file pane mounted through confirmation and its empty state.
  const hasSessions = !!recovery?.workspace.sessions.length;
  const fileSide = editorDraftRecords.length > 0 || !hasSessions || mode === "files";
  return (
    <SessionRecoveryPanel
      {...props}
      recovery={recovery ?? emptyRecovery}
      renderContainer={(sessions, chatPending) => {
        const busy = chatPending || draftPending;
        const tabs: RecoveryTab[] = [
          ...(hasSessions ? [{ value: "sessions", label: t("Sessions"), disabled: busy }] : []),
          ...(fileSide
            ? [
                {
                  value: "files",
                  label: t("File drafts"),
                  count: editorDraftRecords.length,
                  disabled: busy,
                },
              ]
            : []),
        ];
        const activeMode = tabs.some((tab) => tab.value === mode)
          ? mode
          : (tabs[0]?.value ?? "sessions");
        return (
          <Modal
            padding="none"
            title={t("Recovered work")}
            onClose={props.onClose}
            closeDisabled={busy}
            hideCloseTooltip
            size="md"
            fitViewport
          >
            <div className="flex w-full min-h-0 flex-col">
              {tabs.length > 1 ? (
                <RecoveryTabs
                  label={t("Recovery type")}
                  idPrefix={PREFIX}
                  value={activeMode}
                  onChange={setMode}
                  tabs={tabs}
                />
              ) : null}
              <div
                role={tabs.length > 1 ? "tabpanel" : "region"}
                id={recoveryPanelId(PREFIX, activeMode)}
                aria-labelledby={tabs.length > 1 ? recoveryTabId(PREFIX, activeMode) : undefined}
                aria-label={tabs.length > 1 ? undefined : tabs[0]?.label}
                className="flex min-h-0 flex-col"
              >
                {activeMode === "files" ? (
                  <EditorDraftRecoverySection
                    recovery={editorDraftRecovery}
                    records={editorDraftRecords}
                  />
                ) : (
                  sessions
                )}
              </div>
            </div>
          </Modal>
        );
      }}
    />
  );
}
