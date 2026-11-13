import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Sheet } from "../../../shared/ui/Sheet";
import { Text } from "../../../shared/ui/Text";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { openPrivacySettings } from "../../../platform/tauri/privacySettings";
import {
  closePermissionHelper,
  requestSystemPermission,
  showPermissionHelper,
  type PermissionId,
} from "../../../platform/tauri/systemPermissions";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import {
  permissionBadge,
  permissionInfo,
  permissionInstructions,
  permissionReady,
} from "../model/permissions";

export function PermissionSetupSheet({ id, onClose }: { id: PermissionId; onClose: () => void }) {
  const {
    report,
    entries: [entry],
    failed,
    loading,
    refresh,
  } = usePermissionStatus([id], true);
  const [busy, setBusy] = useState<"request" | "settings" | "check" | null>(null);
  const [acted, setActed] = useState(false);
  const [error, setError] = useState(false);
  const [observedBlocked, setObservedBlocked] = useState(false);
  const close = useRef(onClose);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const ready = permissionReady(entry.state);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns the auto-close timer that fires after the OS reports the grant this sheet waited for
  useEffect(() => {
    // Observe an actual OS transition before showing restart advice or auto-closing.
    close.current = onClose;
    if (!ready) {
      if (entry.state !== "unknown" && entry.state !== "not-required") setObservedBlocked(true);
      return;
    }
    if (!observedBlocked) return;
    const timer = window.setTimeout(() => close.current(), id === "screen-recording" ? 3500 : 1400);
    return () => window.clearTimeout(timer);
  }, [ready, id, onClose, observedBlocked, entry.state]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- closes the native macOS helper window when this sheet unmounts
  useEffect(() => {
    // A dismissed guide must not leave its native helper on screen.
    mounted.current = true;
    return () => {
      mounted.current = false;
      void closePermissionHelper().catch(() => {});
    };
  }, []);
  async function act(request: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(request ? "request" : "settings");
    setError(false);
    try {
      if (request) await requestSystemPermission(id);
      else {
        await openPrivacySettings(id);
        if (mounted.current && report?.platform === "macos") {
          await showPermissionHelper(id);
          if (!mounted.current) await closePermissionHelper();
        }
      }
      if (mounted.current) {
        setActed(true);
        await refresh();
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function check() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("check");
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  const status =
    failed || (!loading && entry.state === "unknown")
      ? t("Permission status is unavailable. Check again from the desktop app.")
      : entry.state === "unknown" && loading
        ? t("Checking permission status…")
        : ready
          ? t("Access is ready")
          : entry.state === "restricted"
            ? t("Access is restricted by system policy. Contact your administrator.")
            : acted
              ? t("Waiting for access")
              : permissionBadge(entry.state).label;
  return (
    <Sheet title={permissionInfo(id).label} onClose={onClose} motion="none">
      <div className="flex flex-col gap-4">
        {entry.canRequest && (
          <>
            <Text as="p">{t("Ask for access")}</Text>
            <Text as="p" tone="secondary">
              {t("bycoda asks your operating system for access. Choose Allow if a prompt appears.")}
            </Text>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {entry.canRequest && (
            <Button
              loading={busy === "request"}
              disabled={busy !== null}
              onClick={() => void act(true)}
            >
              {t("Allow")}
            </Button>
          )}
          {entry.canOpenSettings && (
            <Button
              loading={busy === "settings"}
              disabled={busy !== null}
              onClick={() => void act(false)}
            >
              {t("Open Settings")}
            </Button>
          )}
        </div>
        {entry.canOpenSettings && entry.state !== "restricted" && (
          <>
            <Text as="p">{t("Change the system setting")}</Text>
            <Text as="p" tone="secondary">
              {permissionInstructions(id, report?.platform)}
            </Text>
          </>
        )}
        <Text as="p">{t("Check access")}</Text>
        <InlineMessage tone={ready ? "success" : "neutral"}>{status}</InlineMessage>
        {ready && observedBlocked && id === "screen-recording" && report?.platform === "macos" && (
          <InlineMessage>
            {t("macOS now allows screen recording. If capture still fails, restart bycoda.")}
          </InlineMessage>
        )}
        {error && (
          <InlineError>
            {t(
              "Could not open the permission prompt or settings. Follow the steps above, then check again.",
            )}
          </InlineError>
        )}
        <Button
          loading={busy === "check"}
          loadingLabel={t("Checking…")}
          disabled={busy !== null}
          onClick={() =>
            void check().catch(() => {
              if (mounted.current) setError(true);
            })
          }
        >
          {t("Check again")}
        </Button>
      </div>
    </Sheet>
  );
}
