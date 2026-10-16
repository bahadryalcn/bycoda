import { useEffect, useState, useSyncExternalStore } from "react";
import {
  installPendingUpdate,
  isUpdaterEnabled,
  readAppVersion,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../../../app/model/updater";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { MorphSelect } from "../../../shared/ui/MorphSelect";
import { ArrowDownCircle, Loader, RefreshCw } from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { OPEN_ONBOARDING_EVENT } from "../../onboarding/model/onboarding";
import { openUsageGuide } from "../../onboarding/model/usageGuide";
import { OPEN_SESSION_IMPORT_EVENT } from "../../sessions/import/importModel";
import {
  KEEP_AWAKE_HOLD_AFTER,
  KEEP_AWAKE_HOLD_AFTER_DEFAULT,
  isKeepAwakeHoldAfter,
  loadCloseToTray,
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
import { Group, Row, Toggle } from "./settingsControls";

export function GeneralPage({ onOpenWhatsNew }: { onOpenWhatsNew: (version: string) => void }) {
  useLocale();
  const [closeToTray, setCloseToTray] = useState(loadCloseToTray);
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
  return (
    <>
      <LanguageSettings />
      {IS_WIN && (
        <Group
          title={t("Application behavior")}
          scope={t("Applies to this Windows computer.")}
          persistence={{ mode: "automatic" }}
        >
          <Row
            id="close-to-tray"
            label={t("Close to tray")}
            description={t(
              "Closing a window hides it to the system tray instead of quitting, so running agents keep going. Reopen from the tray icon, and quit for real from its menu. Turn this off to have close end the window.",
            )}
          >
            <Toggle label={t("Close to tray")} on={closeToTray} onChange={onCloseToTray} />
          </Row>
        </Group>
      )}
      <Group
        title={t("Sleep")}
        scope={t("Applies to this computer, not remote computers running agents.")}
        persistence={{ mode: "automatic" }}
        description={t("Keep this computer awake while an agent is working.")}
      >
        <Row
          id="keep-awake"
          label={t("Prevent sleep while agents work")}
          description={
            IS_WIN
              ? t(
                  "Prevent idle sleep during agent work, and optionally after the last agent finishes. Closing the lid or choosing Sleep still works. On battery-powered Modern Standby PCs, Windows may stop the request five minutes after the sleep timeout.",
                )
              : IS_MAC
                ? t(
                    "Prevent idle sleep during agent work, and optionally after the last agent finishes. Closing the lid or choosing Sleep still works.",
                  )
                : t(
                    "Prevent idle sleep during agent work, and optionally after the last agent finishes. Automatic screen locking remains available. On GNOME, choosing Sleep may be blocked while this is active.",
                  )
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
          dependency={
            !keepAwake
              ? t(
                  "Enable Prevent sleep while agents work to use this option. Your choice is preserved.",
                )
              : undefined
          }
          description={t(
            "Choose when this computer can sleep again after the last agent finishes.",
          )}
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
          dependency={
            !keepAwake
              ? t(
                  "Enable Prevent sleep while agents work to use this option. Your choice is preserved.",
                )
              : undefined
          }
          label={t("Keep the screen on")}
          description={
            IS_WIN || IS_MAC
              ? t(
                  "Keep the display awake while the sleep setting is active. Closing the lid or choosing Sleep still works.",
                )
              : t(
                  "Keep the display awake while the sleep setting is active. Automatic screen locking may be prevented.",
                )
          }
        >
          <Toggle
            label={t("Keep the screen on")}
            on={keepAwakeScreen}
            onChange={onKeepAwakeScreen}
            disabled={!keepAwake}
          />
        </Row>
      </Group>

      <Group
        id="import-history"
        title={t("Import history")}
        description={t(
          "Bring conversations you had in the Claude Code and Codex terminals into {p0}.",
          { p0: PRODUCT_IDENTITY.displayName },
        )}
      >
        <Row
          label={t("Claude Code and Codex sessions")}
          description={t(
            "Lists what is on this computer by folder. Nothing is imported until you choose it, and the originals are never changed.",
          )}
        >
          <SecondaryButton
            onClick={() => window.dispatchEvent(new Event(OPEN_SESSION_IMPORT_EVENT))}
          >
            {t("Import…")}
          </SecondaryButton>
        </Row>
      </Group>

      <Group
        title={t("Setup")}
        description={t("Connect computers, set up agents, and choose your projects.")}
      >
        <Row id="getting-started" label={t("Getting started")} description={t("Reopen the setup guide at any time.")}>
          <SecondaryButton onClick={() => window.dispatchEvent(new Event(OPEN_ONBOARDING_EVENT))}>
            {t("Open setup…")}
          </SecondaryButton>
        </Row>
        <Row
          id="usage-guide"
          label={t("Usage guide")}
          description={t("Learn chat, queue, stop and essential shortcuts.")}
        >
          {/* The guide request closes Settings and walks through the workspace. */}
          <SecondaryButton onClick={openUsageGuide}>{t("Open guide")}</SecondaryButton>
        </Row>
      </Group>

      <Group title={t("About")}>
        <UpdateRow onOpenWhatsNew={onOpenWhatsNew} />
      </Group>
    </>
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
    });
    void isUpdaterEnabled().then((enabled) => {
      if (!cancelled) setUpdatesEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = snapshot.phase === "checking" || snapshot.phase === "downloading";
  const hasUpdate = snapshot.phase === "available";

  const onClick = async () => {
    if (busy) return;
    if (hasUpdate) {
      await installPendingUpdate(setSnapshot);
      return;
    }
    await runUpdateFlow(true, setSnapshot);
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
                  : t(
                      "Check the release feed for an update. Installation requires confirmation and restarts the app.",
                    );

  return (
    <Row
      id="update"
      label={
        <span className="flex items-baseline gap-2">
          {t("Version")}
          <span className="font-mono text-[12px] text-content/45">{snapshot.currentVersion}</span>
        </span>
      }
      description={status}
    >
      <div className="flex items-center gap-2">
        <SecondaryButton
          onClick={() => onOpenWhatsNew(snapshot.currentVersion)}
          disabled={snapshot.currentVersion === "…"}
        >
          {t("What's new")}
        </SecondaryButton>
        {updatesEnabled === false ? null : (
          <SecondaryButton
            onClick={() => void onClick()}
            disabled={busy || updatesEnabled !== true}
          >
            {busy ? (
              <Loader className="size-3.5 motion-safe:animate-spin" aria-hidden />
            ) : hasUpdate ? (
              <ArrowDownCircle className="size-3.5 text-accent" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
            )}
            {hasUpdate ? t("Download") : t("Check for updates")}
          </SecondaryButton>
        )}
      </div>
    </Row>
  );
}
