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
import {
  RecoveryTabs,
  recoveryPanelId,
  recoveryTabId,
  type RecoveryTab,
} from "./RecoveryLayout";

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
  // A tab exists only when it has something to show. File drafts and reports are the
  // dialog's home when there are no conversations; reports can only be counted after an
  // explicit listing, so they ride along with the file copies instead of standing alone.
  const hasSessions = !!recovery?.workspace.sessions.length;
  const fileSide = editorDraftRecords.length > 0 || !hasSessions;
  const reportsInspectable = !!getLegacyReportPrivacySnapshot && canInspectLegacyReports();
  return (
    <SessionRecoveryPanel
      {...props}
      recovery={recovery ?? emptyRecovery}
      renderContainer={(sessions, chatPending) => {
        const busy = chatPending || draftPending;
        const tabs: RecoveryTab[] = [
          ...(hasSessions
            ? [{ value: "sessions", label: t("Conversations"), disabled: busy }]
            : []),
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
          ...(fileSide && reportsInspectable
            ? [
                {
                  value: "reports",
                  label: t("Earlier file reports"),
                  disabled: busy,
                  disabledReason: t("Available when the current recovery action finishes."),
                },
              ]
            : []),
        ];
        const activeMode = tabs.some((tab) => tab.value === mode)
          ? mode
          : (tabs[0]?.value ?? "sessions");
        return (
          <Modal
            title={t("Recovered work")}
            onClose={busy ? () => {} : props.onClose}
            size="md"
            className="session-recovery-dialog"
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
                role="tabpanel"
                id={recoveryPanelId(PREFIX, activeMode)}
                aria-labelledby={recoveryTabId(PREFIX, activeMode)}
                className="flex min-h-0 flex-col"
              >
                {activeMode === "files" ? (
                  <EditorDraftRecoverySection
                    recovery={editorDraftRecovery}
                    records={editorDraftRecords}
                    reportPaths={reportPaths}
                    onClearReportPaths={() => setReportSelection(null)}
                  />
                ) : activeMode === "reports" && getLegacyReportPrivacySnapshot ? (
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
        );
      }}
    />
  );
}
