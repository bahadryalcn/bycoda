import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyText } from "../../../platform/tauri/clipboard";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SettingsFeedback } from "./settingsControls";
import {
  installPendingUpdate,
  isUpdaterEnabled,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../../../app/model/updater";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import {
  setDomainLanguagePreference,
  setLanguagePreference,
  t,
  useLocale,
} from "../../../shared/i18n";
import { MorphSelect } from "../../../shared/ui/MorphSelect";
import { Progress } from "../../../shared/ui/Progress";
import { ArrowDownCircle, Check, Copy, RefreshCw } from "../../../shared/ui/icons";
import { OPEN_ONBOARDING_EVENT } from "../../onboarding/model/onboarding";
import { openUsageGuide } from "../../onboarding/model/usageGuide";
import { getTourSnapshot, startTour, subscribeTour } from "../../onboarding/model/tourState";
import { OPEN_SESSION_IMPORT_EVENT } from "../../sessions/import/importModel";
import {
  CLOSE_TO_TRAY_DEFAULT,
  KEEP_AWAKE_DEFAULT,
  KEEP_AWAKE_SCREEN_DEFAULT,
  KEEP_AWAKE_HOLD_AFTER,
  KEEP_AWAKE_HOLD_AFTER_DEFAULT,
  isKeepAwakeHoldAfter,
  loadCloseToTray,
  subscribeCloseToTray,
  loadKeepAwakeEnabled,
  loadKeepAwakeHoldAfter,
  loadKeepAwakeScreen,
  saveCloseToTray,
  saveKeepAwakeEnabled,
  saveKeepAwakeHoldAfter,
  saveKeepAwakeScreen,
  subscribeKeepAwakeEnabled,
  subscribeKeepAwakeHoldAfter,
  subscribeKeepAwakeScreen,
} from "../model/settings";
import { LanguageSettings } from "./LanguageSettings";
import { BuildIdentityDetails } from "./BuildIdentityDetails";
import { DiagnosticsGroup, restorePerformanceTraceDefault } from "./DiagnosticsSettings";
import { Group, Row, Toggle, useSettingsPageReset } from "./settingsControls";
import "./GeneralSettings.css";

export function GeneralPage({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  useLocale();
  // A tour left part-way is resumed from where it stopped.
  const tourState = useSyncExternalStore(subscribeTour, getTourSnapshot, () => "");
  const [closeToTray, setCloseToTray] = useStoredPreferenceState(
    loadCloseToTray,
    subscribeCloseToTray,
  );
  const onCloseToTray = (next: boolean) => {
    saveCloseToTray(next);
    setCloseToTray(next);
  };
  const keepAwake = useSyncExternalStore(
    subscribeKeepAwakeEnabled,
    loadKeepAwakeEnabled,
    () => false,
  );
  const keepAwakeHoldAfter = useSyncExternalStore(
    subscribeKeepAwakeHoldAfter,
    loadKeepAwakeHoldAfter,
    () => KEEP_AWAKE_HOLD_AFTER_DEFAULT,
  );
  const keepAwakeScreen = useSyncExternalStore(
    subscribeKeepAwakeScreen,
    loadKeepAwakeScreen,
    () => false,
  );
  const onKeepAwake = (next: boolean) => {
    saveKeepAwakeEnabled(next);
  };
  const onKeepAwakeHoldAfter = (next: string) => {
    if (isKeepAwakeHoldAfter(next)) saveKeepAwakeHoldAfter(next);
  };
  const onKeepAwakeScreen = (next: boolean) => {
    saveKeepAwakeScreen(next);
  };
  // The shell confirms first; this restores only the settings on this page.
  useSettingsPageReset(async () => {
    if (IS_WIN) onCloseToTray(CLOSE_TO_TRAY_DEFAULT);
    saveKeepAwakeEnabled(KEEP_AWAKE_DEFAULT);
    saveKeepAwakeHoldAfter(KEEP_AWAKE_HOLD_AFTER_DEFAULT);
    saveKeepAwakeScreen(KEEP_AWAKE_SCREEN_DEFAULT);
    restorePerformanceTraceDefault();
    await Promise.allSettled([
      setLanguagePreference("system"),
      setDomainLanguagePreference("git", "app"),
      setDomainLanguagePreference("technical", "app"),
    ]);
  });
  const sleepBehavior = IS_WIN
    ? t(
        "Prevent idle sleep during agent work, and optionally after the last agent finishes. Closing the lid or choosing Sleep still works. On battery-powered Modern Standby PCs, Windows may stop the request five minutes after the sleep timeout.",
      )
    : IS_MAC
      ? t(
          "Prevent idle sleep during agent work, and optionally after the last agent finishes. Closing the lid or choosing Sleep still works.",
        )
      : t(
          "Prevent idle sleep during agent work, and optionally after the last agent finishes. Automatic screen locking remains available. On GNOME, choosing Sleep may be blocked while this is active.",
        );
  return (
    <div className="general-settings settings-topics">
      {/* Daily preferences first: language, app behavior, sleep. */}
      <LanguageSettings />
      {IS_WIN && (
        <Group title={t("Application behavior")}>
          <Row
            id="close-to-tray"
            label={t("Close to tray")}
            description={t(
              "Keep agents running when you close the window. Reopen or quit the app from the tray icon.",
            )}
          >
            <Toggle label={t("Close to tray")} on={closeToTray} onChange={onCloseToTray} />
          </Row>
        </Group>
      )}
      <Group
        title={t("Sleep")}
        description={t("Applies to this computer, not remote computers running agents.")}
      >
        <Row
          id="keep-awake"
          label={t("Prevent sleep while agents work")}
          description={t("Keep this computer awake while an agent is working.")}
          info={
            <InfoPopover className="shrink-0" label={t("Sleep behavior")}>
              <p>{sleepBehavior}</p>
            </InfoPopover>
          }
        >
          <Toggle
            label={t("Prevent sleep while agents work")}
            on={keepAwake}
            onChange={onKeepAwake}
          />
        </Row>
        <Row
          id="keep-awake-duration"
          label={t("After agents finish")}
          description={t(
            "Choose when this computer can sleep again after the last agent finishes.",
          )}
          dependsOn={keepAwake}
          disabledReason={t("Turn on Prevent sleep while agents work first")}
        >
          <MorphSelect
            label={t("Stay awake after an agent ends")}
            value={keepAwakeHoldAfter}
            options={[...KEEP_AWAKE_HOLD_AFTER]}
            onChange={onKeepAwakeHoldAfter}
            disabled={!keepAwake}
          />
        </Row>
        <Row
          id="keep-awake-screen"
          label={t("Keep the screen on")}
          description={t("Keep the display awake while sleep prevention is active.")}
          dependsOn={keepAwake}
          disabledReason={t("Turn on Prevent sleep while agents work first")}
        >
          <Toggle
            label={t("Keep the screen on")}
            on={keepAwakeScreen}
            onChange={onKeepAwakeScreen}
            disabled={!keepAwake}
          />
        </Row>
      </Group>

      {/* Updates: version, check/install/restart state and progress share one compact action area. */}
      <Group title={t("Updates")}>
        <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
      </Group>

      {/* Secondary: setup help, diagnostics and product details. */}
      <Group title={t("Setup and help")}>
        <Row
          id="import-history"
          label={t("Import history")}
          description={t(
            "Choose Claude Code and Codex conversations to import. Originals stay unchanged.",
          )}
        >
          <Button
            className="general-action shrink-0"
            onClick={() => window.dispatchEvent(new Event(OPEN_SESSION_IMPORT_EVENT))}
          >
            {t("Import…")}
          </Button>
        </Row>
        <Row
          id="getting-started"
          label={t("Getting started")}
          description={t(
            "Take a one-minute tour, or connect computers, set up agents and choose your projects.",
          )}
        >
          <div className="flex shrink-0 items-center gap-2">
            {/* The tour request closes Settings and points at the workspace controls. */}
            <Button className="general-action shrink-0" onClick={() => startTour("first-run")}>
              {tourState.startsWith("paused:") ? t("Resume tour") : t("Take the tour")}
            </Button>
            <Button
              className="general-action shrink-0"
              onClick={() => window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT))}
            >
              {t("Open setup…")}
            </Button>
          </div>
        </Row>
        <Row
          id="usage-guide"
          label={t("Usage guide")}
          description={t("Learn chat, queue, stop and essential shortcuts.")}
        >
          {/* The guide request closes Settings and walks through the workspace. */}
          <Button className="general-action shrink-0" onClick={openUsageGuide}>
            {t("Open guide…")}
          </Button>
        </Row>
      </Group>

      <DiagnosticsGroup />

      <Group title={t("About")}>
        <ProductDetails />
      </Group>
    </div>
  );
}
function ProductDetails() {
  return (
    <>
      <Row label={t("Developed by")}>
        <span className="general-about-value">{PRODUCT_IDENTITY.developerName}</span>
      </Row>
      <ProductLink
        label={t("Website")}
        address={PRODUCT_IDENTITY.websiteUrl}
        href={PRODUCT_IDENTITY.websiteUrl}
        displayAddress={PRODUCT_IDENTITY.websiteUrl.replace("https://", "")}
        openLabel={t("Open website")}
      />
      <ProductLink
        label={t("Contact")}
        address={PRODUCT_IDENTITY.contactEmail}
        href={`mailto:${PRODUCT_IDENTITY.contactEmail}`}
      />
      <ProductLink
        label={t("Developer contact")}
        address={PRODUCT_IDENTITY.developerContactEmail}
        href={`mailto:${PRODUCT_IDENTITY.developerContactEmail}`}
      />
    </>
  );
}

/** Each target owns its pending/error recovery; opening a link never sends a message. */
function ProductLink({
  label,
  address,
  href,
  displayAddress = address,
  openLabel,
}: {
  label: string;
  address: string;
  href: string;
  displayAddress?: string;
  openLabel?: string;
}) {
  const [pending, setPending] = useState<"open" | "retry" | "copy" | null>(null);
  const [failure, setFailure] = useState<"open" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const linkControl = useRef<HTMLButtonElement>(null);
  const recoveryActions = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (pending !== null || failure !== null || !returnFocus.current) return;
    returnFocus.current = false;
    linkControl.current?.focus();
  }, [pending, failure]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const run = async (operation: "open" | "retry" | "copy") => {
    if (inFlight.current) return;
    inFlight.current = true;
    const beganInRecovery = Boolean(recoveryActions.current?.contains(document.activeElement));
    returnFocus.current = false;
    setPending(operation);
    setCopied(false);
    try {
      if (operation !== "copy") await openUrl(href);
      else {
        await copyText(address);
        setCopied(true);
      }
      // Recovery controls disappear on success; retain focus only if it is still there.
      returnFocus.current =
        beganInRecovery &&
        (document.activeElement === document.body ||
          Boolean(recoveryActions.current?.contains(document.activeElement)));
      setFailure(null);
    } catch {
      setFailure(operation === "copy" ? "copy" : "open");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  return (
    <Row
      label={label}
      feedback={
        failure ? (
          <SettingsFeedback
            state="error"
            action={
              <div ref={recoveryActions} className="flex flex-wrap items-center gap-2">
                {failure === "open" ? (
                  <Button
                    disabled={pending !== null}
                    loading={pending === "retry"}
                    loadingLabel={t("Opening…")}
                    onClick={() => void run("retry")}
                  >
                    {t("Retry")}
                  </Button>
                ) : null}
                <Button
                  disabled={pending !== null}
                  loading={pending === "copy"}
                  loadingLabel={t("Copying…")}
                  aria-label={`${t("Copy")}: ${address}`}
                  onClick={() => void run("copy")}
                >
                  {t("Copy")}
                </Button>
              </div>
            }
          >
            <p>
              {failure === "open"
                ? t("Could not open the link. Copy the address and open it manually.")
                : t("Could not copy. Select the details and copy them manually.")}
            </p>
            <span className="select-text break-all">{address}</span>
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Button
        ref={linkControl}
        variant="link"
        className="general-about-link"
        loading={pending === "open"}
        loadingLabel={t("Opening…")}
        disabled={pending !== null}
        tooltip={
          address.replace(/^https?:\/\//, "") === displayAddress.replace(/^https?:\/\//, "")
            ? undefined
            : address
        }
        onClick={() => void run("open")}
      >
        {displayAddress}
      </Button>
      {failure ? null : (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={`${t("Copy")}: ${address}`}
          tooltip={copied ? t("Copied") : t("Copy")}
          disabled={pending !== null}
          loading={pending === "copy"}
          onClick={() => void run("copy")}
        >
          {copied ? (
            <Check aria-hidden className="icon-xs" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden className="icon-xs" strokeWidth={1.75} />
          )}
        </Button>
      )}
      {openLabel ? (
        <Button
          size="sm"
          disabled={pending !== null}
          loading={pending === "open"}
          loadingLabel={t("Opening…")}
          onClick={() => void run("open")}
        >
          {openLabel}
        </Button>
      ) : null}
      <span role="status" className="sr-only">
        {copied ? t("Copied") : ""}
      </span>
    </Row>
  );
}
export function UpdateRow({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  useLocale();
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: "…",
  });

  // Unknown until the identifier resolves; only the official build updates.
  const [updatesEnabled, setUpdatesEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readAppVersion().then((currentVersion) => {
      if (cancelled) return;
      setSnapshot((current) => ({ ...current, currentVersion }));
    }).catch(() => {});
    void isUpdaterEnabled().then((enabled) => {
      if (!cancelled) setUpdatesEnabled(enabled);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [flowBusy, setFlowBusy] = useState(false);
  const busy = flowBusy || snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = async () => {
    if (busy) return;
    setFlowBusy(true);
    try {
      if (hasUpdate) {
        await installPendingUpdate(setSnapshot);
        return;
      }
      await runUpdateFlow(true, setSnapshot);
    } finally {
      setFlowBusy(false);
    }
  };

  const status =
    updatesEnabled === null
      ? t("Checking whether this build supports updates…")
      : updatesEnabled === false
        ? t("Automatic updates are disabled in this build.")
        : snapshot.phase === "available"
          ? t("Version {p0} is available. Downloading installs it and restarts the app.", {
              p0: snapshot.availableVersion ?? "",
            })
          : snapshot.phase === "downloading"
            ? snapshot.progress != null
              ? t("Downloading {p0}%… The app restarts after installation.", {
                  p0: snapshot.progress,
                })
              : t("Downloading… The app restarts after installation.")
            : snapshot.phase === "checking"
              ? t("Checking for updates…")
              : snapshot.phase === "current"
                ? t("You're on the latest version.")
                : snapshot.phase === "error"
                  ? (snapshot.error ?? t("Update check failed."))
                  : t("Check for a newer version.");

  return (
    <Row
      id="update"
      label={
        <span className="flex min-w-0 flex-wrap items-baseline gap-2">
          {t("Version")}
          <span className="general-version">{snapshot.currentVersion}</span>
        </span>
      }
      description={snapshot.phase === "idle" && updatesEnabled === true ? status : undefined}
      feedback={
        <>
          {snapshot.phase !== "idle" || updatesEnabled !== true ? (
            <SettingsFeedback
              state={
                snapshot.phase === "error"
                  ? "error"
                  : updatesEnabled === false || hasUpdate
                    ? "warning"
                    : snapshot.phase === "current"
                      ? "success"
                      : "loading"
              }
            >
              {status}
            </SettingsFeedback>
          ) : null}
          <BuildIdentityDetails />
        </>
      }
    >
      <div className="general-update-actions">
        <Button
          className="shrink-0"
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          {t("What's new")}
        </Button>
        {updatesEnabled === false ? null : (
          <Button
            className="shrink-0"
            stableWidth
            onClick={() => void onClick()}
            disabled={busy || updatesEnabled !== true}
            loading={busy}
            startIcon={
              hasUpdate ? (
                <ArrowDownCircle strokeWidth={1.75} aria-hidden />
              ) : (
                <RefreshCw strokeWidth={1.75} aria-hidden />
              )
            }
          >
            {hasUpdate ? t("Install and restart") : t("Check for updates")}
          </Button>
        )}
        {snapshot.phase === "downloading" ? (
          <Progress
            compact
            label={t("Downloading…")}
            value={snapshot.progress ?? undefined}
            max={100}
            className="w-32"
          />
        ) : null}
      </div>
    </Row>
  );
}
