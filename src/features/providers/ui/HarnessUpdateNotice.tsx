import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { TransientNotice } from "../../../shared/ui/TransientNotice";
import { Check, Loader } from "../../../shared/ui/icons";
import { isPickerProviderVisible } from "../../sessions/model/models";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import {
  checkInstalledHarnessVersions,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../model/harnessUpdateActions";
import {
  claimLaunchHarnessUpdateCheck,
  onHarnessUpdated,
  pendingHarnessUpdates,
  type HarnessUpdate,
} from "../model/harnessUpdates";

/**
 * Shared by every mount in this window: a StrictMode remount must reuse the
 * first run, since the launch claim it made cannot be taken twice.
 */
let launchCheck: Promise<HarnessUpdate[]> | null = null;

function checkForHarnessUpdates(): Promise<HarnessUpdate[]> {
  launchCheck ??= runLaunchCheck().catch(() => []);
  return launchCheck;
}

/**
 * Unprompted, so a harness whose lookup failed is left out silently. Every
 * installed harness is checked so Settings can list them all, but the toast
 * offers only those shown in the model picker.
 */
async function runLaunchCheck(): Promise<HarnessUpdate[]> {
  if (!(await claimLaunchHarnessUpdateCheck())) return [];
  return pendingHarnessUpdates(await checkInstalledHarnessVersions()).filter((update) =>
    isPickerProviderVisible(update.harness),
  );
}

/** Checked once per app launch, in whichever window asks first. */
export function HarnessUpdateNotice({
  topOffset = 12,
  onHeightChange,
}: {
  topOffset?: number;
  onHeightChange?: (height: number) => void;
}) {
  useLocale();
  const [updates, setUpdates] = useState<HarnessUpdate[]>([]);
  const { runs } = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );

  // Mounted in every window, so the window that ran the update tells the
  // others to pick up the new CLI's models too.
  useEffect(() => {
    const unlisten = onHarnessUpdated((harness) => {
      void refreshHarnessCatalogs([harness], { force: true });
    }).catch(() => undefined);
    return () => {
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void checkForHarnessUpdates().then((next) => {
      if (!cancelled) setUpdates(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = updates.length > 0;
  if (!visible) return null;

  const stateOf = (harness: HarnessId): HarnessUpdateRun => runs[harness] ?? { status: "idle" };
  const pending = updates.filter((update) => {
    const status = stateOf(update.harness).status;
    return status === "idle" || status === "failed";
  });
  const anyUpdated = updates.some((update) => stateOf(update.harness).status === "updated");
  const allUpdated = updates.every((update) => stateOf(update.harness).status === "updated");

  const start = (targets: HarnessUpdate[]) => {
    for (const update of targets) void runHarnessUpdate(update);
  };
  const dismiss = () => {
    // Only for this run: the next launch checks and offers again.
    launchCheck = Promise.resolve([]);
    setUpdates([]);
  };

  return (
    <TransientNotice
      aria-label={t("Harness updates")}
      tone="info"
      title={updates.length === 1 ? t("Harness update available") : t("Harness updates available")}
      durationMs={allUpdated ? 5000 : null}
      placement="top-end"
      width="lg"
      offset={topOffset}
      onDismiss={dismiss}
      onHeightChange={onHeightChange}
      actions={
        pending.length > 1 ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => start(pending)}>
            {t("Update all")}
          </Button>
        ) : null
      }
    >
      <div className="divide-y divide-stroke">
        {updates.map((update) => (
          <HarnessUpdateRow
            key={update.harness}
            update={update}
            state={stateOf(update.harness)}
            onUpdate={() => start([update])}
          />
        ))}
      </div>
      <p className="pt-2 text-ui-micro text-(--ui-text-muted)">
        {anyUpdated
          ? t("Model picker refreshed with the new version’s models.")
          : t("New models often need the latest version.")}
      </p>
    </TransientNotice>
  );
}

function HarnessUpdateRow({
  update,
  state,
  onUpdate,
}: {
  update: HarnessUpdate;
  state: HarnessUpdateRun;
  onUpdate: () => void;
}) {
  useLocale();
  return (
    <article className="py-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <HarnessIcon harness={update.harness} className="icon-md shrink-0" />
            <span className="min-w-0 break-words text-ui-secondary font-medium">
              {HARNESS_TITLE[update.harness]}
            </span>
          </div>
          {state.status !== "updated" ? (
            <div className="pt-1 font-mono text-ui-micro tabular-nums text-(--ui-text-muted)">
              {update.installed} → {update.latest}
            </div>
          ) : null}
        </div>
        {state.status === "updated" ? (
          <span className="flex flex-wrap items-center justify-end gap-1 text-ui-micro tabular-nums text-success">
            <Check className="icon-sm" />
            {t("Updated to ")}
            {state.version}
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={state.status === "updating"}
            className="inline-flex shrink-0 items-center gap-1.5"
            onClick={onUpdate}
          >
            {state.status === "updating" ? (
              <>
                <Loader className="icon-xs animate-spin" />
                {t("Updating")}
              </>
            ) : state.status === "failed" ? (
              t("Retry")
            ) : (
              t("Update")
            )}
          </Button>
        )}
      </div>
      {state.status === "failed" ? (
        <Alert tone="danger" role="alert">
          <div className="max-h-40 overflow-auto whitespace-pre-wrap">{state.error}</div>
        </Alert>
      ) : null}
    </article>
  );
}
