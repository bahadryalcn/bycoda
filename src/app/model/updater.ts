import { t } from "../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { announceUpdateAvailable } from "../../features/settings/model/sounds";
import { rememberInstalledUpdate } from "./updateNotice";
import { appName } from "../../shared/lib/appName";

export type UpdaterPhase = "idle" | "checking" | "current" | "available" | "downloading" | "error";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
};

let pendingUpdate: Update | null = null;

function isUpdaterNotConfiguredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /updater does not have any endpoints set/i.test(text);
}

// Enable only after an independent signed feed is configured for this product.
// Development, previous-product and unknown identities never contact a feed.
const PRODUCT_IDENTIFIER = "com.bycoda.desktop";

export async function isUpdaterEnabled(): Promise<boolean> {
  if (!PRODUCT_IDENTITY.updaterEnabled) return false;
  try {
    const identifier = await getIdentifier();
    return identifier === PRODUCT_IDENTIFIER;
  } catch {
    return false;
  }
}

export const UPDATES_DISABLED_MESSAGE =
  "Automatic updates are disabled in this build. Rebuild from source to update (see docs/reference/fork.md).";

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

export async function probeForUpdate(): Promise<Update | null> {
  if (!(await isUpdaterEnabled())) return null;
  const update = await check();
  pendingUpdate = update;
  if (update) announceUpdateAvailable(update.version);
  return update;
}

export async function runUpdateFlow(
  manual: boolean,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  if (!(await isUpdaterEnabled())) {
    pendingUpdate = null;
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    onProgress?.(idle);
    if (manual) {
      await message(UPDATES_DISABLED_MESSAGE, { title: appName() });
    }
    return idle;
  }
  const base: UpdaterSnapshot = { phase: "checking", currentVersion };
  onProgress?.(base);

  try {
    const update = await check();
    if (!update) {
      pendingUpdate = null;
      const current: UpdaterSnapshot = { phase: "current", currentVersion };
      onProgress?.(current);
      if (manual) {
        await message(t("You're on the latest version."), { title: appName() });
      }
      return current;
    }

    pendingUpdate = update;
    announceUpdateAvailable(update.version);
    const available: UpdaterSnapshot = {
      phase: "available",
      currentVersion,
      availableVersion: update.version,
    };
    onProgress?.(available);

    if (!manual) return available;

    const notes = update.body?.trim();
    const detail = notes ? `\n\n${notes}` : "";
    const yes = await ask(
      t("{p0} {p1} is available (you have {p2}).{p3}\n\nInstall now?", {
        p0: PRODUCT_IDENTITY.displayName,
        p1: update.version,
        p2: currentVersion,
        p3: detail,
      }),
      {
        get title() {
          return t("Update available");
        },
        kind: "info",
      },
    );
    if (!yes) return available;

    return installPendingUpdate(onProgress);
  } catch (err) {
    if (isUpdaterNotConfiguredError(err)) {
      pendingUpdate = null;
      const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
      onProgress?.(idle);
      if (manual) {
        await message(
          PRODUCT_IDENTITY.repositoryUrl
            ? `Automatic updates aren't configured for this build.\n\nVisit ${PRODUCT_IDENTITY.repositoryUrl} for product information.`
            : UPDATES_DISABLED_MESSAGE,
          { title: appName() },
        );
      }
      return idle;
    }

    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = { phase: "error", currentVersion, error };
    onProgress?.(failed);
    if (manual) {
      await message(t("Couldn't check for updates.\n\n{p0}", { p0: error }), {
        title: appName(),
      });
    }
    return failed;
  }
}

export async function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const update = pendingUpdate;
  if (!update) {
    const idle: UpdaterSnapshot = { phase: "idle", currentVersion };
    onProgress?.(idle);
    return idle;
  }

  let downloaded = 0;
  let contentLength = 0;

  const downloading: UpdaterSnapshot = {
    phase: "downloading",
    currentVersion,
    availableVersion: update.version,
    progress: 0,
  };
  onProgress?.(downloading);

  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }

      const progress =
        contentLength > 0
          ? Math.min(100, Math.round((downloaded / contentLength) * 100))
          : undefined;

      onProgress?.({
        phase: "downloading",
        currentVersion,
        availableVersion: update.version,
        progress,
      });
    });

    rememberInstalledUpdate(update.version);
    pendingUpdate = null;
    await relaunch();
    return {
      phase: "current",
      currentVersion: update.version,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const failed: UpdaterSnapshot = {
      phase: "error",
      currentVersion,
      availableVersion: update.version,
      error,
    };
    onProgress?.(failed);
    await message(t("Couldn't install the update.\n\n{p0}", { p0: error }), {
      title: appName(),
    });
    return failed;
  }
}
