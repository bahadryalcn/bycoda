import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import { Toast } from "../../../shared/ui/ToastRegion";
import { Check } from "../../../shared/ui/icons";
import { Spinner } from "../../../shared/ui/Spinner";
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
export function HarnessUpdateNotice() {
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
    <Toast
      aria-label={t("Harness updates")}
      tone="info"
      title={updates.length === 1 ? t("Harness update available") : t("Harness updates available")}
      durationMs={allUpdated ? 5000 : null}
      placement="top-end"
      width="lg"
      onDismiss={dismiss}
      actions={
        pending.length > 1 ? (
          <Button variant="ghost" size="sm" type="button" onClick={() => start(pending)}>
            {t("Update all")}
          </Button>
        ) : null
      }
    >
      <div {...surfaceAttributes({ dividers: "stroke" })}>
        {updates.map((update) => (
          <HarnessUpdateRow
            key={update.harness}
            update={update}
            state={stateOf(update.harness)}
            onUpdate={() => start([update])}
          />
        ))}
      </div>
      <Text as="p" size="micro" tone="muted" className="pt-2">
        {anyUpdated
          ? t("CLI version verified. Model discovery can be retried in Providers.")
          : t("New models often need the latest version.")}
      </Text>
    </Toast>
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
            <Text size="secondary" tone="inherit" weight="medium" className="min-w-0 break-words">
              {HARNESS_TITLE[update.harness]}
            </Text>
          </div>
          {state.status !== "updated" ? (
            <Code size="micro" tone="muted" className="block pt-1 tabular-nums">
              {update.installed} → {update.latest}
            </Code>
          ) : null}
        </div>
        {state.status === "updated" ? (
          <Text
            size="micro"
            tone="success"
            className="flex flex-wrap items-center justify-end gap-1 tabular-nums"
          >
            <Check className="icon-sm" />
            {t("Updated to ")}
            {state.version}
          </Text>
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
                <Spinner size="xs" />
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
        <Alert tone="danger">
          <div className="max-h-40 overflow-auto whitespace-pre-wrap">{state.error}</div>
        </Alert>
      ) : null}
    </article>
  );
}
