import { PermissionRow } from "../../permissions";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { Row } from "../../settings/ui/settingsControls";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import {
  isMicrophoneBlocked,
  microphoneBlockedMessage,
  webviewMicrophoneBlockedMessage,
  openMicrophone,
} from "../model/microphoneAccess";
import { loadVoiceSettings } from "../model/voiceSettings";

/** Permission inspection never requests capture. Only the explicit check does. */
export function MicrophonePermissionSettings() {
  const [permission, setPermission] = useState<PermissionState>();
  const [busy, setBusy] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    // Track the webview capture gate separately from the native OS report.
    mounted.current = true;
    let status: PermissionStatus | undefined;
    const update = () => {
      if (mounted.current && status) {
        setPermission(status.state);
        if (status.state !== "denied") {
          setError((previous) => (isMicrophoneBlocked(previous) ? "" : previous));
        }
      }
    };
    // WebViews without the Permissions API remain unknown until an explicit check.
    void (async () => {
      try {
        const value = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (!value) return;
        if (!mounted.current) return;
        status = value;
        update();
        status.addEventListener("change", update);
      } catch {
        // Unsupported permission names remain unknown; no capture probe.
      }
    })();
    return () => {
      mounted.current = false;
      attempt.current++;
      status?.removeEventListener("change", update);
    };
  }, []);

  async function check() {
    if (pending.current) return;
    pending.current = true;
    setRequestPending(true);
    const id = ++attempt.current;
    setBusy(true);
    setError("");
    try {
      const microphoneId = loadVoiceSettings().microphoneId;
      const stream = await openMicrophone({
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        video: false,
      });
      // A grant can arrive after Cancel, disabling the feature, or unmounting.
      stream.getTracks().forEach((track) => track.stop());
      if (mounted.current && id === attempt.current) setPermission("granted");
    } catch (cause) {
      if (mounted.current && id === attempt.current) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (isMicrophoneBlocked(message)) setPermission("denied");
        setError(message);
      }
    } finally {
      pending.current = false;
      if (mounted.current) setRequestPending(false);
      if (mounted.current && id === attempt.current) setBusy(false);
    }
  }
  const blocked =
    error !== webviewMicrophoneBlockedMessage() &&
    (permission === "denied" || isMicrophoneBlocked(error));
  const message =
    requestPending && !busy
      ? t("Finish or dismiss the microphone permission prompt to check again.")
      : error ||
        (blocked
          ? microphoneBlockedMessage()
          : permission === "granted"
            ? t(
                "Microphone permission is allowed. The microphone stays closed until you start dictation, voice or a microphone check.",
              )
            : t(
                "Microphone permission is requested only when you start dictation, voice or a microphone check.",
              ));
  return (
    <>
      <PermissionRow id="microphone" />
      <Row
        id="speech-microphone"
        label={t("Microphone access")}
        description={blocked || error || (requestPending && !busy) ? message : undefined}
        info={
          !blocked && !error && !(requestPending && !busy) ? (
            <InfoPopover label={`${t("Microphone access")}: ${t("Help")}`}>{message}</InfoPopover>
          ) : undefined
        }
      >
        {!blocked && !error && !requestPending && (
          <Badge size="xs" tone={permission === "granted" ? "success" : "neutral"}>
            {permission === "granted" ? t("Microphone allowed") : t("Not checked")}
          </Badge>
        )}
        <Button
          onClick={() =>
            void check().catch((cause) => {
              if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
            })
          }
          loading={busy}
          disabled={requestPending}
        >
          {t("Check microphone access")}
        </Button>
        {busy ? (
          <Button
            onClick={() => {
              attempt.current++;
              setBusy(false);
            }}
          >
            {t("Cancel")}
          </Button>
        ) : null}
        <MicrophoneRecoveryAction message={blocked ? microphoneBlockedMessage() : error} />
      </Row>
    </>
  );
}
