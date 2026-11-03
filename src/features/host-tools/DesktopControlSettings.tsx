import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { Group, Row, Toggle } from "../settings/ui/settingsControls";
import type {
  DesktopControlConfiguration,
  DesktopControlResponse,
} from "../../shared/model/host-contracts/desktop-control";
import { desktopControlRequest } from "./desktopControlClient";
import { DesktopHelperSetup } from "./DesktopHelperSetup";

/** Owner configuration and emergency stop; no observation or desktop input on mount. */
export function DesktopControlSettings() {
  const [draft, setDraft] = useState<DesktopControlConfiguration>();
  const [status, setStatus] = useState<DesktopControlResponse["status"]>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [app, setApp] = useState("");
  const [stopping, setStopping] = useState(false);
  const generation = useRef(0);
  const stoppingRef = useRef(false);
  async function emergencyStop() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const captured = ++generation.current;
    setStopping(true);
    setError("");
    try {
      const result = await desktopControlRequest({ op: "stop" });
      if (captured !== generation.current) return;
      setStatus((current) =>
        current ? { ...current, stopped: true, active: false, enabled: false } : current,
      );
      if (result.configuration)
        setDraft((current) =>
          current
            ? { ...current, version: result.configuration!.version, enabled: false }
            : result.configuration,
        );
    } catch (cause) {
      if (captured === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
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
  async function perform(op: "configure" | "stop" | "resume" | "status") {
    if (pending || stoppingRef.current) return;
    const captured = generation.current;
    setPending(true);
    setError("");
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
      if (captured === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Group
      title={t("Computer use")}
      description={t(
        "Only applications you allow can be controlled. Headless actions keep your pointer and focus in place.",
      )}
    >
      <Row label={t("Helper status")}>
        <span role="status">
          {status
            ? t(
                !status.installed
                  ? "Not installed"
                  : !status.verified
                    ? "Verification required"
                    : status.stopped
                      ? "Stopped"
                      : status.active
                        ? "Working"
                        : "Ready",
              )
            : t("Unavailable")}
        </span>
        <Button type="button" disabled={pending} onClick={() => void perform("status")}>
          {t("Refresh")}
        </Button>
      </Row>
      {error && <p role="alert">{error}</p>}
      {draft && (
        <>
          <Row label={t("Enable computer use")}>
            <Toggle
              label={t("Enable computer use")}
              on={draft.enabled}
              disabled={pending}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
            />
          </Row>
          <Row label={t("Allowed applications")} stacked>
            <SearchableSelect
              multiple
              label={t("Allowed applications")}
              value={draft.allowedApps}
              options={draft.allowedApps.map((value) => ({ value, label: value }))}
              onChange={(allowedApps) => setDraft({ ...draft, allowedApps })}
              disabled={pending}
            />
            <TextField
              label={t("Application name")}
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
          </Row>
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
          <DesktopHelperSetup
            disabled={pending || stopping}
            onUse={(helper) =>
              setDraft((current) =>
                current
                  ? { ...current, binaryPath: helper.binaryPath, binarySha256: helper.binarySha256 }
                  : current,
              )
            }
          />
          <details>
            <summary>{t("Helper setup")}</summary>
            <TextField
              label={t("Helper executable")}
              value={draft.binaryPath}
              onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
              disabled={pending}
              monospace
            />
            <TextField
              label={t("Expected SHA-256")}
              value={draft.binarySha256}
              onChange={(event) => setDraft({ ...draft, binarySha256: event.target.value })}
              disabled={pending}
              monospace
              maxLength={64}
            />
            <p>
              {t(
                "Choose an agent-desktop native helper you trust. No helper is installed automatically.",
              )}
            </p>
          </details>
          <Row label={t("Computer controls")}>
            <Button type="button" loading={pending} onClick={() => void perform("configure")}>
              {t("Save computer controls")}
            </Button>
            <Button
              type="button"
              tone="danger"
              loading={stopping}
              onClick={() => void emergencyStop()}
            >
              {t("Stop computer use")}
            </Button>
            {status?.stopped && (
              <Button type="button" disabled={pending} onClick={() => void perform("resume")}>
                {t("Resume")}
              </Button>
            )}
          </Row>
        </>
      )}
    </Group>
  );
}
