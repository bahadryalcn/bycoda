import { errorText } from "../../../shared/lib/errors";
import { createStore } from "../../../shared/lib/store";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import {
  cancelHarnessUpdate,
  inspectHarnessBinary,
  updateHarnessCli,
} from "../../../integrations/harness/core/child";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import {
  describeHarnessUpdateFailure,
  HARNESS_UPDATE_BUSY_ERROR,
  type HarnessUpdateFailure,
  type HarnessUpdateStage,
} from "./harnessUpdateFailure";
import { refreshProviderCatalog } from "./catalogReceipts";
import {
  announceHarnessUpdated,
  checkHarnessVersions,
  fetchLatestHarnessVersion,
  isHarnessVersionBehind,
  parseHarnessVersion,
  UPDATABLE_HARNESSES,
  type HarnessUpdate,
  type HarnessVersionCheck,
} from "./harnessUpdates";

/**
 * Outcome of the model-list refresh that follows a verified CLI update:
 * `fresh` a new list landed, `unchanged` the previous list is still shown
 * (not proof of availability), `failed` the refresh itself errored.
 */
export type HarnessCatalogRefresh = "fresh" | "unchanged" | "failed";

export type HarnessUpdateRun =
  | { status: "idle" }
  | { status: "updating" }
  | { status: "updated"; version: string; catalogRefresh?: HarnessCatalogRefresh }
  | { status: "failed"; failure: HarnessUpdateFailure };

export type HarnessUpdateSnapshot = {
  /** Null until this window has checked. */
  checks: HarnessVersionCheck[] | null;
  checking: boolean;
  error?: string | null;
  runs: Partial<Record<HarnessId, HarnessUpdateRun>>;
};

/**
 * One copy per window, read by both the launch toast and Settings, so an
 * update started in one shows its progress in the other.
 */
let snapshot: HarnessUpdateSnapshot = {
  checks: null,
  checking: false,
  runs: {},
};
const listeners = createStore();

function setSnapshot(next: Partial<HarnessUpdateSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.notify();
}

export function getHarnessUpdateSnapshot(): HarnessUpdateSnapshot {
  return snapshot;
}

export function subscribeHarnessUpdates(listener: () => void): () => void {
  return listeners.subscribe(listener);
}

async function installedVersion(harness: HarnessId): Promise<string> {
  const inspection = await inspectHarnessBinary(harness);
  if (inspection.version) return inspection.version;
  throw new Error(inspection.error ?? t("The CLI reported no version."));
}

let inflightCheck: Promise<HarnessVersionCheck[]> | null = null;

/**
 * Checks every installed harness that has a release feed. A call made while
 * a check is running shares its result, unless it forces a fresh probe: the
 * running check may have skipped one, so a forced call runs after it.
 */
export function checkInstalledHarnessVersions(options?: {
  force?: boolean;
}): Promise<HarnessVersionCheck[]> {
  if (inflightCheck && options?.force) {
    return inflightCheck.catch(() => undefined).then(() => checkInstalledHarnessVersions(options));
  }
  inflightCheck ??= (async () => {
    setSnapshot({ checking: true, error: null });
    try {
      await probeHarnessAvailability(options);
      const checks = await checkHarnessVersions({
        harnesses: HARNESSES.filter((id) => UPDATABLE_HARNESSES.has(id) && isHarnessAvailable(id)),
        installedVersion,
        latestVersion: fetchLatestHarnessVersion,
      });
      setSnapshot({ checks });
      return checks;
    } catch (error) {
      setSnapshot({
        error: errorText(error),
      });
      throw error;
    } finally {
      inflightCheck = null;
      setSnapshot({ checking: false });
    }
  })();
  return inflightCheck;
}

const running = new Map<HarnessId, Promise<HarnessUpdateRun>>();
/** Harnesses the user asked to cancel during the updater stage of this window's run. */
const cancelRequested = new Set<HarnessId>();

/**
 * Stops the CLI updater this window started. Resolves false when no updater
 * is running (not started yet, or already in the version check or catalog
 * refresh), so the run continues and reports its real outcome.
 */
export function cancelHarnessUpdateRun(harness: HarnessId): Promise<boolean> {
  if (!running.has(harness)) return Promise.resolve(false);
  cancelRequested.add(harness);
  return cancelHarnessUpdate(harness).then(
    (stopped) => {
      if (!stopped) cancelRequested.delete(harness);
      return stopped;
    },
    (error: unknown) => {
      cancelRequested.delete(harness);
      throw error;
    },
  );
}

/** A second request for a harness already updating waits on the first run. */
export function runHarnessUpdate(update: HarnessUpdate): Promise<HarnessUpdateRun> {
  const current = running.get(update.harness);
  if (current) return current;
  setRun(update.harness, { status: "updating" });
  const run = performUpdate(update).then((result) => {
    running.delete(update.harness);
    cancelRequested.delete(update.harness);
    setRun(update.harness, result);
    if (result.status === "updated") {
      markCurrent(update, result.version);
    }
    // The launch notice may have expired; completion still reaches the owner and notification log.
    // A cancel is the user's own action, so it does not need a toast.
    if (
      result.status === "updated" ||
      (result.status === "failed" && result.failure.kind !== "cancelled")
    ) {
      toast.show({
        id: `harness-update:${update.harness}`,
        title: HARNESS_TITLE[update.harness],
        tone: result.status === "failed" ? "danger" : "success",
        message:
          result.status === "failed"
            ? describeHarnessUpdateFailure(update.harness, result.failure).toastMessage
            : t("Updated to {p0}", { p0: result.version }),
      });
    }
    return result;
  });
  running.set(update.harness, run);
  return run;
}

function setRun(harness: HarnessId, run: HarnessUpdateRun) {
  setSnapshot({ runs: { ...snapshot.runs, [harness]: run } });
}

function markCurrent(update: HarnessUpdate, version: string) {
  if (!snapshot.checks) return;
  setSnapshot({
    checks: snapshot.checks.map((check) =>
      check.harness === update.harness
        ? {
            harness: update.harness,
            status: "current",
            installed: version,
            latest: update.latest,
          }
        : check,
    ),
  });
}

/**
 * Some updaters exit cleanly without installing anything, so success is the
 * version the CLI reports afterwards, not the exit code. Catalog refresh is a
 * separate attempt: adapters may retain old data or report no fresh catalog.
 */
async function performUpdate(update: HarnessUpdate): Promise<HarnessUpdateRun> {
  let stage: HarnessUpdateStage = "updater";
  try {
    await updateHarnessCli(update.harness, update.latest);
    stage = "version check";
    const after = await inspectHarnessBinary(update.harness);
    const version = parseHarnessVersion(update.harness, after.version ?? "");
    if (!version) {
      throw new Error(after.error ?? t("No valid version reported by {p0}.", { p0: after.path }));
    }
    if (!isHarnessVersionBehind(update.harness, version, update.latest)) {
      let catalogRefresh: HarnessCatalogRefresh;
      try {
        const receipt = await refreshProviderCatalog(update.harness, { force: true });
        catalogRefresh =
          receipt.status === "fresh"
            ? "fresh"
            : receipt.status === "error"
              ? "failed"
              : "unchanged";
      } catch {
        catalogRefresh = "failed";
      }
      void announceHarnessUpdated(update.harness).catch(() => undefined);
      return { status: "updated", version, catalogRefresh };
    }
    // Still on the old version: report it as its own failure, not a verified update.
    console.warn(`[bycoda] Harness update failed: ${update.harness} version check: still on ${version}`);
    return { status: "failed", failure: { kind: "stillOn", version } };
  } catch (error) {
    const detail = errorText(error);
    if (stage === "updater" && detail === HARNESS_UPDATE_BUSY_ERROR) {
      return { status: "failed", failure: { kind: "busy" } };
    }
    // Only the updater is cancellable; a failure after it is a real version-check result.
    if (stage === "updater" && cancelRequested.has(update.harness)) {
      return { status: "failed", failure: { kind: "cancelled" } };
    }
    console.warn(`[bycoda] Harness update failed: ${update.harness} ${stage}: ${detail}`);
    return { status: "failed", failure: { kind: "stage", stage, detail } };
  }
}
