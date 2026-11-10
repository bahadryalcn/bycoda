import { useSyncExternalStore } from "react";
import { RelativeSessionTime } from "../../../app/shell/RelativeSessionTime";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { t, useLocale } from "../../../shared/i18n";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import type { CapabilityReadiness } from "../../../shared/ui/CapabilityStatus";
import { Button } from "../../../shared/ui/Button";
import { ArrowDownCircle, RefreshCw } from "../../../shared/ui/icons";
import { hasProbedHarnessAvailability } from "../../../integrations/harness/core/availability";
import { modelsFor } from "../../sessions/model/models";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { Group, Row, SettingsFeedback } from "../../settings/ui/settingsControls";
import { accountUsageKey } from "../model/accountUsage";
import type { HarnessVersionCheck } from "../model/harnessUpdates";
import {
  getHarnessUpdateSnapshot,
  runHarnessUpdate,
  subscribeHarnessUpdates,
  type HarnessUpdateRun,
} from "../model/harnessUpdateActions";
import {
  defaultProviderAccountId,
  providerAccounts,
  supportsProviderAccounts,
} from "../model/providerAccounts";
import { useProviderAccountIdentities } from "../model/providerAccountIdentity";
import { getAllRateLimits, subscribeRateLimits } from "../model/rateLimitsCache";
import { exhaustedExplanation, providerAuthState, type ProviderAuthTone } from "./providerStatus";
import { providerReadiness } from "../model/providerReadiness";

const AUTH_BADGE_TONE: Record<ProviderAuthTone, BadgeTone> = {
  ready: "success",
  low: "warning",
  exhausted: "danger",
  signedOut: "warning",
};

const READINESS_TONE: Record<Exclude<CapabilityReadiness, "unknown">, BadgeTone> = {
  ready: "success",
  unavailable: "danger",
  checking: "neutral",
};
const READINESS_LABEL: Record<Exclude<CapabilityReadiness, "unknown">, () => string> = {
  ready: () => t("Verified ready"),
  unavailable: () => t("Unavailable"),
  checking: () => t("Checking"),
};

/** Provider identity on one row: the icon sits on the title's baseline, meta beside it. */
export function ProviderDetailHeader({
  harness,
  available,
}: {
  harness: HarnessId;
  available: boolean;
}) {
  useLocale();
  const models = modelsFor(harness);
  return (
    <header className="provider-detail-header">
      <HarnessIcon harness={harness} className="icon-lg shrink-0" />
      <h3 className="provider-detail-title">{HARNESS_TITLE[harness]}</h3>
      <span className="provider-detail-meta">
        {available
          ? `${t("CLI detected")} · ${models.length} ${models.length === 1 ? t("model") : t("models")}`
          : hasProbedHarnessAvailability()
            ? t("CLI not found")
            : t("Checking CLI…")}
      </span>
    </header>
  );
}

/** What the update state of one CLI says, in one short line. */
function updateLine(state: HarnessUpdateRun, check: HarnessVersionCheck | undefined): string {
  if (state.status === "updating") return t("Updating…");
  if (state.status === "failed") return t("Update failed.");
  if (!check) return t("Not checked yet");
  if (check.status === "unknown") return t("Could not check: {p0}", { p0: check.error });
  if (check.status === "behind") {
    return `${check.installed} · ${t("Version {p0} is available.", { p0: check.latest })}`;
  }
  if (state.status === "updated") return t("Updated to {p0}.", { p0: state.version });
  return `${check.installed} · ${t("Up to date.")}`;
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
  onCheck,
  onSetup,
}: {
  harness: HarnessId;
  available: boolean;
  /** When this window last finished a version check, if it did. */
  checkedAt: number | null;
  onCheck: () => void;
  /** Takes the person to the Runtime section's CLI setup. */
  onSetup: () => void;
}) {
  useLocale();
  const { checks, checking, runs } = useSyncExternalStore(
    subscribeHarnessUpdates,
    getHarnessUpdateSnapshot,
    getHarnessUpdateSnapshot,
  );
  const usage = useSyncExternalStore(subscribeRateLimits, getAllRateLimits, getAllRateLimits);
  const now = useMinuteNow();
  const accountProvider = supportsProviderAccounts(harness) ? harness : null;
  const defaultAccount = accountProvider
    ? (providerAccounts(accountProvider).find(
        (account) => account.id === defaultProviderAccountId(accountProvider),
      ) ?? providerAccounts(accountProvider)[0])
    : undefined;
  const identities = useProviderAccountIdentities(defaultAccount ? [defaultAccount] : []);
  const key = defaultAccount ? accountUsageKey(defaultAccount) : "";
  const limits = key ? usage[key] : undefined;
  const auth = providerAuthState(limits, now);
  const plan = key ? identities[key]?.plan : undefined;
  const check = checks?.find((entry) => entry.harness === harness);
  const run: HarnessUpdateRun = runs[harness] ?? { status: "idle" };
  const title = HARNESS_TITLE[harness];
  const notice = updateNotice(run, check);
  const notFound = hasProbedHarnessAvailability() && !available;
  const readiness = providerReadiness({
    available,
    availabilityChecked: hasProbedHarnessAvailability(),
    checking,
    status: limits?.status,
    auth: auth?.tone,
  });
  // One readiness badge beside the heading; permission and activity are never observed here.
  const readinessBadge =
    readiness === "unknown" ? undefined : (
      <Badge size="sm" tone={READINESS_TONE[readiness]}>
        {READINESS_LABEL[readiness]()}
      </Badge>
    );

  if (notFound) {
    return (
      <Group title={t("Status")} layout="full" action={readinessBadge}>
        <Row label={t("CLI not found")} description={t("Set up the CLI to use this provider.")}>
          <Button size="sm" onClick={onSetup}>
            {t("Set up")}
          </Button>
        </Row>
      </Group>
    );
  }

  const exhausted = auth?.tone === "exhausted" ? exhaustedExplanation(limits, now) : null;
  const authDescription =
    exhausted ??
    (auth?.tone === "signedOut"
      ? t("Sign in again from Accounts below.")
      : [plan, auth?.tone === "low" ? t("Running low on usage.") : undefined]
          .filter(Boolean)
          .join(" · "));

  return (
    <Group title={t("Status")} layout="full" action={readinessBadge}>
      {accountProvider ? (
        <Row label={t("Sign-in")} description={authDescription || undefined}>
          {auth ? (
            <Badge size="sm" tone={AUTH_BADGE_TONE[auth.tone]}>
              {auth.label}
            </Badge>
          ) : (
            <span className="text-ui-caption text-(--ui-text-muted)">{t("Checking…")}</span>
          )}
        </Row>
      ) : null}
      <Row
        label={t("CLI version")}
        description={updateLine(run, check)}
        feedback={
          notice ? (
            <SettingsFeedback state={notice.state}>{notice.text}</SettingsFeedback>
          ) : undefined
        }
      >
        <div className="provider-status-actions">
          {check?.status === "behind" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void runHarnessUpdate(check)}
              disabled={run.status === "updating"}
              loading={run.status === "updating"}
              startIcon={<ArrowDownCircle className="icon-sm text-accent" aria-hidden />}
              aria-label={
                run.status === "failed"
                  ? t("Retry updating {p0}", { p0: title })
                  : t("Update {p0} to {p1}", { p0: title, p1: check.latest })
              }
            >
              {run.status === "failed" ? t("Retry") : t("Update")}
            </Button>
          ) : null}
          {checkedAt != null ? (
            <span className="provider-status-checked">
              {t("Checked")} <RelativeSessionTime at={checkedAt} />
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Check for updates")}
            loading={checking}
            disabled={checking}
            onClick={onCheck}
          >
            <RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
      </Row>
    </Group>
  );
}
