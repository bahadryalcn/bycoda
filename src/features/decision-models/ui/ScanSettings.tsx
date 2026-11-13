import {
  useRetainedTransaction,
  retainedTransactionValue,
} from "../../model-routing/public/settings";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Row } from "../../settings/public/settingsControls";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import {
  MAX_EXTRA_FOLDERS,
  MAX_EXTRA_PORTS,
  formatFolders,
  formatPorts,
  parseFolders,
  parsePorts,
} from "../model/scanSettings";
import { ErrorNotice } from "./ErrorNotice";
type FieldErrors = { ports?: string; folders?: string };
/** Extra ports and folders for the scan, saved through the discovery settings RPC. */
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [ports, setPorts] = useRetainedTransaction(`decision:${identity}:scan:ports`, "");
  const [folders, setFolders] = useRetainedTransaction(`decision:${identity}:scan:folders`, "");
  const [saved, setSaved] = useRetainedTransaction(`decision:${identity}:scan:saved`, {
    ports: "",
    folders: "",
  });
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
  const save = () => {
    if (retainedTransactionValue<boolean>(`decision:${identity}:scan:saving`)) return;
    if (!dirty) {
      setSaveError(null);
      void onScan().catch((error: unknown) => setSaveError(error));
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
          : t("Enter full folder paths, for example D:\\Models.");
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
          void onScan().catch((error: unknown) => setSaveError(error));
        },
        (error: unknown) => {
          setSaveError(error);
          setSaving(false);
        },
      );
  };
  return (
    <>
      {loadError !== null ? (
        <div className="px-4 py-2.5">
          <ErrorNotice error={loadError} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : null}
      <Row
        stacked
        label={t("Extra ports")}
        description={t("Local ports to check, separated by commas.")}
      >
        <TextField
          label={t("Extra ports")}
          hideLabel
          placeholder="8080, 9000"
          value={ports}
          disabled={!loaded || saving}
          error={fieldErrors.ports}
          onChange={(event) => setPorts(event.target.value)}
        />
      </Row>
      <Row stacked label={t("Extra folders")} description={t("Folders to search for model files.")}>
        <TextareaField
          label={t("Extra folders")}
          hideLabel
          placeholder={"D:\\Models"}
          value={folders}
          minRows={2}
          monospace
          disabled={!loaded || saving}
          error={fieldErrors.folders}
          onChange={(event) => setFolders(event.target.value)}
        />
      </Row>
      <div
        {...surfaceAttributes(
          { frame: "settings", edge: "top" },
          "flex min-w-0 flex-col gap-2 px-4 py-2.5",
        )}
      >
        {saveError !== null ? <ErrorNotice error={saveError} /> : null}
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            loading={saving || scanning}
            disabled={!loaded || saving || scanning}
            onClick={save}
          >
            {dirty ? t("Save and scan") : t("Scan with these settings")}
          </Button>
        </div>
      </div>
    </>
  );
}
