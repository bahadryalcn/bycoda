import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { Row } from "../settings/ui/settingsControls";
import { desktopHelperRequest } from "./desktopControlClient";
import type { DesktopHelperResponse } from "../../shared/model/host-contracts/desktop-helper";
import { InlineError } from "../../shared/ui/InlineError";
import { Badge } from "../../shared/ui/Badge";

type VerifiedHelper = NonNullable<DesktopHelperResponse["helper"]>;

/**
 * The "Helper" row. It only discovers until an owner or `autoPrepare` starts the same pinned,
 * checksum-verified preparation. `autoPrepare` (computer use switched on) prepares a missing
 * helper once and offers the verified helper to an empty selection; it never enables control.
 */
export function DesktopHelperSetup({
  disabled,
  autoPrepare = false,
  selectedPath = "",
  onUse,
  onPendingChange,
  onReadyChange,
}: {
  disabled?: boolean;
  autoPrepare?: boolean;
  /** Currently selected helper path. An empty selection receives the verified helper automatically. */
  selectedPath?: string;
  onUse: (helper: VerifiedHelper) => void;
  onPendingChange?: (pending: boolean) => void;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [state, setState] = useState<DesktopHelperResponse>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const preparing = pending || state?.phase === "preparing";
  const helper = state?.phase === "ready" ? state.helper : undefined;
  const attempted = useRef(false);
  const applied = useRef(false);
  useEffect(() => {
    onPendingChange?.(preparing);
    return () => onPendingChange?.(false);
  }, [onPendingChange, preparing]);
  useEffect(() => {
    onReadyChange?.(!!helper);
  }, [onReadyChange, helper]);
  useEffect(() => {
    let cancelled = false,
      reading = false;
    const read = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await desktopHelperRequest({ op: "status" });
        if (!cancelled) {
          setState(next);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reading = false;
      }
    };
    // ast-grep-ignore: ts-void-promise-without-catch -- read() reports its own failures
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  async function act(op: "prepare" | "cancel") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      setState(await desktopHelperRequest({ op }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    if (!autoPrepare) {
      attempted.current = false;
      return;
    }
    if (!state || pending || attempted.current || state.phase === "ready") return;
    attempted.current = true;
    // Deferred one microtask so the pending state is set from a callback, not the effect body.
    if (state.phase !== "preparing")
      void Promise.resolve()
        .then(() => act("prepare"))
        .catch(() => undefined);
  }, [autoPrepare, pending, state]);
  useEffect(() => {
    if (!autoPrepare || applied.current || !helper || selectedPath) return;
    applied.current = true;
    onUse(helper);
  }, [autoPrepare, helper, onUse, selectedPath]);
  const message = error || state?.error;
  const failed = !helper && !preparing && (!!message || state?.phase === "interrupted");
  const label = preparing
    ? t("Preparing…")
    : helper
      ? t("Ready")
      : failed
        ? t("Error")
        : state
          ? t("Not installed")
          : t("Checking…");
  return (
    <Row label={t("Helper")} feedback={message ? <InlineError>{message}</InlineError> : undefined}>
      <Badge
        role="status"
        tone={preparing ? "info" : helper ? "success" : failed ? "danger" : "neutral"}
      >
        {label}
      </Badge>
      {preparing ? (
        <Button type="button" loading={pending} onClick={() => void act("cancel")}>
          {t("Cancel preparation")}
        </Button>
      ) : helper ? (
        selectedPath !== helper.binaryPath && (
          <Button type="button" disabled={disabled} onClick={() => onUse(helper)}>
            {t("Use verified helper")}
          </Button>
        )
      ) : (
        (state || message) && (
          <Button type="button" disabled={disabled} onClick={() => void act("prepare")}>
            {t("Retry")}
          </Button>
        )
      )}
    </Row>
  );
}
