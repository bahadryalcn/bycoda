import { Text } from "../../../shared/ui/Text";
import { useState, useSyncExternalStore } from "react";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Code } from "../../../shared/ui/Code";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Heading } from "../../../shared/ui/Heading";
import {
  ArrowDownCircle,
  RefreshCw,
  Check,
  CircleX,
  CircleHelp,
  Minus,
} from "../../../shared/ui/icons";
import { hasProbedHarnessAvailability } from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { SettingsFeedback } from "../../../shared/ui/settings";
import {
  UPDATABLE_HARNESSES,
  checkHarnessVersions,
  fetchLatestHarnessVersion,
  type HarnessVersionCheck,
} from "../model/harnessUpdates";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { ProviderBinaryControl } from "../../settings/ui/ProviderBinarySettings";
import { useGrokSignInState } from "./providerStatus";

import {
  cancelHarnessUpdateRun,
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../model/harnessUpdateActions";
import { describeHarnessUpdateFailure } from "../model/harnessUpdateFailure";
/** Account detail identity; CLI facts follow in ProviderStatusGroup. */
export function ProviderDetailHeader({
  harness,
  available,
  signInCompleted,
}: {
  harness: HarnessId;
  available: boolean;
  signInCompleted?: boolean;
}) {
  useLocale();
  const grokAuth = useGrokSignInState(harness === "grok" && available, signInCompleted);
  return (
    <header className="provider-detail-header">
      <HarnessIcon harness={harness} className="icon-lg shrink-0" />
      <Heading size="page" level={3} className="provider-detail-title">
        {HARNESS_TITLE[harness]}
      </Heading>
      {harness === "cursor" || harness === "grok" ? (
        <Text as="span" size="caption" tone="secondary">
          {harness === "grok"
            ? t("Sign-in: {p0}", { p0: grokAuth.label })
            : signInCompleted
              ? t("CLI sign-in completed")
              : t("Sign-in: Not checked")}
        </Text>
      ) : null}
    </header>
  );
}
/** Detail below the line: why an update failed, or what a finished one left unverified. */
function updateNotice(
  harness: HarnessId,
  state: HarnessUpdateRun,
  check: HarnessVersionCheck | undefined,
): { state: "error" | "warning"; text: string; detail?: string } | null {
  if (state.status === "failed") {
    const { headline, detail } = describeHarnessUpdateFailure(harness, state.failure);
    return { state: "error", text: headline, detail };
  }
  if (state.status !== "updated" || check?.status === "behind") return null;
  if (state.catalogRefresh === "failed") {
    return {
      state: "warning",
      text: t("CLI updated to {p0}. Model refresh failed. Retry it in Providers.", {
        p0: state.version,
      }),
    };
  }
  return null;
}
/**
 * The CLI version with its update state, refresh and path actions, shown under the provider's
 * header.
 */
export function ProviderStatusGroup({
  id,
  harness,
  available,
  checkedAt,
  onCheck: _checkAll,
  onRowCheck,
  onSetup: _onSetup,
}: {
  id?: string;
  harness: HarnessId;
  available: boolean;
  /** When this window last finished a version check, if it did. */
  checkedAt: number | null;
  onCheck: () => void;
  onRowCheck?: (check: HarnessVersionCheck) => void;
  /** Takes the person to the Runtime section's CLI setup. */
  onSetup: () => void;
}) {
  useLocale();
  const { checks, checking, runs } = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );
  const [local, setLocal] = useState<{
    check: HarnessVersionCheck;
    checks: typeof checks;
    at: number;
  } | null>(null);
  const [rowChecking, setRowChecking] = useState(false);
  const check =
    local && local.checks === checks
      ? local.check
      : checks?.find((entry) => entry.harness === harness);
  const lastChecked = local && local.checks === checks ? local.at : checkedAt;
  const onCheck = () => {
    if (rowChecking || checking || run.status === "updating") return;
    setRowChecking(true);
    void checkHarnessVersions({
      harnesses: [harness],
      installedVersion: async (id) => {
        const inspection = await inspectHarnessBinary(id);
        if (!inspection.version)
          throw new Error(inspection.error ?? t("The CLI reported no version."));
        return inspection.version;
      },
      latestVersion: fetchLatestHarnessVersion,
    })
      .then((result) => {
        if (result[0]) {
          setLocal({ check: result[0], checks, at: Date.now() });
          onRowCheck?.(result[0]);
        }
      })
      .catch(() => undefined)
      .finally(() => setRowChecking(false));
  };
  const run: HarnessUpdateRun = runs[harness] ?? { status: "idle" };
  const title = HARNESS_TITLE[harness];
  const notice = updateNotice(harness, run, check);
  const notFound = hasProbedHarnessAvailability() && !available;
  const canCheck = UPDATABLE_HARNESSES.has(harness);
  const busy = canCheck && (checking || rowChecking);
  const version = !notFound && check && check.status !== "unknown" ? check.installed : "—";
  const checkLabel = t("{p0}: {p1}", { p0: t("Check for updates"), p1: title });
  const status =
    run.status === "updating"
      ? t("Updating…")
      : run.status === "failed"
        ? t("Update failed")
        : busy
          ? t("Checking…")
          : notFound
            ? t("Not installed")
            : check?.status === "behind"
              ? t("Update available")
              : check?.status === "current"
                ? t("Up to date")
                : !canCheck
                  ? t("Unavailable")
                  : t("Unknown");
  const StatusIcon =
    run.status === "failed"
      ? CircleX
      : busy || run.status === "updating"
        ? RefreshCw
        : notFound
          ? Minus
          : check?.status === "behind"
            ? ArrowDownCircle
            : check?.status === "current"
              ? Check
              : CircleHelp;
  const hint =
    !canCheck && !notFound
      ? t("This CLI has no release feed. Update checks are not available.")
      : lastChecked != null && lastChecked !== checkedAt && !notFound
        ? t("Checked {p0}", { p0: formatRelativeTime(lastChecked) })
        : undefined;
  return (
    <div id={id} data-setting-id={`cli-path-${harness}`} className="provider-cli-status">
      <div className="provider-cli-status-line">
        <Code size="caption" tone="secondary" className="tabular-nums">
          {version}
        </Code>
        <Tooltip label={hint}>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- passive status details must remain reachable by keyboard to open their tooltip */}
          <span tabIndex={hint ? 0 : undefined}>
            <Badge
              size="xs"
              tone={
                busy || notFound
                  ? "neutral"
                  : run.status === "failed"
                    ? "danger"
                    : check?.status === "behind"
                      ? "accent"
                      : check?.status === "current"
                        ? "success"
                        : "neutral"
              }
            >
              <StatusIcon className="icon-xs shrink-0" aria-hidden />
              {status}
            </Badge>
          </span>
        </Tooltip>
        <div className="provider-inventory-actions">
          {!notFound && check?.status === "behind" ? (
            <Button
              size="sm"
              variant="primary"
              tone="accent"
              onClick={() => void runHarnessUpdate(check)}
              loading={run.status === "updating"}
              disabled={run.status === "updating"}
              aria-label={t("Update {p0} to {p1}", { p0: title, p1: check.latest })}
              tooltip={t("Update {p0} to {p1}", { p0: title, p1: check.latest })}
            >
              {t("Update")}
            </Button>
          ) : null}
          {run.status === "updating" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void cancelHarnessUpdateRun(harness).catch(() => undefined)}
            >
              {t("Cancel")}
            </Button>
          ) : null}
          {!notFound && canCheck ? (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={checkLabel}
              tooltip={checkLabel}
              loading={busy}
              disabled={busy || run.status === "updating"}
              onClick={onCheck}
            >
              <RefreshCw className="icon-sm" aria-hidden />
            </Button>
          ) : null}
          <ProviderBinaryControl
            provider={harness}
            missing={notFound}
            showLabel={notFound}
            triggerVariant="ghost"
          />
        </div>
      </div>
      {notice ? (
        <SettingsFeedback
          state={notice.state}
          extra={
            notice.detail ? <ErrorDetails title={notice.text} detail={notice.detail} /> : undefined
          }
        >
          {notice.text}
        </SettingsFeedback>
      ) : null}
      {check?.status === "unknown" && !notFound && canCheck ? (
        <SettingsFeedback state="warning">
          {t("Could not check: {p0}", { p0: check.error })}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
