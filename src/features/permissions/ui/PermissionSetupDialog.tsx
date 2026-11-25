import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Text } from "../../../shared/ui/Text";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { openPrivacySettings } from "../../../platform/tauri/privacySettings";
import {
  closePermissionHelper,
  requestSystemPermission,
  revealPermissionApp,
  showPermissionHelper,
  type PermissionId,
} from "../../../platform/tauri/systemPermissions";
import { usePermissionStatus } from "../hooks/usePermissionStatus";
import {
  permissionBadge,
  permissionCanAddAppInSettings,
  permissionInfo,
  permissionInstructions,
  permissionMayNeedRestart,
  permissionNeedsRestart,
  permissionReady,
} from "../model/permissions";
import { PermissionRestartButton } from "./PermissionRestartButton";

/**
 * Guides one permission: the status line first, then the step and one row of
 * actions with a single primary (restart, Allow or Open settings).
 */
export function PermissionSetupDialog({ id, onClose }: { id: PermissionId; onClose: () => void }) {
  const {
    report,
    entries: [entry],
    failed,
    loading,
    refresh,
  } = usePermissionStatus([id], true);
  const [busy, setBusy] = useState<"request" | "settings" | "finder" | "check" | null>(null);
  const [acted, setActed] = useState(false);
  const [error, setError] = useState<typeof busy>(null);
  const [observedBlocked, setObservedBlocked] = useState(false);
  const close = useRef(onClose);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const helper = useRef<number | null>(null);
  const ready = permissionReady(entry.state);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns the auto-close timer after the OS reports the grant
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
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- tracks the dialog lifetime for pending OS operations
  useEffect(() => {
    // A pending OS action can finish after the dialog was dismissed.
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (helper.current !== null) {
        void closePermissionHelper(helper.current).catch(() => {});
      }
    };
  }, []);
  async function run(action: NonNullable<typeof busy>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      if (action === "finder") {
        await revealPermissionApp();
        return;
      }
      if (action === "request") await requestSystemPermission(id);
      if (action === "settings") {
        await openPrivacySettings(id);
        if (mounted.current && permissionCanAddAppInSettings(id, report?.platform)) {
          // Settings is already open. The dialog still offers Finder if the optional card fails.
          const generation = await showPermissionHelper(id).catch(() => null);
          if (mounted.current) helper.current = generation;
          else if (generation !== null) void closePermissionHelper(generation).catch(() => {});
        }
      }
      if (!mounted.current) return;
      if (action !== "check") setActed(true);
      await refresh();
    } catch {
      if (mounted.current) setError(action);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  const pendingRestart = !failed && permissionNeedsRestart(entry);
  // The read may not see a switch made in System Settings until the restart.
  const offerRestart =
    !ready &&
    !failed &&
    (pendingRestart || (acted && permissionMayNeedRestart(id, report?.platform)));
  const blocked = !ready && entry.state !== "restricted" && !pendingRestart;
  const showSettings = blocked && entry.canOpenSettings;
  const canAddApp = showSettings && permissionCanAddAppInSettings(id, report?.platform);
  const showAllow = blocked && entry.canRequest && !canAddApp;
  const showCheck =
    !ready && !pendingRestart && (acted || failed || error || (!showAllow && !showSettings));
  const status = failed
    ? t("Permission status is unavailable. Check again from the desktop app.")
    : entry.state === "unknown" && loading
      ? t("Checking permission status…")
      : entry.state === "unknown"
        ? t("This system does not report this permission.")
        : ready
          ? t("Access is ready")
          : pendingRestart
            ? t("Restart {p0} to apply access.", { p0: PRODUCT_IDENTITY.displayName })
            : entry.state === "restricted"
              ? t("Access is restricted by system policy. Contact your administrator.")
              : acted
                ? t("Waiting for access")
                : permissionBadge(entry.state).label;
  const tone = ready ? "success" : pendingRestart ? "warning" : "neutral";
  return (
    <Modal
      title={permissionInfo(id).label}
      onClose={onClose}
      size="sm"
      footer={
        !ready && (offerRestart || showAllow || showSettings || showCheck) ? (
          <>
            {showCheck && (
              <Button
                variant="ghost"
                loading={busy === "check"}
                loadingLabel={t("Checking…")}
                disabled={busy !== null}
                onClick={() => void run("check")}
              >
                {t("Check again")}
              </Button>
            )}
            {showSettings && (
              <Button
                variant={offerRestart || showAllow ? "secondary" : "primary"}
                loading={busy === "settings"}
                disabled={busy !== null}
                onClick={() => void run("settings")}
              >
                {t("Open settings")}
              </Button>
            )}
            {showAllow && (
              <Button
                variant={offerRestart ? "secondary" : "primary"}
                loading={busy === "request"}
                disabled={busy !== null}
                onClick={() => void run("request")}
              >
                {t("Allow")}
              </Button>
            )}
            {offerRestart && <PermissionRestartButton variant="primary" />}
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <InlineMessage tone={tone}>{status}</InlineMessage>
        {showAllow && !showSettings && (
          <Text as="p" tone="secondary">
            {t("bycoda asks your operating system for access. Choose Allow if a prompt appears.")}
          </Text>
        )}
        {showSettings && (
          <Text as="p" tone="secondary">
            {permissionInstructions(id, report?.platform)}
          </Text>
        )}
        {canAddApp && (
          <div className="flex">
            <Button
              variant="link"
              loading={busy === "finder"}
              disabled={busy !== null}
              onClick={() => void run("finder")}
            >
              {t("Reveal bycoda in Finder")}
            </Button>
          </div>
        )}
        {ready && observedBlocked && id === "screen-recording" && report?.platform === "macos" && (
          <InlineMessage>
            {t("macOS now allows screen recording. If capture still fails, restart bycoda.")}
          </InlineMessage>
        )}
        {error && !ready && (
          <InlineError>
            {error === "finder"
              ? t("Could not reveal bycoda in Finder.")
              : error === "check"
                ? t("Permission status is unavailable. Check again from the desktop app.")
                : t(
                    "Couldn’t open the permission prompt or settings. Follow the steps above, then check again.",
                  )}
          </InlineError>
        )}
      </div>
    </Modal>
  );
}
