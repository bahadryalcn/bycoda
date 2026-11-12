import { Text } from "../../../shared/ui/Text";
import { useState, useSyncExternalStore } from "react";
import { RelativeSessionTime } from "../../../app/shell/RelativeSessionTime";
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
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { SettingsFeedback } from "../../settings/ui/settingsControls";
import {
  checkHarnessVersions,
  fetchLatestHarnessVersion,
  type HarnessVersionCheck,
} from "../model/harnessUpdates";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { ProviderBinaryControl } from "../../settings/ui/ProviderBinarySettings";

import {
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../model/harnessUpdateActions";
/** Account detail identity; CLI facts live in the CLI tab. */
export function ProviderDetailHeader({
  harness,
  signInCompleted,
}: {
  harness: HarnessId;
  available: boolean;
  signInCompleted?: boolean;
}) {
  useLocale();
  return (
    <header className="provider-detail-header">
      <HarnessIcon harness={harness} className="icon-lg shrink-0" />
      <Heading size="page" level={3} className="provider-detail-title">
        {HARNESS_TITLE[harness]}
      </Heading>
      {harness === "cursor" || harness === "grok" ? (
        <Text as="span" size="caption" tone="secondary">
          {signInCompleted ? t("CLI sign-in completed") : `${t("Sign-in")}: ${t("Unknown")}`}
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
  if (state.catalogRefresh === "unchanged") {
    return {
      state: "warning",
      text: t("CLI updated to {p0}. The model list did not change, so it may be out of date.", {
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
  harness,
  available,
  checkedAt,
  onCheck: _checkAll,
  onRowCheck,
  onSetup: _onSetup,
}: {
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
  const busy = checking || rowChecking;
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
  return (
    <div className="provider-inventory-entry">
      <div className="provider-inventory-row" data-missing={notFound || undefined}>
        <span className="provider-inventory-name">
          {harness === "acp" ? (
            <Bot className="icon-md shrink-0" aria-hidden />
          ) : (
            <HarnessIcon harness={harness} className="icon-md shrink-0" />
          )}
          <Text size="secondary" tone={notFound ? "secondary" : "primary"} truncate>
            {title}
          </Text>
        </span>
        <Code size="caption" tone="secondary" className="provider-inventory-version">
          {version}
        </Code>
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
          {check?.status === "behind" ? (
            <>
              {" "}
              · <Code size="inherit">{check.latest}</Code>
            </>
          ) : !notFound && version !== "—" ? (
            <Code size="inherit" className="provider-inventory-inline-version">
              {" "}
              · {version}
            </Code>
          ) : null}
        </Badge>
        <Text size="caption" tone="secondary" className="provider-inventory-checked">
          {notFound ? null : lastChecked != null ? <RelativeSessionTime at={lastChecked} /> : "—"}
        </Text>
        <div className="provider-inventory-actions">
          {check?.status === "behind" ? (
            <Button
              size="sm"
              variant="primary"
              tone="accent"
              onClick={() => void runHarnessUpdate(check)}
              loading={run.status === "updating"}
              disabled={run.status === "updating"}
              aria-label={t("Update {p0} to {p1}", { p0: title, p1: check.latest })}
            >
              {t("Update")}
            </Button>
          ) : null}
          {!notFound ? (
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
        </div>
      </div>
      {notice ? <SettingsFeedback state={notice.state}>{notice.text}</SettingsFeedback> : null}
      {check?.status === "unknown" && !notFound ? (
        <SettingsFeedback state="warning">
          {t("Could not check: {p0}", { p0: check.error })}
        </SettingsFeedback>
      ) : null}
    </div>
  );
}
