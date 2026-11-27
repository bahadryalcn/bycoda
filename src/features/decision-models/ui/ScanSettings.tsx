import {
  useRetainedTransaction,
  retainedTransactionValue,
} from "../../model-routing/public/settings";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { SlidersHorizontal } from "../../../shared/ui/icons";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import {
  MAX_EXTRA_FOLDERS,
  MAX_EXTRA_PORTS,
  folderExample,
  formatFolders,
  formatPorts,
  parseFolders,
  parsePorts,
  type FolderPlatform,
} from "../model/scanSettings";
import { IS_LINUX, IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { ErrorNotice } from "./ErrorNotice";
import { useDecisionTarget } from "./DecisionTarget";
import { useDecisionDialogClose } from "../hooks/useDecisionDialogClose";
type FieldErrors = { ports?: string; folders?: string };
function localFolderPlatform(): FolderPlatform | undefined {
  if (IS_WIN) return "win32";
  if (IS_MAC) return "darwin";
  if (IS_LINUX) return "linux";
  return undefined;
}
/**
 * The "Scan settings" button and its dialog: extra ports and folders for the scan, saved through the
 * discovery settings RPC. Drafts, the open state and a pending save survive a remount for the same Host.
 */
export function ScanSettings({
  hostId,
  client,
  onScan,
  scanning = false,
}: {
  hostId?: string;
  client: DecisionModelsClient;
  onScan: () => Promise<void>;
  scanning?: boolean;
}) {
  const instanceId = useId();
  const identity = hostId ?? instanceId;
  const target = useDecisionTarget();
  const example = target ? undefined : folderExample(localFolderPlatform());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [ports, setPorts] = useRetainedTransaction(`decision:${identity}:scan:ports`, "");
  const [folders, setFolders] = useRetainedTransaction(`decision:${identity}:scan:folders`, "");
  const [saved, setSaved] = useRetainedTransaction(`decision:${identity}:scan:saved`, {
    ports: "",
    folders: "",
  });
  const [open, setOpen] = useRetainedTransaction(`decision:${identity}:scan:open`, false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useRetainedTransaction(`decision:${identity}:scan:saving`, false);
  const [saveError, setSaveError] = useRetainedTransaction<unknown>(
    `decision:${identity}:scan:error`,
    null,
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    void client.discovery.settings.get({}).then(
      (result) => {
        if (!alive.current) return;
        const next = {
          ports: formatPorts(result.extraPorts),
          folders: formatFolders(result.extraFolders),
        };
        const previous = retainedTransactionValue<{ ports: string; folders: string }>(
          `decision:${identity}:scan:saved`,
        );
        const currentPorts = retainedTransactionValue<string>(`decision:${identity}:scan:ports`);
        const currentFolders = retainedTransactionValue<string>(
          `decision:${identity}:scan:folders`,
        );
        if (!previous || (currentPorts === previous.ports && currentFolders === previous.folders)) {
          setPorts(next.ports);
          setFolders(next.folders);
          setSaved(next);
        }
        setLoaded(true);
      },
      (error: unknown) => {
        if (alive.current) setLoadError(error);
      },
    );
    return () => setLoadError(null);
  }, [client, attempt, identity, setPorts, setFolders, setSaved]);
  const dirty = ports !== saved.ports || folders !== saved.folders;
  const close = useDecisionDialogClose(
    dirty,
    saving,
    () => {
      setPorts(saved.ports);
      setFolders(saved.folders);
      setFieldErrors({});
      setSaveError(null);
      setOpen(false);
    },
    t("Your scan settings have not been saved."),
  );
  const save = () => {
    if (retainedTransactionValue<boolean>(`decision:${identity}:scan:saving`)) return;
    if (!dirty) {
      // The page's found list shows scan progress and errors.
      setSaveError(null);
      setOpen(false);
      void onScan().catch(() => undefined);
      return;
    }
    const portResult = parsePorts(ports);
    const folderResult = parseFolders(folders);
    const nextErrors: FieldErrors = {};
    if (!portResult.ok) {
      nextErrors.ports =
        portResult.error === "count"
          ? t("Enter at most {p1} ports.", { p1: String(MAX_EXTRA_PORTS) })
          : t("Enter ports from 1 to 65535, separated by commas.");
    }
    if (!folderResult.ok) {
      nextErrors.folders =
        folderResult.error === "count"
          ? t("Enter at most {p1} folders.", { p1: String(MAX_EXTRA_FOLDERS) })
          : example !== undefined
            ? t("Enter full folder paths, for example {p1}.", { p1: example })
            : t("Enter full folder paths, one per line.");
    }
    setFieldErrors(nextErrors);
    if (!portResult.ok || !folderResult.ok) return;
    setSaving(true);
    setSaveError(null);
    void client.discovery.settings
      .set({ extraPorts: portResult.value, extraFolders: folderResult.value })
      .then(
        (result) => {
          const next = {
            ports: formatPorts(result.extraPorts),
            folders: formatFolders(result.extraFolders),
          };
          setPorts(next.ports);
          setFolders(next.folders);
          setSaved(next);
          setSaving(false);
          setOpen(false);
          void onScan().catch(() => undefined);
        },
        (error: unknown) => {
          setSaveError(error);
          setSaving(false);
        },
      );
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        startIcon={<SlidersHorizontal aria-hidden="true" />}
        onClick={() => setOpen(true)}
      >
        {t("Scan settings")}
      </Button>
      {open ? (
        <Modal
          title={t("Scan settings")}
          description={t(
            "The scan always checks the usual ports and model folders. Add others here.",
          )}
          size="md"
          onClose={close.requestClose}
          footer={
            <ModalActions>
              <Button variant="ghost" disabled={saving} onClick={close.requestClose}>
                {t("Cancel")}
              </Button>
              <Button
                variant="primary"
                loading={saving || scanning}
                disabled={!loaded || saving || scanning}
                disabledReason={loaded ? undefined : t("Wait for the settings to load.")}
                onClick={save}
              >
                {dirty ? t("Save and scan") : t("Scan with these settings")}
              </Button>
            </ModalActions>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {loadError !== null ? (
              <ErrorNotice
                title={t("Could not load the scan settings.")}
                error={loadError}
                onRetry={() => setAttempt((value) => value + 1)}
              />
            ) : null}
            <TextField
              label={t("Extra ports")}
              placeholder="8080, 9000"
              value={ports}
              disabled={!loaded || saving}
              error={fieldErrors.ports}
              onChange={(event) => setPorts(event.target.value)}
            />
            <TextareaField
              label={t("Extra folders")}
              placeholder={example ?? t("Folder path, one per line")}
              value={folders}
              minRows={2}
              monospace
              disabled={!loaded || saving}
              error={fieldErrors.folders}
              onChange={(event) => setFolders(event.target.value)}
            />
            {saveError !== null ? <ErrorNotice error={saveError} /> : null}
          </div>
          {close.dialog}
        </Modal>
      ) : null}
    </>
  );
}
