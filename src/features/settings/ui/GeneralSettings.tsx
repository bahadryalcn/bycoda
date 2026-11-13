import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useState, useSyncExternalStore } from "react";
import { openFeedbackDialog } from "../../account";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SettingsFeedback } from "./settingsControls";
import {
  installPendingUpdate,
  isUpdaterEnabled,
  knownAppVersionState,
  knownUpdaterEnabledState,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../../../app/model/updater";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import {
  setDomainLanguagePreference,
  setLanguagePreference,
  LANGUAGE_STORAGE_KEY,
  DOMAIN_LANGUAGE_STORAGE_KEYS,
  t,
  useLocale,
} from "../../../shared/i18n";
import { Select } from "../../../shared/ui/Select";
import { Progress } from "../../../shared/ui/Progress";
import { ArrowDownCircle, MessageSquare, RefreshCw } from "../../../shared/ui/icons";
import { OPEN_ONBOARDING_EVENT } from "../../onboarding/model/onboarding";
import { openUsageGuide } from "../../onboarding/model/usageGuide";
import { getTourSnapshot, startTour, subscribeTour } from "../../onboarding/model/tourState";
import { OPEN_SESSION_IMPORT_EVENT } from "../../sessions/public/importModel";
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
import { UpdateChannelRow } from "./UpdateChannelRow";
import { SessionFolderGroup, restoreSessionFolderDefault } from "./SessionFolderSettings";
import { NewProjectFolderGroup, restoreNewProjectFolderDefault } from "./NewProjectFolderSettings";
import { DiagnosticsGroup, restorePerformanceTraceDefault } from "./DiagnosticsSettings";
import { Group, Row, Toggle, useSettingsPageReset } from "./settingsControls";
import { ProductDetails } from "./GeneralProductDetails";
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
    const results = await Promise.allSettled(
      [
        () => {
          if (IS_WIN) {
            onCloseToTray(CLOSE_TO_TRAY_DEFAULT);
            return loadCloseToTray() === CLOSE_TO_TRAY_DEFAULT;
          }
        },
        () => {
          saveKeepAwakeEnabled(KEEP_AWAKE_DEFAULT);
          return loadKeepAwakeEnabled() === KEEP_AWAKE_DEFAULT;
        },
        () => {
          saveKeepAwakeHoldAfter(KEEP_AWAKE_HOLD_AFTER_DEFAULT);
          return loadKeepAwakeHoldAfter() === KEEP_AWAKE_HOLD_AFTER_DEFAULT;
        },
        () => {
          saveKeepAwakeScreen(KEEP_AWAKE_SCREEN_DEFAULT);
          return loadKeepAwakeScreen() === KEEP_AWAKE_SCREEN_DEFAULT;
        },
        restorePerformanceTraceDefault,
        restoreNewProjectFolderDefault,
        restoreSessionFolderDefault,
        async () => {
          await setLanguagePreference("system");
          const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
          return saved === null || saved === "system";
        },
        ...(["git", "technical"] as const).map((domain) => async () => {
          await setDomainLanguagePreference(domain, "en");
          const saved = localStorage.getItem(DOMAIN_LANGUAGE_STORAGE_KEYS[domain]);
          return saved === null || saved === "en";
        }),
      ].map(async (reset) => reset()),
    );
    if (results.some((result) => result.status === "rejected" || result.value === false)) {
      throw new Error(t("Some settings could not be reset. Retry to finish restoring defaults."));
    }
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
          <Select
            hideLabel
            label={t("Stay awake after an agent ends")}
            value={keepAwakeHoldAfter}
            options={[...KEEP_AWAKE_HOLD_AFTER]}
            onValueChange={onKeepAwakeHoldAfter}
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
        <Row
          id="send-feedback"
          label={t("Send feedback")}
          description={t(
            "Report a problem or suggest an improvement. Nothing is attached unless you add it.",
          )}
        >
          <Button
            className="general-action shrink-0"
            startIcon={<MessageSquare strokeWidth={1.75} aria-hidden />}
            onClick={openFeedbackDialog}
          >
            {t("Send feedback")}
          </Button>
        </Row>
      </Group>

      <SessionFolderGroup />

      <NewProjectFolderGroup />

      <DiagnosticsGroup />

      <Group title={t("About")}>
        <ProductDetails />
      </Group>
    </div>
  );
}

export function UpdateRow({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  useLocale();
  const [snapshot, setSnapshot] = useState<UpdaterSnapshot>({
    phase: "idle",
    currentVersion: knownAppVersionState() ?? "…",
  });

  // Unknown until the identifier resolves (first visit only); only the official build updates.
  const [updatesEnabled, setUpdatesEnabled] = useState<boolean | null>(
    () => knownUpdaterEnabledState() ?? null,
  );
  const [metadataError, setMetadataError] = useState(false);
  const [metadataAttempt, setMetadataAttempt] = useState(0);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns cancellable native build reads for this mounted update row and retry attempt.
  useEffect(() => {
    let cancelled = false;
    setMetadataError(false);
    void readAppVersion()
      .then((currentVersion) => {
        if (cancelled) return;
        setSnapshot((current) => ({ ...current, currentVersion }));
      })
      .catch(() => {
        if (!cancelled) setMetadataError(true);
      });
    void isUpdaterEnabled()
      .then((enabled) => {
        if (!cancelled) setUpdatesEnabled(enabled);
      })
      .catch(() => {
        if (!cancelled) setMetadataError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [metadataAttempt]);

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
    } catch (cause) {
      setSnapshot((current) => ({
        ...current,
        phase: "error",
        error: cause instanceof Error ? cause.message : t("Update check failed."),
      }));
    } finally {
      setFlowBusy(false);
    }
  };

  // Until support is known the line shows the neutral default instead of a flash of "Checking…".
  const status =
    updatesEnabled === false
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
    <>
      <Row
        id="update"
        label={
          <span className="flex min-w-0 flex-wrap items-baseline gap-2">
            {t("Version")}
            <Text
              as="span"
              size="secondary"
              tone="secondary"
              leading="inherit"
              className="general-version"
            >
              {snapshot.currentVersion}
            </Text>
          </span>
        }
        description={snapshot.phase === "idle" && updatesEnabled !== false ? status : undefined}
        feedback={
          <>
            {metadataError ? (
              <SettingsFeedback
                state="error"
                action={
                  <Button onClick={() => setMetadataAttempt((attempt) => attempt + 1)}>
                    {t("Retry")}
                  </Button>
                }
              >
                {t("Could not read update information. Retry to check this build.")}
              </SettingsFeedback>
            ) : null}
            {snapshot.phase !== "idle" || updatesEnabled === false ? (
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
              disabled={
                busy || metadataError || snapshot.currentVersion === "…" || updatesEnabled !== true
              }
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
      {updatesEnabled ? <UpdateChannelRow /> : null}
    </>
  );
}
