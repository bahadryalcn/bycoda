import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import { copyText } from "../../../../platform/tauri/clipboard";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { Button } from "../../../../shared/ui/Button";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Copy, ExternalLink } from "../../../../shared/ui/icons";
import { SettingsFeedback } from "../settingsControls";
import {
  pollMicrosoftDeviceSignIn,
  startMicrosoftDeviceSignIn,
  type MicrosoftDevicePurpose,
  type MicrosoftDeviceStart,
} from "../../../messaging";
import { errorText } from "../../../../shared/lib/errors";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; start: MicrosoftDeviceStart }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/**
 * Microsoft device-code sign-in. Tokens stay native: a finished flow hands the caller only the
 * handle to attach on save. Polling follows the returned interval and stops on done, expiry,
 * denial, cancel or unmount.
 */
export function MicrosoftDeviceSignIn({
  purpose,
  clientId,
  tenant,
  disabled = false,
  signedIn = false,
  onSignedIn,
}: {
  purpose: MicrosoftDevicePurpose;
  clientId?: string;
  tenant?: string;
  disabled?: boolean;
  /** Tokens already exist (saved account or finished flow); the action reads "Sign in again". */
  signedIn?: boolean;
  onSignedIn: (handle: string) => void;
}) {
  useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const request = useRef(0);
  const signedInCallback = useStableCallback(onSignedIn);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { start } = phase;
    const generation = request.current;
    const startedAt = monotonicNow();
    const intervalMs = Math.max(1, start.interval || 5) * 1000;
    const lifetimeMs = Math.max(1, start.expiresIn) * 1000;
    let timer: number | undefined;
    const live = () => generation === request.current;
    const fail = (message: string) => {
      if (live()) setPhase({ kind: "failed", message });
    };
    const tick = async () => {
      try {
        const result = await pollMicrosoftDeviceSignIn(start.handle);
        if (!live()) return;
        if (result.status === "done") {
          setPhase({ kind: "done" });
          signedInCallback(start.handle);
        } else if (result.status === "expired") {
          fail(result.error || t("The sign-in code expired. Start sign-in again."));
        } else if (result.status === "denied") {
          fail(result.error || t("Microsoft sign-in was declined."));
        } else if (elapsedSince(startedAt) >= lifetimeMs) {
          fail(t("The sign-in code expired. Start sign-in again."));
        } else {
          timer = window.setTimeout(schedule, intervalMs);
        }
      } catch (err: unknown) {
        fail(errorText(err));
      }
    };
    const schedule = () => {
      tick().catch(() => undefined);
    };
    timer = window.setTimeout(schedule, intervalMs);
    return () => window.clearTimeout(timer);
  }, [phase, signedInCallback]);

  const begin = async () => {
    if (phase.kind === "starting" || disabled) return;
    const generation = ++request.current;
    setCopied(false);
    setPhase({ kind: "starting" });
    try {
      const start = await startMicrosoftDeviceSignIn(purpose, clientId, tenant);
      if (generation === request.current) setPhase({ kind: "waiting", start });
    } catch (err: unknown) {
      if (generation === request.current) setPhase({ kind: "failed", message: errorText(err) });
    }
  };

  const cancel = () => {
    request.current += 1;
    setPhase({ kind: "idle" });
  };

  if (phase.kind === "waiting") {
    const { start } = phase;
    return (
      <div className="integration-device">
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("Open the Microsoft sign-in page and enter this code:")}
        </p>
        <p className="integration-device-code">{start.userCode}</p>
        <div className="integration-actions">
          <Button
            stableWidth
            reserveLabels={[t("Copied")]}
            startIcon={<Copy className="icon-sm" />}
            onClick={() => {
              copyText(start.userCode).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? t("Copied") : t("Copy code")}
          </Button>
          <Button
            variant="primary"
            startIcon={<ExternalLink className="icon-sm" />}
            onClick={() => {
              openExternal(start.verificationUri).catch((err: unknown) =>
                setPhase({ kind: "failed", message: errorText(err) }),
              );
            }}
          >
            {t("Open sign-in page")}
          </Button>
          <Button onClick={cancel}>{t("Cancel")}</Button>
        </div>
        <LoadingText delay={false}>{t("Waiting for you to finish signing in…")}</LoadingText>
      </div>
    );
  }

  return (
    <div className="integration-device">
      <div className="integration-actions">
        <Button
          stableWidth
          reserveLabels={[t("Starting sign-in…")]}
          loading={phase.kind === "starting"}
          disabled={disabled}
          onClick={() => {
            begin().catch(() => undefined);
          }}
        >
          {phase.kind === "starting"
            ? t("Starting sign-in…")
            : signedIn || phase.kind === "done"
              ? t("Sign in again")
              : t("Sign in with Microsoft")}
        </Button>
      </div>
      {phase.kind === "failed" ? (
        <SettingsFeedback state="error">{phase.message}</SettingsFeedback>
      ) : null}
    </div>
  );
}
