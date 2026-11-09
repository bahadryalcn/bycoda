import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../../shared/i18n";
import { useStableCallback } from "../../../../shared/hooks/useStableCallback";
import { elapsedSince, monotonicNow } from "../../../../shared/lib/time/timestamps";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { Button } from "../../../../shared/ui/Button";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { ExternalLink } from "../../../../shared/ui/icons";
import { SettingsFeedback } from "../settingsControls";
import {
  cancelBrowserSignIn,
  pollBrowserSignIn,
  startBrowserSignIn,
  type BrowserSignInPurpose,
  type BrowserSignInStart,
} from "../../../messaging";
import { errorText } from "../../../../shared/lib/errors";

const POLL_INTERVAL_MS = 1500;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; start: BrowserSignInStart }
  | { kind: "done"; identity: string }
  | { kind: "failed"; message: string };

/** Another way to connect, offered under the sign-in and again when sign-in fails. */
export type SignInFallback = { hint: string; action: string; onSelect: () => void };

const signInLabel = (purpose: BrowserSignInPurpose) =>
  purpose === "google" ? t("Sign in with Google") : t("Sign in with Slack");

/** Asks native code to stop listening for a sign-in nobody will finish. */
function release(handle: string) {
  cancelBrowserSignIn(handle).catch(() => undefined);
}

/**
 * Browser sign-in (Google, Slack). Native code owns the loopback listener and the tokens; this
 * opens the authorize URL, polls the handle and hands the caller only the handle to attach on save.
 * Polling stops on done, denial, expiry, failure, cancel or unmount; a pending request is cancelled.
 */
export function BrowserSignIn({
  purpose,
  clientId,
  clientSecret,
  loginHint,
  disabled = false,
  signedIn = false,
  fallback,
  onSignedIn,
}: {
  purpose: BrowserSignInPurpose;
  clientId?: string;
  /** Sent with the start call only; never stored in account settings. */
  clientSecret?: string;
  loginHint?: string;
  disabled?: boolean;
  /** Tokens already exist (saved account or finished flow); the action reads "Sign in again". */
  signedIn?: boolean;
  /** The provider may refuse sign-in on its own page and never redirect back. */
  fallback?: SignInFallback;
  onSignedIn: (handle: string, identity: string) => void;
}) {
  useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const request = useRef(0);
  const pending = useRef<string | null>(null);
  const signedInCallback = useStableCallback(onSignedIn);

  useEffect(
    () => () => {
      request.current += 1;
      if (pending.current) release(pending.current);
      pending.current = null;
    },
    [],
  );

  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const { start } = phase;
    const generation = request.current;
    const startedAt = monotonicNow();
    const lifetimeMs = Math.max(1, start.expiresIn) * 1000;
    let timer: number | undefined;
    const live = () => generation === request.current;
    const fail = (message: string) => {
      if (!live()) return;
      pending.current = null;
      setPhase({ kind: "failed", message });
    };
    const tick = async () => {
      try {
        const result = await pollBrowserSignIn(start.handle);
        if (!live()) return;
        if (result.status === "done") {
          pending.current = null;
          const identity = result.identity ?? "";
          setPhase({ kind: "done", identity });
          signedInCallback(start.handle, identity);
        } else if (result.status === "expired") {
          fail(result.error || t("The sign-in request expired. Start sign-in again."));
        } else if (result.status === "denied") {
          fail(result.error || t("Sign-in was declined in the browser."));
        } else if (result.status === "failed") {
          fail(result.error || t("Sign-in failed. Start sign-in again."));
        } else if (elapsedSince(startedAt) >= lifetimeMs) {
          release(start.handle);
          fail(t("The sign-in request expired. Start sign-in again."));
        } else {
          timer = window.setTimeout(schedule, POLL_INTERVAL_MS);
        }
      } catch (err: unknown) {
        release(start.handle);
        fail(errorText(err));
      }
    };
    const schedule = () => {
      tick().catch(() => undefined);
    };
    timer = window.setTimeout(schedule, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase, signedInCallback]);

  const openBrowser = (start: BrowserSignInStart, generation: number) => {
    openExternal(start.authorizeUrl).catch((err: unknown) => {
      if (generation !== request.current) return;
      release(start.handle);
      pending.current = null;
      setPhase({ kind: "failed", message: errorText(err) });
    });
  };

  const begin = async () => {
    if (phase.kind === "starting" || disabled) return;
    if (pending.current) release(pending.current);
    pending.current = null;
    const generation = ++request.current;
    setPhase({ kind: "starting" });
    try {
      const start = await startBrowserSignIn(purpose, { clientId, clientSecret, loginHint });
      if (generation !== request.current) {
        release(start.handle);
        return;
      }
      pending.current = start.handle;
      setPhase({ kind: "waiting", start });
      openBrowser(start, generation);
    } catch (err: unknown) {
      if (generation === request.current) setPhase({ kind: "failed", message: errorText(err) });
    }
  };

  const cancel = () => {
    request.current += 1;
    if (pending.current) release(pending.current);
    pending.current = null;
    setPhase({ kind: "idle" });
  };

  const fallbackAction = fallback ? (
    <Button variant="link" onClick={fallback.onSelect}>
      {fallback.action}
    </Button>
  ) : null;
  const fallbackLine =
    fallback && phase.kind !== "failed" ? (
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {fallback.hint} {fallbackAction}
      </p>
    ) : null;

  if (phase.kind === "waiting") {
    const { start } = phase;
    return (
      <div className="integration-device">
        <LoadingText delay={false}>{t("Finish signing in in your browser…")}</LoadingText>
        <div className="integration-actions">
          <Button
            startIcon={<ExternalLink className="icon-sm" />}
            onClick={() => openBrowser(start, request.current)}
          >
            {t("Open again")}
          </Button>
          <Button onClick={cancel}>{t("Cancel")}</Button>
        </div>
        {fallbackLine}
      </div>
    );
  }

  return (
    <div className="integration-device">
      <div className="integration-actions">
        <Button
          variant={signedIn || phase.kind === "done" ? "secondary" : "primary"}
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
              : signInLabel(purpose)}
        </Button>
      </div>
      {phase.kind === "done" && phase.identity ? (
        <SettingsFeedback state="success">
          {t("Signed in as {p0}", { p0: phase.identity })}
        </SettingsFeedback>
      ) : null}
      {phase.kind === "failed" ? (
        <SettingsFeedback state="error" action={fallbackAction ?? undefined}>
          {phase.message}
        </SettingsFeedback>
      ) : null}
      {fallbackLine}
    </div>
  );
}
