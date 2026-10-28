import { useState, type ComponentProps } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useT } from "../../../shared/i18n";
import { SessionRecoveryPanel } from "../../shell/SessionRecoveryPanel";
import {
  EditorDraftRecoverySection,
  type EditorDraftRecoverySectionProps,
} from "./EditorDraftRecoverySection";
import type { SessionRecovery } from "../../../features/workspace/model/sessionRecovery";
import { BufferRecoveryReports } from "./BufferRecoveryReports";

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
            <div className="shrink-0 px-3 pt-3">
              <SegmentedControl
                label={t("Recovery type")}
                value={mode}
                onValueChange={setMode}
                options={[
                  {
                    value: "sessions",
                    label: t("Conversations"),
                    disabled: chatPending || draftPending,
                  },
                  {
                    value: "files",
                    label: t("File drafts"),
                    accessory: editorDraftRecords.length,
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
                  },
                ]}
              />
            </div>
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
        </Modal>
      )}
    />
  );
}
