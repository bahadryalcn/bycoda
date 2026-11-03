import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { AdvancedSettings, Group, Row, Toggle } from "../settings/ui/settingsControls";
import { Badge } from "../../shared/ui/Badge";
import type {
  DesktopControlConfiguration,
  DesktopControlResponse,
} from "../../shared/model/host-contracts/desktop-control";
import { desktopControlRequest } from "./desktopControlClient";
import { DesktopHelperSetup } from "./DesktopHelperSetup";
import { InlineError } from "../../shared/ui/InlineError";
import styles from "./DesktopControlSettings.module.css";

/** Owner configuration and emergency stop; no observation or desktop input on mount. */
export function DesktopControlSettings({
  onDraftStateChange,
}: {
  onDraftStateChange?: (state: { dirty: boolean; pending: boolean }) => void;
} = {}) {
  const [draft, setDraft] = useState<DesktopControlConfiguration>();
  const [saved, setSaved] = useState<DesktopControlConfiguration>();
  const [status, setStatus] = useState<DesktopControlResponse["status"]>();
  const [error, setError] = useState("");
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [app, setApp] = useState("");
  const [stopping, setStopping] = useState(false);
  const [helperPending, setHelperPending] = useState(false);
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
            ? { ...current, version: result.configuration!.version, enabled: false }
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
    !!app ||
    (!!draft &&
      !!saved &&
      (draft.enabled !== saved.enabled ||
        draft.binaryPath !== saved.binaryPath ||
        draft.binarySha256 !== saved.binarySha256 ||
        draft.allowPhysicalInput !== saved.allowPhysicalInput ||
        JSON.stringify(draft.allowedApps) !== JSON.stringify(saved.allowedApps)));
  useEffect(() => {
    onDraftStateChange?.({ dirty, pending: pending || stopping || helperPending });
  }, [dirty, pending, stopping, helperPending, onDraftStateChange]);
  async function perform(op: "configure" | "stop" | "resume" | "status") {
    if (pending || stoppingRef.current) return;
    const captured = generation.current;
    setPending(true);
    setError("");
    setSaveConfirmed(false);
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
              },
            })
          : await desktopControlRequest({ op: op === "configure" ? "status" : op });
      if (captured !== generation.current) return;
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
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.settings}>
      <Group
        title={t("Status")}
        layout="full"
        description={t(
          "Only applications you allow can be controlled. Headless actions keep your pointer and focus in place.",
        )}
      >
        <Row label={t("Helper status")}>
          <Badge role="status" tone={status?.verified ? "success" : "neutral"}>
            {status
              ? t(
                  !status.installed
                    ? "Not installed"
                    : !status.verified
                      ? "Verification required"
                      : "Verified",
                )
              : t("Unavailable")}
          </Badge>
          <Button type="button" disabled={pending} onClick={() => void perform("status")}>
            {t("Refresh")}
          </Button>
          <Button
            type="button"
            tone="danger"
            loading={stopping}
            onClick={() => void emergencyStop()}
          >
            {t("Stop computer use")}
          </Button>
        </Row>
        <Row label={t("Computer control permission")}>
          <Badge role="status" tone={status?.stopped ? "warning" : "neutral"}>
            {t(
              !status
                ? "Unavailable"
                : status.stopped
                  ? "Stopped"
                  : status.enabled
                    ? "Enabled"
                    : "Disabled",
            )}
          </Badge>
          {status && (
            <span role="status">
              {t(
                status.active
                  ? "Desktop operation in progress"
                  : "No desktop operation is running.",
              )}
            </span>
          )}
        </Row>
        {error && !draft && <InlineError>{error}</InlineError>}
        {draft && (
          <>
            <Row
              label={t("Enable computer use")}
              description={t(
                "Opening settings does not start computer control. Enabling it only permits future actions; each action still needs your request and existing approvals.",
              )}
            >
              <Toggle
                label={t("Enable computer use")}
                on={draft.enabled}
                disabled={pending}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </Row>
          </>
        )}
      </Group>
      {draft && (
        <>
          <Group title={t("Allowed applications")} layout="full">
            <Row label={t("Allowed applications")} stacked>
              <SearchableSelect
                multiple
                label={t("Allowed applications")}
                value={draft.allowedApps}
                options={draft.allowedApps.map((value) => ({ value, label: value }))}
                onChange={(allowedApps) => setDraft({ ...draft, allowedApps })}
                disabled={pending}
              />
            </Row>
            <Row label={t("Add application")} stacked>
              <div className={styles.applicationEntry}>
                <TextField
                  label={t("Application name")}
                  hideLabel
                  value={app}
                  onChange={(event) => setApp(event.target.value)}
                  maxLength={200}
                />
                <Button
                  type="button"
                  disabled={pending || !app.trim() || draft.allowedApps.length >= 50}
                  onClick={() => {
                    setDraft({
                      ...draft,
                      allowedApps: [...new Set([...draft.allowedApps, app.trim()])],
                    });
                    setApp("");
                  }}
                >
                  {t("Add application")}
                </Button>
              </div>
            </Row>
          </Group>
          <Group title={t("Permissions")} layout="full">
            <Row
              label={t("Allow physical input")}
              description={t(
                "Physical input can move the pointer or change focus. It still requires a direct owner request.",
              )}
            >
              <Toggle
                label={t("Allow physical input")}
                on={draft.allowPhysicalInput}
                disabled={pending}
                onChange={(allowPhysicalInput) => setDraft({ ...draft, allowPhysicalInput })}
              />
            </Row>
          </Group>
          <Group title={t("Helper setup")} layout="full">
            <DesktopHelperSetup
              disabled={pending || stopping}
              onPendingChange={setHelperPending}
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
            <AdvancedSettings title={t("Advanced helper settings")} defaultOpen={false} keepMounted>
              <Row label={t("Helper executable")} stacked>
                <TextField
                  label={t("Helper executable")}
                  hideLabel
                  value={draft.binaryPath}
                  onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
                  disabled={pending}
                  monospace
                />
              </Row>
              <Row label={t("Expected SHA-256")} stacked>
                <TextField
                  label={t("Expected SHA-256")}
                  hideLabel
                  value={draft.binarySha256}
                  onChange={(event) => setDraft({ ...draft, binarySha256: event.target.value })}
                  disabled={pending}
                  monospace
                  maxLength={64}
                />
              </Row>
              <Row
                label={t("Helper trust")}
                description={t(
                  "Choose an agent-desktop native helper you trust. No helper is installed automatically.",
                )}
              />
            </AdvancedSettings>
          </Group>
          <div className={styles.saveArea}>
            <p>{t("Computer controls save separately from assistant settings.")}</p>
            {saveConfirmed && !dirty && <p role="status">{t("Computer controls saved.")}</p>}
            {error && <InlineError>{error}</InlineError>}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="primary"
                loading={pending}
                onClick={() => void perform("configure")}
              >
                {t("Save computer controls")}
              </Button>
              {status?.stopped && (
                <Button type="button" disabled={pending} onClick={() => void perform("resume")}>
                  {t("Resume")}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
