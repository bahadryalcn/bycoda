import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { useEffect } from "react";
import { pickFolders } from "../../../../../platform/tauri/fs";
import { ASSISTANT_FOLDERS_MAX } from "../../../../../shared/model/assistantFolders";
import { Alert } from "../../../../../shared/ui/Alert";
import { Button } from "../../../../../shared/ui/Button";
import { InfoPopover } from "../../../../../shared/ui/InfoPopover";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { FolderPlus, X } from "../../../../../shared/ui/icons";
import { Row, Toggle } from "../../../../settings/public/settingsControls";
import type { assistantRequest } from "../../../model/assistantClient";
import { useAssistantFolders, type FoldersDraftState } from "./useAssistantFolders";
import styles from "./assistantFolders.module.css";

/**
 * Assistant Room folder scope and separate command/file-change grants.
 * Owner-only choices are saved with the dialog's Save (`saveRef`), under their own version.
 * Reads need no approval; commands and changes ask unless their explicit grant is enabled.
 */
export function AssistantFoldersSettings({
  request,
  saveRef,
  onDraftStateChange,
  accessRef,
  showPermissionControls = true,
}: {
  showPermissionControls?: boolean;
  request: typeof assistantRequest;
  saveRef?: { current: (() => Promise<void>) | null };
  onDraftStateChange?: (state: FoldersDraftState) => void;
  accessRef?: { current: ((runWithoutAsking: boolean) => void) | null };
}) {
  const state = useAssistantFolders(request, saveRef, onDraftStateChange);
  const { draft } = state;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronizes the shell access callback with this unsaved folder draft owner.
  useEffect(() => {
    // The settings owner changes this draft only after an explicit access choice.
    if (!accessRef) return;
    accessRef.current =
      state.saved && !state.pending
        ? (runWithoutAsking) =>
            state.change({ runWithoutAsking, allowChangesWithoutAsking: runWithoutAsking })
        : null;
    return () => {
      accessRef.current = null;
    };
  });
  if (state.loading && !state.saved) return <LoadingText>{t("Loading folders…")}</LoadingText>;
  if (!state.saved)
    return (
      <InlineError retry={{ onRetry: () => void state.reload(), label: t("Reload") }}>
        {state.loadError || t("The folder list could not be read.")}
      </InlineError>
    );

  async function add() {
    const picked = await pickFolders(t("Choose folders for the assistant"), true);
    const next = [...draft.paths];
    for (const path of picked) if (!next.includes(path)) next.push(path);
    state.change({ paths: next.slice(0, ASSISTANT_FOLDERS_MAX) });
  }

  return (
    <>
      <Row
        label={t("Assistant folders")}
        description={t(
          !showPermissionControls
            ? "Choose the folders the assistant can use."
            : draft.allowChangesWithoutAsking
              ? "The assistant can read and change these folders without asking."
              : "The assistant can read these folders without asking. Changes need your approval.",
        )}
        stacked
      >
        <div className={styles.list}>
          {draft.paths.length === 0 && (
            <EmptyState
              size="inline"
              kind="empty"
              className={styles.empty}
              description={t("No folders added yet.")}
            />
          )}
          {draft.paths.map((path) => (
            <div key={path} {...surfaceAttributes({ separator: "pane-block" }, styles.item)}>
              <Text
                as="span"
                size="secondary"
                tone="inherit"
                leading="inherit"
                wrap="anywhere"
                className={styles.path}
              >
                {path}
              </Text>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                label={t("Remove {p0}", { p0: path })}
                startIcon={<X className="icon-sm" />}
                disabled={state.pending}
                onClick={() => state.change({ paths: draft.paths.filter((item) => item !== path) })}
              />
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              startIcon={<FolderPlus className="icon-sm" />}
              disabled={state.pending || draft.paths.length >= ASSISTANT_FOLDERS_MAX}
              onClick={() => void add()}
            >
              {t("Add folder…")}
            </Button>
          </div>
        </div>
      </Row>
      {showPermissionControls && (
        <>
          <Row label={t("Allow file changes without asking")}>
            <Toggle
              label={t("Allow file changes without asking")}
              on={draft.allowChangesWithoutAsking}
              disabled={state.pending}
              onChange={(allowChangesWithoutAsking) => state.change({ allowChangesWithoutAsking })}
            />
          </Row>
          <Row
            label={t("Run commands without asking")}
            info={
              <InfoPopover>
                {t(
                  "Skip the confirmation for each command the assistant runs in these folders and in your projects.",
                )}
              </InfoPopover>
            }
            feedback={
              draft.runWithoutAsking && !accessRef ? (
                <Alert tone="warning">
                  {t(
                    "A command can do anything you can do on this computer. With this on, a mistaken or manipulated request can change or delete files or send data before you see it.",
                  )}
                </Alert>
              ) : undefined
            }
          >
            <Toggle
              label={t("Run commands without asking")}
              on={draft.runWithoutAsking}
              disabled={state.pending}
              onChange={(runWithoutAsking) => state.change({ runWithoutAsking })}
            />
          </Row>
        </>
      )}
      {state.error && (
        <InlineError
          retry={
            state.conflict ? { onRetry: () => void state.reload(), label: t("Reload") } : undefined
          }
        >
          {state.error}
        </InlineError>
      )}
    </>
  );
}
