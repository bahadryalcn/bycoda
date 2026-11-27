import { errorText } from "../../shared/lib/errors";
import { PermissionRow } from "../permissions";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { Row, Select, Toggle } from "../../shared/ui/settings";
import { Alert } from "../../shared/ui/Alert";
import { Text } from "../../shared/ui/Text";
import { Badge } from "../../shared/ui/Badge";
import { RefreshCw } from "../../shared/ui/icons";
import {
  DESKTOP_DRIVERS,
  type DesktopControlConfiguration,
  type DesktopControlResponse,
  type DesktopPermissionMode,
} from "../../shared/model/host-contracts/desktop-control";
import { desktopControlRequest } from "./desktopControlClient";
import { DesktopHelperSetup } from "./DesktopHelperSetup";
import { InfoTooltip } from "../../shared/ui/InfoPopover";
import { InlineError } from "../../shared/ui/InlineError";
import styles from "./DesktopControlSettings.module.css";

export type DesktopControlDraftState = {
  dirty: boolean;
  pending: boolean;
  access?: Pick<DesktopControlConfiguration, "enabled" | "permissionMode" | "allowPhysicalInput">;
};

function permissionModeLabels(mode: DesktopPermissionMode) {
  if (mode === "full")
    return {
      label: t("Full access"),
      description: t("No questions, on any app, including physical input."),
    };
  return {
    label: t("Ask every time"),
    description: t("Asks once for each new app, then before every action."),
  };
}

/**
 * Owner configuration and emergency stop; no observation or desktop input on mount.
 * `saveRef` hands the settings shell the configure routine (it throws on failure) and hides the
 * local Save button. `refreshRef` does the same for the status refresh, which the shell then
 * shows in the section title row. Without them the section keeps its own Save and Refresh.
 */
export function DesktopControlSettings({
  onDraftStateChange,
  saveRef,
  refreshRef,
  accessRef,
  showPermissionControls = true,
}: {
  showPermissionControls?: boolean;
  onDraftStateChange?: (state: DesktopControlDraftState) => void;
  saveRef?: { current: (() => Promise<void>) | null };
  refreshRef?: { current: (() => void) | null };
  /**
   * The Assistant access settings own the permission mode. A preset also turns computer use and
   * physical input on; a changed standing permission only moves the mode.
   */
  accessRef?: {
    current: ((mode: DesktopPermissionMode, preset?: boolean) => void) | null;
  };
}) {
  const [draft, setDraft] = useState<DesktopControlConfiguration>();
  const [saved, setSaved] = useState<DesktopControlConfiguration>();
  const [status, setStatus] = useState<DesktopControlResponse["status"]>();
  const [error, setError] = useState("");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [helperReady, setHelperReady] = useState(false);
  const generation = useRef(0);
  const stoppingRef = useRef(false);
  const switchOnWhenReady = useRef(false);
  async function emergencyStop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const captured = ++generation.current;
    setStopping(true);
    setError("");
    setSaveConfirmed(false);
    try {
      const result = await desktopControlRequest({ op: "stop" });
      if (captured !== generation.current) return;
      setStatus((current) =>
        current ? { ...current, stopped: true, active: false, enabled: false } : current,
      );
      if (result.configuration) setSaved(result.configuration);
      if (result.configuration)
        setDraft((current) =>
          current
            ? {
                ...current,
                version: result.configuration!.version,
                enabled: false,
              }
            : result.configuration,
        );
    } catch (cause) {
      if (captured === generation.current) {
        setStatus(undefined);
        setError(errorText(cause));
      }
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    const captured = generation.current;
    void desktopControlRequest({ op: "status" })
      .then((result) => {
        if (!cancelled && captured === generation.current) {
          setDraft(result.configuration);
          setSaved(result.configuration);
          setStatus(result.status);
        }
      })
      .catch((cause) => {
        if (!cancelled && captured === generation.current) setError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const dirty =
    !!draft &&
    !!saved &&
    (draft.enabled !== saved.enabled ||
      draft.binaryPath !== saved.binaryPath ||
      draft.binarySha256 !== saved.binarySha256 ||
      draft.allowPhysicalInput !== saved.allowPhysicalInput ||
      draft.permissionMode !== saved.permissionMode ||
      draft.driver !== saved.driver ||
      JSON.stringify(draft.allowedApps) !== JSON.stringify(saved.allowedApps));
  // Helper preparation runs on the Host and survives closing, so it does not hold the dialog.
  useEffect(() => {
    onDraftStateChange?.({
      dirty,
      pending: pending || stopping,
      access: draft && {
        enabled: draft.enabled,
        permissionMode: draft.permissionMode,
        allowPhysicalInput: draft.allowPhysicalInput,
      },
    });
  }, [dirty, pending, stopping, onDraftStateChange, draft]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronizes the shell access callback with the current unsaved computer-control draft.
  useEffect(() => {
    if (!accessRef) return;
    accessRef.current =
      draft && !pending && !stopping
        ? (permissionMode, preset = false) => {
            setDraft((current) =>
              current
                ? {
                    ...current,
                    ...(preset ? { enabled: true } : {}),
                    permissionMode,
                    allowAllApps: permissionMode === "full",
                    ...(preset || permissionMode === "full" ? { allowPhysicalInput: true } : {}),
                  }
                : current,
            );
          }
        : null;
    return () => {
      accessRef.current = null;
    };
  });
  async function perform(
    op: "configure" | "stop" | "resume" | "status",
    options: {
      rethrow?: boolean;
      switchOnly?: boolean;
      enabled?: boolean;
    } = {},
  ) {
    if (pending || stoppingRef.current) {
      if (options.rethrow) throw new Error(t("Computer controls are still saving. Try again."));
      return;
    }
    const captured = generation.current;
    setPending(true);
    setError("");
    setSaveConfirmed(false);
    if (op === "status") setStatus(undefined);
    try {
      // The switch persists on its own: only the switch and the helper it needs come from the draft,
      // so other unsaved options stay unsaved and the saved version is the one checked.
      const base = options.switchOnly && saved ? saved : draft;
      const result =
        op === "configure" && draft && base
          ? await desktopControlRequest({
              op,
              expectedVersion: base.version,
              configuration: {
                enabled: options.enabled ?? draft.enabled,
                binaryPath: draft.binaryPath,
                binarySha256: draft.binarySha256,
                allowedApps: base.allowedApps,
                allowPhysicalInput: base.allowPhysicalInput,
                permissionMode: base.permissionMode,
                // Older Hosts return no driver and reject an unknown field.
                ...(draft.driver ? { driver: draft.driver } : {}),
              },
            })
          : await desktopControlRequest({
              op: op === "configure" ? "status" : op,
            });
      if (captured !== generation.current) {
        if (options.rethrow)
          throw new Error(t("Computer controls changed while saving. Review them and save again."));
        return;
      }
      if (op === "configure" && result.configuration && !options.switchOnly) setSaveConfirmed(true);
      if (result.configuration && op !== "status") setSaved(result.configuration);
      if (result.configuration)
        setDraft((current) =>
          (op === "configure" && !options.switchOnly) || !current
            ? result.configuration
            : options.switchOnly || op === "resume" || op === "stop"
              ? {
                  ...current,
                  version: result.configuration!.version,
                  enabled: result.configuration!.enabled,
                }
              : current,
        );
      const current = op === "status" ? result : await desktopControlRequest({ op: "status" });
      if (captured !== generation.current) return;
      setStatus(current.status);
    } catch (cause) {
      if (captured === generation.current) {
        setStatus(undefined);
        // A refused switch goes back to what the Host still has.
        if (options.switchOnly)
          setDraft((current) => current && { ...current, enabled: saved?.enabled ?? false });
        if (options.rethrow) throw cause;
        setError(errorText(cause));
      } else if (options.rethrow) {
        throw cause;
      }
    } finally {
      setPending(false);
    }
  }
  // Applies the switch once the verified helper is selected, so the switch persists without the Save button.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Starts the owner's pending switch-on once its helper is applied.
  useEffect(() => {
    if (!switchOnWhenReady.current || pending || !draft?.enabled || saved?.enabled) return;
    if (!helperReady || !draft.binaryPath) return;
    switchOnWhenReady.current = false;
    void perform("configure", { switchOnly: true, enabled: true });
  });
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () => perform("configure", { rethrow: true });
  });
  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null;
    },
    [saveRef],
  );
  useEffect(() => {
    if (!refreshRef) return;
    refreshRef.current = () => void perform("status");
  });
  useEffect(
    () => () => {
      if (refreshRef) refreshRef.current = null;
    },
    [refreshRef],
  );
  // Stop stays reachable while computer use is on, switching on, or saving.
  const computerOn =
    !!status?.enabled || !!status?.active || !!draft?.enabled || pending || stopping;
  // One unambiguous state: Working, Stopped, On · idle, Off or unsaved. A helper that is not ready
  // is told once, in the Helper row, and "Off" is the switch itself where there is one.
  const computerBadge = status?.active ? (
    <Badge tone="info" appearance="subtle">
      {t("Working")}
    </Badge>
  ) : status?.stopped ? (
    <Badge tone="warning" appearance="subtle">
      {t("Stopped")}
    </Badge>
  ) : draft?.enabled && !helperReady ? null : draft?.enabled && saved?.enabled === false ? (
    <Badge tone="warning" appearance="subtle">
      {t("Turns on when saved")}
    </Badge>
  ) : draft?.enabled ? (
    <Badge tone="success" appearance="subtle">
      {t("On · idle")}
    </Badge>
  ) : status && !showPermissionControls ? (
    <Badge tone="neutral" appearance="subtle">
      {t("Off")}
    </Badge>
  ) : null;
  const refresh = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      label={t("Refresh")}
      startIcon={<RefreshCw className="icon-sm" />}
      disabled={pending}
      disabledReason={t("Another change is being applied")}
      onClick={() => void perform("status")}
    />
  );
  // Resume after a stop, Turn on while off (no switch in the unified access layout), and the
  // emergency Stop whenever computer use is on, switching on or saving.
  const actions =
    status?.stopped || computerOn || (!showPermissionControls && draft && !draft.enabled) ? (
      <div className={styles.stopActions}>
        {status?.stopped && (
          <Button
            type="button"
            disabled={pending}
            disabledReason={t("Another change is being applied")}
            onClick={() => void perform("resume")}
          >
            {t("Resume")}
          </Button>
        )}
        {!showPermissionControls && !computerOn && !status?.stopped && (
          <Button
            type="button"
            disabled={pending}
            disabledReason={t("Another change is being applied")}
            onClick={() => draft && setDraft({ ...draft, enabled: true })}
          >
            {t("Turn on")}
          </Button>
        )}
        {computerOn && (
          <Button
            type="button"
            tone="danger"
            loading={stopping}
            onClick={() => void emergencyStop()}
          >
            {t("Stop computer use")}
          </Button>
        )}
      </div>
    ) : undefined;
  // In the settings dialog the rows are direct children of the dialog's group, so the shared row
  // layout (hairlines, padding, closing disclosure) applies; standalone they keep their own list.
  const embedded = !!refreshRef;
  const rows = (
    <>
      <PermissionRow id="accessibility" helperState={status?.permissions?.accessibility} />
      <PermissionRow id="screen-recording" helperState={status?.permissions?.screenRecording} />

      {draft && (
        <Row
          label={t("Driver")}
          info={
            <InfoTooltip>
              {t(
                "The native helper that reads and controls apps. Cua Driver works in the background without taking focus.",
              )}
            </InfoTooltip>
          }
        >
          <Select
            hideLabel
            label={t("Driver")}
            value={draft.driver}
            disabled={pending || stopping}
            disabledReason={t("Wait for the current operation to finish")}
            options={DESKTOP_DRIVERS.map((value) => ({
              value,
              label: value === "cua-driver" ? "Cua Driver" : "agent-desktop",
            }))}
            onChange={(value) => {
              const driver = DESKTOP_DRIVERS.find((item) => item === value);
              // A new driver needs its own verified helper; the setup row fills it in.
              if (driver && driver !== draft.driver)
                setDraft({
                  ...draft,
                  driver,
                  binaryPath: "",
                  binarySha256: "",
                });
            }}
          />
        </Row>
      )}
      <DesktopHelperSetup
        key={draft?.driver ?? "agent-desktop"}
        driver={draft?.driver ?? "agent-desktop"}
        disabled={pending || stopping}
        autoPrepare={!!draft?.enabled}
        selectedPath={draft?.binaryPath ?? ""}
        onReadyChange={setHelperReady}
        onUse={(helper) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  binaryPath: helper.binaryPath,
                  binarySha256: helper.binarySha256,
                }
              : current,
          )
        }
      />
      {draft && (
        <>
          <Row
            label={showPermissionControls ? t("Enable computer use") : t("Status")}
            feedback={showPermissionControls ? actions : undefined}
          >
            {computerBadge}
            {!showPermissionControls && actions}
            {showPermissionControls && (
              <Toggle
                label={t("Enable computer use")}
                on={draft.enabled}
                disabled={pending}
                onChange={(enabled) => {
                  setDraft({ ...draft, enabled });
                  // Off applies at once. On waits for the verified helper (below), so it never
                  // enables control without one.
                  if (enabled) switchOnWhenReady.current = true;
                  else {
                    switchOnWhenReady.current = false;
                    void perform("configure", { switchOnly: true, enabled });
                  }
                }}
              />
            )}
          </Row>
          {showPermissionControls && (
            <>
              <Row
                label={t("Permission")}
                description={t(
                  "Follows the assistant's permission: full access unless Computer use is an exception.",
                )}
                descriptionVisible
                info={
                  <InfoTooltip>
                    {permissionModeLabels(draft.permissionMode).description}
                  </InfoTooltip>
                }
              >
                <Text>{permissionModeLabels(draft.permissionMode).label}</Text>
              </Row>
              {draft.permissionMode === "full"
                ? !embedded && (
                    <Alert
                      tone="warning"
                      title={t("Full access asks nothing")}
                      extra={
                        <InfoTooltip>
                          {t(
                            "The assistant can use any app, launch apps, use the clipboard and use physical input without asking, even while you are away. Stop computer use and the emergency shortcut always work.",
                          )}
                        </InfoTooltip>
                      }
                    />
                  )
                : !!saved?.allowedApps.length && (
                    <Row
                      label={t("Approved apps")}
                      info={
                        <InfoTooltip>
                          {t(
                            "Apps you allowed when asked. Remove one to be asked again before it is used.",
                          )}
                        </InfoTooltip>
                      }
                      stacked
                    >
                      <SearchableSelect
                        hideLabel
                        multiple
                        label={t("Approved apps")}
                        value={draft.allowedApps}
                        options={saved.allowedApps.map((value) => ({
                          value,
                          label: value,
                        }))}
                        onChange={(allowedApps) => setDraft({ ...draft, allowedApps })}
                        disabled={pending}
                      />
                    </Row>
                  )}
              {(draft.permissionMode !== "full" || !draft.allowPhysicalInput) && (
                <Row
                  label={t("Physical input")}
                  info={
                    <InfoTooltip>
                      {t("Allows pointer and focus changes, only on your direct request.")}
                    </InfoTooltip>
                  }
                >
                  <Toggle
                    label={t("Allow physical input")}
                    on={draft.allowPhysicalInput}
                    disabled={pending}
                    onChange={(allowPhysicalInput) => setDraft({ ...draft, allowPhysicalInput })}
                  />
                </Row>
              )}
            </>
          )}
        </>
      )}
    </>
  );
  const errorLine = error && (
    <div
      {...surfaceAttributes(
        { frame: embedded ? "pane" : undefined, edge: "block-start" },
        embedded ? styles.embeddedError : undefined,
      )}
    >
      <InlineError details={error.includes("target-elevated") ? undefined : error}>
        {error.includes("target-elevated")
          ? t(
              "bycoda cannot control apps running as administrator. Run the target app without elevation.",
            )
          : t("Desktop control could not complete this.")}
      </InlineError>
    </div>
  );
  const custom = draft && (
    <>
      <Row
        label={t("Helper file")}
        info={
          <InfoTooltip>
            {t(
              "Use a helper you built or trust instead of the verified one. Its checksum must match.",
            )}
          </InfoTooltip>
        }
        stacked
      >
        <TextField
          label={t("Helper file")}
          hideLabel
          value={draft.binaryPath}
          onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
          disabled={pending}
          monospace
        />
      </Row>
      <Row label={t("Checksum (SHA-256)")} stacked>
        <TextField
          label={t("Checksum (SHA-256)")}
          hideLabel
          value={draft.binarySha256}
          onChange={(event) => setDraft({ ...draft, binarySha256: event.target.value })}
          disabled={pending}
          monospace
          maxLength={64}
        />
      </Row>
      {!saveRef && (
        <div className={styles.saveArea}>
          <div className={styles.actions}>
            <InfoTooltip>
              {t("Computer controls save separately from assistant settings.")}
            </InfoTooltip>
            <Button
              type="button"
              variant="primary"
              loading={pending}
              success={saveConfirmed && !dirty && !error}
              successLabel={t("Saved")}
              onClick={() => void perform("configure")}
            >
              {t("Save computer controls")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
  if (embedded)
    return (
      <>
        {rows}
        {errorLine}
        {custom}
      </>
    );
  return (
    <div className={styles.settings}>
      <div className={styles.toolbar}>{refresh}</div>
      <div {...surfaceAttributes({ layout: "settings-rows" }, styles.rows)}>{rows}</div>
      {errorLine}
      {custom}
    </div>
  );
}
