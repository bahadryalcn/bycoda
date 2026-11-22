import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { useEffect, useState, useSyncExternalStore } from "react";
import { openFeedbackDialog } from "../../account";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SettingsFeedback } from "../../../shared/ui/settings";
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
import {
  ArrowDownCircle,
  BookOpen,
  Download,
  MessageSquare,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
} from "../../../shared/ui/icons";
import { OPEN_ONBOARDING_EVENT } from "../../onboarding/model/onboarding";
import { openUsageGuide } from "../../onboarding/model/usageGuide";
import { getTourSnapshot, startTour, subscribeTour } from "../../onboarding/model/tourState";
import { OPEN_SESSION_IMPORT_EVENT } from "../../sessions/public/importModel";
import {
  MINIMIZE_TO_TRAY_DEFAULT,
  KEEP_AWAKE_DEFAULT,
  KEEP_AWAKE_SCREEN_DEFAULT,
  KEEP_AWAKE_HOLD_AFTER,
  KEEP_AWAKE_HOLD_AFTER_DEFAULT,
  isKeepAwakeHoldAfter,
  loadMinimizeToTray,
  subscribeMinimizeToTray,
  loadKeepAwakeEnabled,
  loadKeepAwakeHoldAfter,
  loadKeepAwakeScreen,
  saveMinimizeToTray,
  saveKeepAwakeScreen,
  subscribeKeepAwakeEnabled,
  subscribeKeepAwakeHoldAfter,
  subscribeKeepAwakeScreen,
} from "../model/settings";
import { saveAgentDefaultConfirmed } from "../model/agentDefaults";
import { LanguageSettings } from "./LanguageSettings";
import { BuildIdentityDetails } from "./BuildIdentityDetails";
import { UpdateChannelRow } from "./UpdateChannelRow";
import { RemoteMediaSettings } from "./RemoteMediaSettings";
import { SessionFolderGroup, restoreSessionFolderDefault } from "./SessionFolderSettings";
import { NewProjectFolderGroup, restoreNewProjectFolderDefault } from "./NewProjectFolderSettings";
import { DiagnosticsGroup, restorePerformanceTraceDefault } from "./DiagnosticsSettings";
import {
  Group,
  Row,
  Toggle,
  useConfirmedPreferences,
  useSettingsPageReset,
} from "../../../shared/ui/settings";
import { ProductDetails } from "./GeneralProductDetails";
import "./GeneralSettings.css";

export function GeneralPage({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  useLocale();
  // A tour left part-way is resumed from where it stopped.
  const tourState = useSyncExternalStore(subscribeTour, getTourSnapshot, () => "");
  const [minimizeToTray, setMinimizeToTray] = useStoredPreferenceState(
    loadMinimizeToTray,
    subscribeMinimizeToTray,
  );
  const onMinimizeToTray = (next: boolean) => {
    saveMinimizeToTray(next);
    setMinimizeToTray(next);
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
  const {
    commit: commitPower,
    pending: powerPending,
    feedback: powerFeedback,
  } = useConfirmedPreferences();
  const onKeepAwake = (next: boolean) => {
    commitPower("keep-awake", {
      write: () => saveAgentDefaultConfirmed("keepAwakeWhileAgentsWork", next),
    });
  };
  const onKeepAwakeHoldAfter = (next: string) => {
    if (isKeepAwakeHoldAfter(next))
      commitPower("keep-awake-duration", {
        write: () => saveAgentDefaultConfirmed("keepAwakeHoldAfter", next),
      });
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
            onMinimizeToTray(MINIMIZE_TO_TRAY_DEFAULT);
            return loadMinimizeToTray() === MINIMIZE_TO_TRAY_DEFAULT;
          }
        },
        async () => {
          if (!(await saveAgentDefaultConfirmed("keepAwakeWhileAgentsWork", KEEP_AWAKE_DEFAULT)))
            return false;
          return loadKeepAwakeEnabled() === KEEP_AWAKE_DEFAULT;
        },
        async () => {
          if (
            !(await saveAgentDefaultConfirmed("keepAwakeHoldAfter", KEEP_AWAKE_HOLD_AFTER_DEFAULT))
          )
            return false;
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
            id="minimize-to-tray"
            label={t("Minimize to tray")}
            description={t("The Minimize button sends this window to the system tray.")}
          >
            <Toggle label={t("Minimize to tray")} on={minimizeToTray} onChange={onMinimizeToTray} />
          </Row>
        </Group>
      )}
      <Group
        title={t("Sleep")}
        description={t("Applies to this computer, not remote computers running agents.")}
      >
        <Row
          id="keep-awake"
          feedback={powerFeedback("keep-awake")}
          label={t("Prevent sleep while agents work")}
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
            disabled={powerPending("keep-awake")}
          />
        </Row>
        <Row
          id="keep-awake-duration"
          feedback={powerFeedback("keep-awake-duration")}
          label={t("After agents finish")}
          dependsOn={keepAwake}
          disabledReason={t("Turn on Prevent sleep while agents work first")}
        >
          <Select
            hideLabel
            label={t("Stay awake after an agent ends")}
            value={keepAwakeHoldAfter}
            options={[...KEEP_AWAKE_HOLD_AFTER]}
            onValueChange={onKeepAwakeHoldAfter}
            disabled={!keepAwake || powerPending("keep-awake-duration")}
          />
        </Row>
        <Row
          id="keep-awake-screen"
          label={t("Keep the screen on")}
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

      <RemoteMediaSettings />

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
            startIcon={<Download strokeWidth={1.75} aria-hidden />}
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
            <Button
              className="general-action shrink-0"
              startIcon={<Play strokeWidth={1.75} aria-hidden />}
              onClick={() => startTour("first-run")}
            >
              {tourState.startsWith("paused:") ? t("Resume tour") : t("Take the tour")}
            </Button>
            <Button
              className="general-action shrink-0"
              startIcon={<Settings strokeWidth={1.75} aria-hidden />}
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
          <Button
            className="general-action shrink-0"
            startIcon={<BookOpen strokeWidth={1.75} aria-hidden />}
            onClick={openUsageGuide}
          >
            {t("Open guide…")}
          </Button>
        </Row>
        <Row
          id="send-feedback"
          label={t("Share an idea or report a problem")}
          info={t(
            "Nothing from your sessions, code, logs or file paths is attached automatically. Do not paste passwords, tokens or other secrets.",
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
                : null;

  return (
    <>
      <Row
        id="update"
        controlWidth="wide"
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
        feedback={
          <div className="grid min-w-0 gap-2">
            {metadataError ? (
              <SettingsFeedback
                state="error"
                action={{
                  label: t("Retry"),
                  onClick: () => setMetadataAttempt((attempt) => attempt + 1),
                }}
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
            {snapshot.phase === "downloading" ? (
              <Progress
                compact
                label={t("Downloading…")}
                value={snapshot.progress ?? undefined}
                max={100}
              />
            ) : null}
            <BuildIdentityDetails />
          </div>
        }
      >
        <Button
          className="shrink-0"
          startIcon={<Sparkles strokeWidth={1.75} aria-hidden />}
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
      </Row>
      {updatesEnabled ? <UpdateChannelRow /> : null}
    </>
  );
}
