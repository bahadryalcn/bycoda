import { useState, type ComponentProps } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { useT } from "../../../shared/i18n";
import { SessionRecoveryPanel } from "../../shell/SessionRecoveryPanel";
import {
  EditorDraftRecoverySection,
  type EditorDraftRecoverySectionProps,
} from "./EditorDraftRecoverySection";
import type { SessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import { BufferRecoveryReports } from "./BufferRecoveryReports";
import { RecoveryTabs, recoveryPanelId, recoveryTabId } from "./RecoveryLayout";

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
  canInspectLegacyReports?: () => boolean;
  getLegacyReportPrivacySnapshot?: () => unknown;
};
export function WorkspaceRecoveryDialog({
  editorDraftRecovery,
  editorDraftRecords = [],
  canInspectLegacyReports = () => false,
  getLegacyReportPrivacySnapshot,
  recovery,
  ...props
}: Props) {
  const t = useT();
  const [mode, setMode] = useState(() =>
    recovery?.workspace.sessions.length ? "sessions" : "files",
  );
  const [reportSelection, setReportSelection] = useState<{
    paths: readonly string[];
    privacy: unknown;
  } | null>(null);
  const reportPaths =
    reportSelection && reportSelection.privacy === getLegacyReportPrivacySnapshot?.()
      ? reportSelection.paths
      : [];
  if (!editorDraftRecovery?.available)
    return recovery ? <SessionRecoveryPanel {...props} recovery={recovery} /> : null;
  const draftPending = editorDraftRecovery.pendingKeys.size > 0;
  return (
    <SessionRecoveryPanel
      {...props}
      recovery={recovery ?? emptyRecovery}
      renderContainer={(sessions, chatPending) => (
        <Modal
          title={t("Recovered work")}
          onClose={chatPending || draftPending ? () => {} : props.onClose}
          size="md"
          className="session-recovery-dialog"
          fitViewport
        >
          <div className="flex w-full min-h-0 flex-col">
            <RecoveryTabs
              label={t("Recovery type")}
              idPrefix={PREFIX}
              value={mode}
              onChange={setMode}
              tabs={[
                {
                  value: "sessions",
                  label: t("Conversations"),
                  disabled: chatPending || draftPending,
                },
                {
                  value: "files",
                  label: t("File drafts"),
                  count: editorDraftRecords.length,
                  disabled: chatPending || draftPending,
                },
                {
                  value: "reports",
                  label: t("Earlier file reports"),
                  disabled:
                    chatPending ||
                    draftPending ||
                    !getLegacyReportPrivacySnapshot ||
                    !canInspectLegacyReports(),
                  disabledReason:
                    chatPending || draftPending
                      ? t("Available when the current recovery action finishes.")
                      : t("Earlier file reports are not available for inspection right now."),
                },
              ]}
            />
            <div
              role="tabpanel"
              id={recoveryPanelId(PREFIX, mode)}
              aria-labelledby={recoveryTabId(PREFIX, mode)}
              className="flex min-h-0 flex-col"
            >
              {mode === "files" ? (
                <EditorDraftRecoverySection
                  recovery={editorDraftRecovery}
                  records={editorDraftRecords}
                  reportPaths={reportPaths}
                  onClearReportPaths={() => setReportSelection(null)}
                />
              ) : mode === "reports" && getLegacyReportPrivacySnapshot ? (
                <BufferRecoveryReports
                  canInspect={canInspectLegacyReports}
                  getPrivacySnapshot={getLegacyReportPrivacySnapshot}
                  onShowCopies={(paths) => {
                    setReportSelection({ paths, privacy: getLegacyReportPrivacySnapshot() });
                    setMode("files");
                  }}
                />
              ) : (
                sessions
              )}
            </div>
          </div>
        </Modal>
      )}
    />
  );
}
