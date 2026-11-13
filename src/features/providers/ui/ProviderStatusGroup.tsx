import { Text } from "../../../shared/ui/Text";
import { useState, useSyncExternalStore } from "react";
import { DataTableRow } from "../../../shared/ui/SortableDataTable";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { Code } from "../../../shared/ui/Code";
import { Heading } from "../../../shared/ui/Heading";
import {
  ArrowDownCircle,
  RefreshCw,
  Check,
  CircleHelp,
  Minus,
  Bot,
} from "../../../shared/ui/icons";
import { hasProbedHarnessAvailability } from "../../../integrations/harness/core/availability";
import { HARNESS_TITLE, type HarnessId } from "../../../shared/model/harnessIdentity";
import { HarnessIcon } from "../../sessions/public/HarnessIcon";
import { SettingsFeedback } from "../../settings/ui/settingsControls";
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
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../model/harnessUpdateActions";
/** Account detail identity; CLI facts live in the CLI tab. */
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
            ? `${t("Sign-in")}: ${grokAuth.label}`
            : signInCompleted
              ? t("CLI sign-in completed")
              : `${t("Sign-in")}: ${t("Not checked")}`}
        </Text>
      ) : null}
    </header>
  );
}
/** Detail below the line: why an update failed, or what a finished one left unverified. */
function updateNotice(
  state: HarnessUpdateRun,
  check: HarnessVersionCheck | undefined,
): { state: "error" | "warning"; text: string } | null {
  if (state.status === "failed") return { state: "error", text: state.error };
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
 * Sign-in, plan or limit state, and the CLI version with its update state and refresh, in the
 * order a person checks them when something does not work.
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
    if (rowChecking || checking) return;
    setRowChecking(true);
    void checkHarnessVersions({
      harnesses: [harness],
      installedVersion: async (id) => {
        const inspection = await inspectHarnessBinary(id);
        if (!inspection.version)
          throw new Error(inspection.error ?? "The CLI reported no version.");
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
  const notice = updateNotice(run, check);
  const notFound = hasProbedHarnessAvailability() && !available;
  const canCheck = UPDATABLE_HARNESSES.has(harness);
  const busy = canCheck && (checking || rowChecking);
  const version = check && check.status !== "unknown" ? check.installed : "—";
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
    busy || run.status === "updating"
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
    <DataTableRow
      id={id}
      data-setting-id={`cli-path-${harness}`}
      className="provider-inventory-row"
      cells={[
        <span key="name" className="provider-inventory-name">
          {harness === "acp" ? (
            <Bot className="icon-md shrink-0" aria-hidden />
          ) : (
            <HarnessIcon harness={harness} className="icon-md shrink-0" />
          )}
          <Text size="secondary" tone={notFound ? "secondary" : "primary"} truncate>
            {title}
          </Text>
        </span>,
        <Code key="version" size="caption" tone="secondary" className="tabular-nums">
          {version}
        </Code>,
        <Tooltip key="status" label={hint}>
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
        </Tooltip>,
        <div key="actions" className="provider-inventory-actions">
          {check?.status === "behind" ? (
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
          {!notFound && canCheck ? (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              label={t("Check for updates")}
              tooltip={t("Check for updates")}
              loading={busy}
              disabled={busy}
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
        </div>,
      ]}
      detail={
        notice || (check?.status === "unknown" && !notFound && canCheck) ? (
          <>
            {notice ? (
              <SettingsFeedback state={notice.state}>{notice.text}</SettingsFeedback>
            ) : null}
            {check?.status === "unknown" && !notFound && canCheck ? (
              <SettingsFeedback state="warning">
                {t("Could not check: {p0}", { p0: check.error })}
              </SettingsFeedback>
            ) : null}
          </>
        ) : null
      }
    />
  );
}
