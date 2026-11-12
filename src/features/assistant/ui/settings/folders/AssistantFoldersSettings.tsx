import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { pickFolders } from "../../../../../platform/tauri/fs";
import { ASSISTANT_FOLDERS_MAX } from "../../../../../shared/model/assistantFolders";
import { Alert } from "../../../../../shared/ui/Alert";
import { Button } from "../../../../../shared/ui/Button";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { FolderPlus, X } from "../../../../../shared/ui/icons";
import { Row, Toggle } from "../../../../settings/public/settingsControls";
import type { assistantRequest } from "../../../model/assistantClient";
import { useAssistantFolders, type FoldersDraftState } from "./useAssistantFolders";
import styles from "./assistantFolders.module.css";

/**
 * Folders the Assistant Room may read and change, and whether it may run commands without asking.
 * Both are owner-only choices saved with the dialog's Save (`saveRef`), under their own version.
 * Reads need no approval; every change and (unless the switch is on) every command still asks.
 */
export function AssistantFoldersSettings({
  request,
  saveRef,
  onDraftStateChange,
}: {
  request: typeof assistantRequest;
  saveRef?: { current: (() => Promise<void>) | null };
  onDraftStateChange?: (state: FoldersDraftState) => void;
}) {
  const state = useAssistantFolders(request, saveRef, onDraftStateChange);
  const { draft } = state;
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
          "The assistant can read these folders without asking. Every change inside them asks you first. It cannot reach other places on this computer.",
        )}
        stacked
      >
        <div className={styles.list}>
          {draft.paths.length === 0 && (
            <Text as="p" size="caption" tone="secondary" leading="inherit" className={styles.empty}>
              {t("No folders added yet.")}
            </Text>
          )}
          {draft.paths.map((path) => (
            <div
              key={path}
              {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.item)}
            >
              <Text
                as="span"
                size="secondary"
                tone="inherit"
                leading="inherit"
                truncate
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
      <Row
        label={t("Run commands without asking")}
        description={t(
          "Skip the confirmation for each command the assistant runs in these folders and in your projects.",
        )}
        feedback={
          draft.runWithoutAsking ? (
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
