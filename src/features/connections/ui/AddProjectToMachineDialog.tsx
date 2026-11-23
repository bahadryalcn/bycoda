import { useEffect, useId, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ArrowRight, FolderOpen } from "../../../shared/ui/icons";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Progress } from "../../../shared/ui/Progress";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { TextField } from "../../../shared/ui/TextField";
import { toast } from "../../../shared/ui/ToastRegion";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import {
  cloneDestination,
  cloneProjectToMachine,
  cloneUrlChoices,
  copiedByDefault,
  copyIgnoredFiles,
  defaultCloneParent,
  listIgnoredFiles,
  repositoryNames,
  type AddProjectToMachineRequest,
  type CloneProgress,
  type CloneProtocol,
} from "../model/addProjectToMachine";
import { useRemoteMachines } from "../model/connections";
import { remoteProjectMachines } from "../model/localSync";
import { machineLabel } from "../model/machineIdentity";
import { pickFolderOnMachine } from "../model/machineFolderPick";
import { parseRemotePath } from "../model/remoteProjects";

/**
 * Puts the project at `request.sourceCwd` on another machine: clone its repository there
 * (optionally with files git ignores), or locate a folder that machine already has.
 * Answers through `onDone` with the new project's rail path, or undefined on cancel.
 */
export function AddProjectToMachineDialog({
  request,
  onDone,
}: {
  request: AddProjectToMachineRequest;
  onDone: (path?: string) => void;
}) {
  useLocale();
  const { target, sourceCwd, url } = request;
  const formId = useId();
  const { machines: allMachines, loaded, error: machinesError } = useRemoteMachines();
  const machine =
    target.kind === "remote"
      ? remoteProjectMachines(allMachines).find((entry) => entry.id === target.machineId)
      : undefined;
  const unavailable = target.kind === "remote" && !machine && loaded;
  const choices = cloneUrlChoices(url);
  const [protocol, setProtocol] = useState<CloneProtocol>(choices.current);
  const [parent, setParent] = useState("");
  const [loadingParent, setLoadingParent] = useState(true);
  // undefined while the ignored files are being listed.
  const [ignored, setIgnored] = useState<string[]>();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [locating, setLocating] = useState(false);
  const [progress, setProgress] = useState<CloneProgress>();
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);
  // Set on every mount: development StrictMode mounts, unmounts and mounts again.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- keeps the unmount guard that drops late async results current across StrictMode remounts
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const machineId = machine?.id;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- loads the target machine's default clone folder once it is known
  useEffect(() => {
    if (target.kind === "remote" && !machineId) return;
    let current = true;
    defaultCloneParent(
      machine ? { id: machine.id, environmentId: machine.environmentId } : undefined,
    )
      .then((home) => {
        if (current) setParent(home);
      })
      .catch((reason: unknown) => {
        if (current) setError(errorText(reason));
      })
      .finally(() => {
        if (current) setLoadingParent(false);
      });
    return () => {
      current = false;
    };
  }, [machineId]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- lists the source checkout's git-ignored files for the copy choices
  useEffect(() => {
    let current = true;
    listIgnoredFiles(sourceCwd)
      .then((files) => {
        if (!current) return;
        setIgnored(files);
        setChecked(new Set(files.filter(copiedByDefault)));
      })
      .catch(() => {
        if (current) setIgnored([]);
      });
    return () => {
      current = false;
    };
  }, [sourceCwd]);

  const chosenUrl = choices[protocol];
  const ready =
    !unavailable && !loadingParent && !!parent.trim() && (target.kind === "local" || !!machine);

  const clone = async () => {
    if (busy.current || !ready) return;
    busy.current = true;
    setRunning(true);
    setError("");
    setProgress({ phase: t("Cloning…"), percent: null });
    try {
      const path = await cloneProjectToMachine({
        machine: machine ? { id: machine.id, environmentId: machine.environmentId } : undefined,
        url: chosenUrl,
        parent,
        onProgress: (next) => {
          if (alive.current) setProgress(next);
        },
      });
      const files = [...checked];
      if (files.length > 0) {
        // The clone stands even when some files do not copy.
        const failed = await copyIgnoredFiles(sourceCwd, path, files).catch(() => files);
        if (failed.length > 0)
          toast.show({
            tone: "warning",
            message: t("{p0} files could not be copied.", { p0: failed.length }),
          });
      }
      if (alive.current) onDone(path);
    } catch (reason) {
      if (alive.current) setError(errorText(reason));
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  };

  const locate = async () => {
    if (busy.current || unavailable) return;
    busy.current = true;
    setLocating(true);
    setError("");
    try {
      const path = await pickFolderOnMachine(target);
      if (!alive.current) return;
      if (path !== undefined) onDone(path);
      else setLocating(false);
    } catch (reason) {
      if (!alive.current) return;
      setError(errorText(reason));
      setLocating(false);
    } finally {
      busy.current = false;
    }
  };

  // The dialog steps aside while the folder browser is open and returns with its state intact.
  if (locating) return null;

  const targetName =
    target.kind === "local"
      ? t("this computer")
      : machine
        ? machineLabel(allMachines, machine)
        : t("another computer");
  const source = parseRemotePath(sourceCwd);
  const sourceMachine = source
    ? allMachines.find((entry) => entry.environmentId === source.environmentId)
    : undefined;
  const sourceName = source
    ? sourceMachine
      ? machineLabel(allMachines, sourceMachine)
      : t("Another computer")
    : t("This computer");
  const names = repositoryNames(url);
  const destination = parent.trim() ? cloneDestination(parent, url) : names.folder;

  return (
    <Modal
      title={t("Add to {p0}", { p0: targetName })}
      description={names.label}
      size="md"
      closeDisabled={running}
      onClose={() => onDone(undefined)}
      footer={
        <ModalActions
          start={
            <Button
              type="button"
              variant="secondary"
              disabled={running || unavailable}
              onClick={() => void locate()}
            >
              <FolderOpen className="icon-md" />
              {t("Locate folder")}
            </Button>
          }
        >
          <Button
            type="button"
            variant="ghost"
            disabled={running}
            onClick={() => onDone(undefined)}
          >
            {t("Cancel")}
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={running} disabled={!ready}>
            {t("Clone")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void clone();
        }}
      >
        {unavailable ? (
          <EmptyState
            size="inline"
            kind="empty"
            description={t("That machine is not available.")}
          />
        ) : target.kind === "remote" && !machine ? (
          machinesError ? (
            <Alert tone="danger">{machinesError}</Alert>
          ) : (
            <LoadingText>{t("Loading…")}</LoadingText>
          )
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Endpoint name={sourceName} path={source?.hostPath ?? sourceCwd} />
              <ArrowRight className="icon-md shrink-0" tone="muted" />
              <Endpoint name={targetName} path={destination} />
            </div>
            {choices.ssh !== choices.https ? (
              <div className="flex items-center gap-2">
                <Text tone="muted">{t("Clone over")}</Text>
                <SegmentedControl
                  size="sm"
                  label={t("Clone over")}
                  value={protocol}
                  options={[
                    { value: "ssh", label: "SSH", disabled: running },
                    { value: "https", label: "HTTPS", disabled: running },
                  ]}
                  onValueChange={(value) => setProtocol(value as CloneProtocol)}
                />
              </div>
            ) : null}
            <OverflowTooltip label={chosenUrl}>
              <Text truncate tone="muted" className="font-mono">
                {chosenUrl}
              </Text>
            </OverflowTooltip>
            <TextField
              label={t("Folder on {p0}", { p0: targetName })}
              value={parent}
              monospace
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              disabled={running || loadingParent}
              onChange={(event) => setParent(event.target.value)}
            />
            {ignored === undefined ? (
              <LoadingText>{t("Looking for ignored files…")}</LoadingText>
            ) : ignored.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Text tone="muted">{t("Copy ignored files")}</Text>
                <Surface variant="card" padding="none" className="max-h-40 overflow-y-auto">
                  <div className="flex flex-col p-1">
                    {ignored.map((relative) => (
                      <Checkbox
                        key={relative}
                        label={relative}
                        checked={checked.has(relative)}
                        disabled={running}
                        onChange={(event) => {
                          const next = new Set(checked);
                          if (event.target.checked) next.add(relative);
                          else next.delete(relative);
                          setChecked(next);
                        }}
                      />
                    ))}
                  </div>
                </Surface>
              </div>
            ) : null}
            {running && progress ? (
              <Progress
                label={progress.phase}
                value={progress.percent ?? undefined}
                showValue={progress.percent !== null}
              />
            ) : null}
          </>
        )}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </Modal>
  );
}

function Endpoint({ name, path }: { name: string; path: string }) {
  useLocale();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <OverflowTooltip label={name}>
        <Text tone="primary" truncate>
          {name}
        </Text>
      </OverflowTooltip>
      <OverflowTooltip label={path}>
        <Text size="caption" tone="muted" truncate className="font-mono">
          {path}
        </Text>
      </OverflowTooltip>
    </div>
  );
}
