import { errorText } from "../../../shared/lib/errors";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Row } from "../../../shared/ui/settings";
import { MicrophoneRecoveryAction } from "./MicrophoneRecoveryAction";
import {
  isMicrophoneBlocked,
  microphoneBlockedMessage,
  webviewMicrophoneBlockedMessage,
  openMicrophone,
  stopMicrophone,
} from "../model/microphoneAccess";
import { loadVoiceSettings } from "../model/voiceSettings";

/** Permission inspection never requests capture. Only the explicit check does. */
export function MicrophonePermissionSettings() {
  const [permission, setPermission] = useState<PermissionState>();
  const [busy, setBusy] = useState(false);
  const [requestPending, setRequestPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef(0);
  const captureRequest = useRef<AbortController | null>(null);
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
      captureRequest.current?.abort();
      status?.removeEventListener("change", update);
    };
  }, []);

  async function check() {
    if (pending.current) return;
    pending.current = true;
    setRequestPending(true);
    const id = ++attempt.current;
    const request = new AbortController();
    captureRequest.current = request;
    setBusy(true);
    setError("");
    try {
      const microphoneId = loadVoiceSettings().microphoneId;
      const stream = await openMicrophone(
        {
          audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
          video: false,
        },
        { signal: request.signal },
      );
      // A grant can arrive after Cancel, disabling the feature, or unmounting.
      stopMicrophone(stream);
      if (mounted.current && id === attempt.current) setPermission("granted");
    } catch (cause) {
      if (mounted.current && id === attempt.current) {
        const message = errorText(cause);
        if (isMicrophoneBlocked(message)) setPermission("denied");
        setError(message);
      }
    } finally {
      if (captureRequest.current === request) captureRequest.current = null;
      pending.current = false;
      if (mounted.current) setRequestPending(false);
      if (mounted.current && id === attempt.current) setBusy(false);
    }
  }
  const blocked =
    error !== webviewMicrophoneBlockedMessage() &&
    (permission === "denied" || isMicrophoneBlocked(error));
  // Known refusals are plain sentences; any other failure keeps its raw text behind Details.
  const rawError = error && !blocked && error !== webviewMicrophoneBlockedMessage() ? error : "";
  const message =
    requestPending && !busy
      ? t("Finish or dismiss the microphone permission prompt to check again.")
      : (rawError ? t("The microphone check failed.") : error) ||
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
      <Row
        id="speech-microphone"
        label={t("Microphone access")}
        descriptionVisible
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
              if (mounted.current) setError(errorText(cause));
            })
          }
          loading={busy}
          disabled={requestPending}
        >
          {permission === "granted" || error ? t("Check again") : t("Check microphone access")}
        </Button>
        {rawError ? <ErrorDetails title={message} detail={rawError} /> : null}
        {busy ? (
          <Button
            onClick={() => {
              attempt.current++;
              captureRequest.current?.abort();
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
