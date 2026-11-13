import { PermissionRow } from "../permissions";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { AdvancedSettings, Row, Select, Toggle } from "../settings/ui/settingsControls";
import { Alert } from "../../shared/ui/Alert";
import { Badge } from "../../shared/ui/Badge";
import { RefreshCw } from "../../shared/ui/icons";
import {
  DESKTOP_PERMISSION_MODES,
  type DesktopControlConfiguration,
  type DesktopControlResponse,
  type DesktopPermissionMode,
} from "../../shared/model/host-contracts/desktop-control";
import { desktopControlRequest } from "./desktopControlClient";
import { DesktopHelperSetup } from "./DesktopHelperSetup";
import { InfoPopover } from "../../shared/ui/InfoPopover";
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
  if (mode === "auto")
    return {
      label: t("Auto"),
      description: t("Asks once for each new app, and for the clipboard and physical input."),
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
  accessRef?: { current: ((mode: "ask" | "full") => void) | null };
}) {
  const [draft, setDraft] = useState<DesktopControlConfiguration>();
  const [saved, setSaved] = useState<DesktopControlConfiguration>();
  const [status, setStatus] = useState<DesktopControlResponse["status"]>();
  const [error, setError] = useState("");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [helperPending, setHelperPending] = useState(false);
  const [helperReady, setHelperReady] = useState(false);
  const generation = useRef(0);
  const stoppingRef = useRef(false);
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
        setError(cause instanceof Error ? cause.message : String(cause));
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
        if (!cancelled && captured === generation.current)
          setError(String(cause instanceof Error ? cause.message : cause));
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
        ? (permissionMode) => {
            setDraft((current) =>
              current
                ? {
                    ...current,
                    enabled: true,
                    permissionMode,
                    allowAllApps: permissionMode === "full",
                    allowPhysicalInput: true,
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
    options: { rethrow?: boolean } = {},
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
      const result =
        op === "configure" && draft
          ? await desktopControlRequest({
              op,
              expectedVersion: draft.version,
              configuration: {
                enabled: draft.enabled,
                binaryPath: draft.binaryPath,
                binarySha256: draft.binarySha256,
                allowedApps: draft.allowedApps,
                allowPhysicalInput: draft.allowPhysicalInput,
                permissionMode: draft.permissionMode,
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
      if (op === "configure" && result.configuration) setSaveConfirmed(true);
      if (result.configuration && op !== "status") setSaved(result.configuration);
      if (result.configuration)
        setDraft((current) =>
          op === "configure" || !current
            ? result.configuration
            : op === "resume" || op === "stop"
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
        if (options.rethrow) throw cause;
        setError(cause instanceof Error ? cause.message : String(cause));
      } else if (options.rethrow) {
        throw cause;
      }
    } finally {
      setPending(false);
    }
  }
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
  const computerBadge = status?.active ? (
    <Badge tone="info" appearance="subtle">
      {t("Running")}
    </Badge>
  ) : status?.stopped ? (
    <Badge tone="warning" appearance="subtle">
      {t("Stopped")}
    </Badge>
  ) : draft?.enabled && !helperReady ? (
    <Badge tone={helperPending ? "info" : "warning"} appearance="subtle">
      {helperPending ? t("Preparing helper…") : t("Helper not ready")}
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
      onClick={() => void perform("status")}
    />
  );
  // In the settings dialog the rows are direct children of the dialog's group, so the shared row
  // layout (hairlines, padding, closing disclosure) applies; standalone they keep their own list.
  const embedded = !!refreshRef;
  const rows = (
    <>
      <PermissionRow id="accessibility" helperState={status?.permissions?.accessibility} />
      <PermissionRow id="screen-recording" helperState={status?.permissions?.screenRecording} />

      <DesktopHelperSetup
        disabled={pending || stopping}
        autoPrepare={!!draft?.enabled}
        selectedPath={draft?.binaryPath ?? ""}
        onPendingChange={setHelperPending}
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
            label={t(showPermissionControls ? "Enable computer use" : "Status")}
            feedback={
              status?.stopped || computerOn ? (
                <div className={styles.stopActions}>
                  {status?.stopped && (
                    <Button type="button" disabled={pending} onClick={() => void perform("resume")}>
                      {t("Resume")}
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
              ) : undefined
            }
          >
            {computerBadge}
            {showPermissionControls && (
              <Toggle
                label={t("Enable computer use")}
                on={draft.enabled}
                disabled={pending}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            )}
          </Row>
          {showPermissionControls && (
            <>
              <Row
                label={t("Permission")}
                info={
                  <InfoPopover>
                    {permissionModeLabels(draft.permissionMode).description}
                  </InfoPopover>
                }
              >
                <Select
                  hideLabel
                  label={t("Permission")}
                  value={draft.permissionMode}
                  disabled={pending}
                  options={DESKTOP_PERMISSION_MODES.map((value) => ({
                    value,
                    label: permissionModeLabels(value).label,
                  }))}
                  onChange={(value) => {
                    const permissionMode = DESKTOP_PERMISSION_MODES.find((mode) => mode === value);
                    if (permissionMode)
                      setDraft({
                        ...draft,
                        permissionMode,
                        ...(permissionMode === "full" ? { allowPhysicalInput: true } : {}),
                      });
                  }}
                />
              </Row>
              {draft.permissionMode === "full"
                ? !embedded && (
                    <Alert tone="warning" title={t("Full access asks nothing")}>
                      {t(
                        "The assistant can use any app, launch apps, use the clipboard and use physical input without asking, even while you are away. Stop computer use and the emergency shortcut always work.",
                      )}
                    </Alert>
                  )
                : !!saved?.allowedApps.length && (
                    <Row
                      label={t("Approved apps")}
                      info={
                        <InfoPopover>
                          {t(
                            "Apps you allowed when asked. Remove one to be asked again before it is used.",
                          )}
                        </InfoPopover>
                      }
                      stacked
                    >
                      <SearchableSelect
                        hideLabel
                        multiple
                        label={t("Approved apps")}
                        value={draft.allowedApps}
                        options={saved.allowedApps.map((value) => ({ value, label: value }))}
                        onChange={(allowedApps) => setDraft({ ...draft, allowedApps })}
                        disabled={pending}
                      />
                    </Row>
                  )}
              {(draft.permissionMode !== "full" || !draft.allowPhysicalInput) && (
                <Row
                  label={t("Physical input")}
                  info={
                    <InfoPopover>
                      {t("Allows pointer and focus changes, only on your direct request.")}
                    </InfoPopover>
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
        { frame: embedded ? "settings" : undefined, edge: "block-start" },
        embedded ? styles.embeddedError : undefined,
      )}
    >
      <InlineError>
        {error.includes("target-elevated")
          ? t(
              "bycoda cannot control apps running as administrator. Run the target app without elevation.",
            )
          : error}
      </InlineError>
    </div>
  );
  const custom = draft && (
    <>
      <AdvancedSettings title={t("Custom helper")} defaultOpen={false} keepMounted>
        <Row
          label={t("Helper file")}
          description={t(
            "Use a helper you built or trust instead of the verified one. Its checksum must match.",
          )}
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
      </AdvancedSettings>
      {!saveRef && (
        <div className={styles.saveArea}>
          <Text as="p" leading="normal">
            {t("Computer controls save separately from assistant settings.")}
          </Text>
          <div className={styles.actions}>
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
