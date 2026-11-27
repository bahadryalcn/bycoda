import { Code } from "../../../../shared/ui/Code";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { Button } from "../../../../shared/ui/Button";
import { CopyButton } from "../../../../shared/ui/CopyButton";
import { ErrorDetails } from "../../../../shared/ui/ErrorDetails";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { ExternalLink } from "../../../../shared/ui/icons";
import { SettingsFeedback } from "../../../../shared/ui/settings";
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
  | { kind: "failed"; title: string; detail?: string };

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
  const [browserError, setBrowserError] = useState<string | null>(null);
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
    const fail = (title: string, detail?: string) => {
      if (live()) setPhase({ kind: "failed", title, detail });
    };
    const tick = async () => {
      try {
        const result = await pollMicrosoftDeviceSignIn(start.handle);
        if (!live()) return;
        if (result.status === "done") {
          setPhase({ kind: "done" });
          signedInCallback(start.handle);
        } else if (result.status === "expired") {
          fail(t("The sign-in code expired. Start sign-in again."), result.error || undefined);
        } else if (result.status === "denied") {
          fail(t("Microsoft sign-in was declined."), result.error || undefined);
        } else if (elapsedSince(startedAt) >= lifetimeMs) {
          fail(t("The sign-in code expired. Start sign-in again."));
        } else {
          timer = window.setTimeout(schedule, intervalMs);
        }
      } catch (err: unknown) {
        fail(t("Microsoft sign-in could not be completed."), errorText(err));
      }
    };
    const schedule = () => {
      tick().catch(() => undefined);
    };
    timer = window.setTimeout(schedule, intervalMs);
    return () => window.clearTimeout(timer);
  }, [phase, signedInCallback]);

  const openSignIn = (start: MicrosoftDeviceStart, generation: number) => {
    setBrowserError(null);
    void openExternal(start.verificationUri).catch((error: unknown) => {
      if (request.current === generation) setBrowserError(errorText(error));
    });
  };

  const begin = async () => {
    if (phase.kind === "starting" || disabled) return;
    const generation = ++request.current;
    setPhase({ kind: "starting" });
    try {
      const start = await startMicrosoftDeviceSignIn(purpose, clientId, tenant);
      if (generation !== request.current) return;
      setPhase({ kind: "waiting", start });
      openSignIn(start, generation);
    } catch (err: unknown) {
      if (generation === request.current)
        setPhase({
          kind: "failed",
          title: t("Microsoft sign-in could not start."),
          detail: errorText(err),
        });
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
        <p>
          <Code
            variant="plain"
            size="title"
            weight="medium"
            tracking="wider"
            tone="primary"
            className="integration-device-code"
          >
            {start.userCode}
          </Code>
        </p>
        <div className="integration-actions">
          <CopyButton label={t("Copy code")} text={start.userCode} resetKeys={[start.userCode]} />
          <Button
            variant="ghost"
            startIcon={<ExternalLink className="icon-sm" />}
            onClick={() => openSignIn(start, request.current)}
          >
            {t("Open again")}
          </Button>
          <Button onClick={cancel}>{t("Cancel")}</Button>
        </div>
        <LoadingText delay={false}>{t("Waiting for you to finish signing in…")}</LoadingText>
        {browserError ? (
          <SettingsFeedback
            state="error"
            extra={
              <ErrorDetails
                title={t("The sign-in page could not be opened.")}
                detail={browserError}
              />
            }
          >
            {t("The sign-in page could not be opened.")}
          </SettingsFeedback>
        ) : null}
      </div>
    );
  }

  return (
    <div className="integration-device">
      <div className="integration-actions">
        <Button
          stableWidth
          loading={phase.kind === "starting"}
          loadingLabel={t("Starting sign-in…")}
          disabled={disabled}
          disabledReason={t("Wait for the current operation to finish")}
          onClick={() => {
            begin().catch(() => undefined);
          }}
        >
          {signedIn || phase.kind === "done" ? t("Sign in again") : t("Sign in with Microsoft")}
        </Button>
      </div>
      {phase.kind === "failed" ? (
        <SettingsFeedback
          state="error"
          extra={
            phase.detail && phase.detail !== phase.title ? (
              <ErrorDetails title={phase.title} detail={phase.detail} />
            ) : undefined
          }
        >
          {phase.title}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
