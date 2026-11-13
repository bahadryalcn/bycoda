import { Tooltip } from "../../../shared/ui/Tooltip";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Spinner } from "../../../shared/ui/Spinner";
import { surfaceAttributes, Surface } from "../../../shared/ui/Surface";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { useState, useSyncExternalStore } from "react";
import { getCiRepairs, subscribeCiRepairs, type TrackedCiRepair } from "../model/ciRepairTracking";
import { sameProjectPath } from "../../projects/model/recents";
import {
  CheckCircle,
  CircleDashed,
  CircleX,
  MessageSquare,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { CheckRepair } from "./CheckRepairForm";
import type { GithubPrChecksView } from "../hooks/useGithubPrChecks";
import type { GithubPrCheck, GithubPrChecks, GithubPrCheckState } from "../model/githubPrChecks";
import { githubActionsJobId } from "../model/githubPrChecks";

type RepairState =
  | GithubPrCheckState
  | "repairing"
  | "waiting"
  | "stale"
  | "refreshing"
  | "stopped"
  | "interrupted"
  | "agent-error";
type RepairItem = {
  attempt: TrackedCiRepair;
  check: TrackedCiRepair["checks"][number];
  state: RepairState;
};
export type RepairGroup = { sessionId: string; items: RepairItem[] };

export function findCheckRepair(
  groups: RepairGroup[],
  check: GithubPrCheck,
  current: GithubPrChecks,
): RepairItem | undefined {
  const candidates = groups
    .flatMap((group) => group.items)
    .filter((item) => item.check.name === check.name && item.check.workflow === check.workflow);
  const exact = candidates.find(
    (item) => item.attempt.headOid === current.headOid && item.check.url === check.url,
  );
  if (exact) return exact;
  // A new commit changes job URLs. Match by name only when both sides are unique.
  if (candidates.length !== 1 || candidates[0].attempt.headOid === current.headOid)
    return undefined;
  return current.checks.filter(
    (item) => item.name === check.name && item.workflow === check.workflow,
  ).length === 1
    ? candidates[0]
    : undefined;
}

function repairState(
  attempt: TrackedCiRepair,
  check: RepairItem["check"],
  view: GithubPrChecksView,
  ambiguous: boolean,
): RepairState {
  if (attempt.phase === "running") return "repairing";
  if (attempt.phase === "failed") return "agent-error";
  if (attempt.phase === "cancelled") return "stopped";
  if (attempt.phase === "interrupted") return "interrupted";
  if (view.stale || view.error) return "stale";
  if (view.loading || view.refreshing) return "refreshing";
  const current = view.checks;
  if (!current || current.headOid === attempt.headOid || ambiguous) return "waiting";
  const matches = current.checks.filter(
    (item) => item.name === check.name && item.workflow === check.workflow,
  );
  const originals = attempt.checks.filter(
    (item) => item.name === check.name && item.workflow === check.workflow,
  );
  if (matches.length !== 1 || originals.length !== 1) return "waiting";
  const latest = matches[0];
  // Only a distinct, newer job can verify a completed repair attempt.
  if (
    (githubActionsJobId(check.url, attempt.repo) && latest.url === check.url) ||
    !latest.startedAt ||
    !Number.isFinite(Date.parse(latest.startedAt)) ||
    Date.parse(latest.startedAt) < attempt.startedAt
  )
    return "waiting";
  return latest.state;
}

export function useCheckRepairs(
  cwd: string,
  repo: string,
  number: number | undefined,
  view: GithubPrChecksView,
): RepairGroup[] {
  const attempts = useSyncExternalStore(subscribeCiRepairs, getCiRepairs, getCiRepairs);
  const seen = new Map<string, { headOid: string; urls: Set<string | null> }>();
  const groups = new Map<string, RepairGroup>();
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (
      (attempt.provider ?? "github") !== (view.provider ?? "github") ||
      (attempt.provider &&
        attempt.provider !== "github" &&
        attempt.instance !== view.checks?.instance) ||
      !sameProjectPath(attempt.cwd, cwd) ||
      attempt.repo.toLowerCase() !== repo.toLowerCase() ||
      attempt.number !== number
    )
      continue;
    for (const check of attempt.checks) {
      const key = JSON.stringify([check.workflow, check.name]);
      const previous = seen.get(key);
      if (previous && (previous.headOid !== attempt.headOid || previous.urls.has(check.url)))
        continue;
      if (previous) previous.urls.add(check.url);
      else seen.set(key, { headOid: attempt.headOid, urls: new Set([check.url]) });
      const group = groups.get(attempt.sessionId) ?? {
        sessionId: attempt.sessionId,
        items: [],
      };
      group.items.push({
        attempt,
        check,
        state: "waiting",
      });
      counts.set(key, (counts.get(key) ?? 0) + 1);
      groups.set(attempt.sessionId, group);
    }
  }
  for (const group of groups.values()) {
    for (const item of group.items) {
      const key = JSON.stringify([item.check.workflow, item.check.name]);
      item.state = repairState(item.attempt, item.check, view, (counts.get(key) ?? 0) > 1);
    }
  }
  return [...groups.values()];
}

const neutral = "neutral";
const positive = "success";
const negative = "danger";
const active = "accent";
const states: Record<
  RepairState,
  { label: string; summary: string; Icon: IconComponent | "spinner"; color: BadgeTone }
> = {
  repairing: {
    get label() {
      return t("Repairing");
    },
    summary: "Repair in progress",
    Icon: "spinner",
    color: active,
  },
  waiting: {
    get label() {
      return t("Awaiting CI");
    },
    summary: "Awaiting new CI checks",
    Icon: CircleDashed,
    color: neutral,
  },
  refreshing: {
    get label() {
      return t("Refreshing");
    },
    summary: "Refreshing CI checks",
    Icon: "spinner",
    color: neutral,
  },
  stale: {
    get label() {
      return t("Out of date");
    },
    summary: "CI results are out of date",
    Icon: CircleDashed,
    color: neutral,
  },
  pass: {
    get label() {
      return t("CI passed");
    },
    summary: "passed",
    Icon: CheckCircle,
    color: positive,
  },
  fail: {
    get label() {
      return t("Still failing");
    },
    summary: "still failing",
    Icon: CircleX,
    color: negative,
  },
  pending: {
    get label() {
      return t("CI running");
    },
    summary: "running",
    Icon: "spinner",
    color: active,
  },
  cancel: {
    get label() {
      return t("CI cancelled");
    },
    summary: "cancelled",
    Icon: CircleDashed,
    color: neutral,
  },
  skipping: {
    get label() {
      return t("CI skipped");
    },
    summary: "skipped",
    Icon: CircleDashed,
    color: neutral,
  },
  unknown: {
    get label() {
      return t("Unknown");
    },
    summary: "unknown",
    Icon: CircleDashed,
    color: neutral,
  },
  stopped: {
    get label() {
      return t("Stopped");
    },
    summary: "Repair stopped",
    Icon: CircleDashed,
    color: neutral,
  },
  interrupted: {
    get label() {
      return t("Interrupted");
    },
    summary: "Tracking interrupted",
    Icon: CircleDashed,
    color: neutral,
  },
  "agent-error": {
    get label() {
      return t("Agent stopped");
    },
    summary: "Agent could not finish",
    Icon: CircleX,
    color: negative,
  },
};
function StatusIcon({ state }: { state: RepairState }) {
  useLocale();
  const { Icon, color } = states[state];
  return (
    <Badge
      appearance="subtle"
      size="xs"
      tone={color}
      aria-hidden="true"
      icon={Icon === "spinner" ? <Spinner size="sm" /> : <Icon strokeWidth={1.75} />}
    />
  );
}

export function CheckRepairStatus({ item }: { item: RepairItem }) {
  useLocale();
  const status = states[item.state];
  return (
    <Tooltip label={t(status.summary)} asChild>
      <Badge
        size="xs"
        tone={status.color}
        appearance="subtle"
        icon={
          status.Icon === "spinner" ? <Spinner size="sm" /> : <status.Icon strokeWidth={1.75} />
        }
        data-repair-status
        role="status"
      >
        {status.label}
      </Badge>
    </Tooltip>
  );
}

function RepairCard({
  group,
  repair,
  view,
  onShowCheck,
}: {
  group: RepairGroup;
  repair: CheckRepair;
  view: GithubPrChecksView;
  onShowCheck?: (check: RepairItem["check"]) => void;
}) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const counts = new Map<RepairState, number>();
  for (const item of group.items) counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
  const priority: RepairState[] = [
    "repairing",
    "agent-error",
    "fail",
    "stale",
    "refreshing",
    "pending",
    "waiting",
    "interrupted",
    "stopped",
    "cancel",
    "unknown",
    "skipping",
    "pass",
  ];
  const lead = priority.find((state) => counts.has(state))!;
  const label = t(group.items.length === 1 ? "{p0} check" : "{p0} checks", {
    p0: formatNumber(group.items.length),
  });
  const single = group.items.length === 1 ? group.items[0] : undefined;
  const canShowCheck =
    single?.state === "pass" &&
    onShowCheck &&
    view.checks?.checks.filter(
      (check) => check.name === single.check.name && check.workflow === single.check.workflow,
    ).length === 1;
  return (
    <Surface variant="outline" padding="none" className="overflow-hidden">
      <Disclosure
        variant="row"
        chevron="end"
        open={expanded}
        onOpenChange={setExpanded}
        className="min-w-0"
        summary={
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <StatusIcon state={lead} />
            <span className="min-w-0 flex-1">
              <Text
                size="caption"
                tone="inherit"
                weight="medium"
                role="status"
                className="flex flex-wrap gap-x-3 gap-y-0.5"
              >
                {[...counts].map(([state, count]) => (
                  <Badge key={state} tone={states[state].color} size="xs" appearance="subtle">
                    {["pass", "fail", "pending", "cancel", "skipping", "unknown"].includes(state)
                      ? single
                        ? states[state].label
                        : `${count} ${t(states[state].summary)}`
                      : counts.size === 1
                        ? t(states[state].summary)
                        : `${count} ${states[state].label.toLowerCase()}`}
                  </Badge>
                ))}
              </Text>
              <Tooltip
                label={single ? `${single.check.workflow}: ${single.check.name}` : undefined}
                asChild
              >
                <Text
                  size="caption"
                  tone="secondary"

                  className="mt-0.5 block break-words"
                >
                  {single ? single.check.name : t("CI repair for {p0}", { p0: label })}
                </Text>
              </Tooltip>
            </span>
          </span>
        }
        summaryActions={
          <>
            {canShowCheck ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => onShowCheck?.(single.check)}
                className="shrink-0"
              >
                {t("Show check")}
              </Button>
            ) : null}
            {repair.onOpenSession ? (
              <Button
                variant="ghost"
                type="button"
                onClick={() => void repair.onOpenSession?.(group.sessionId)}
                className="shrink-0"
              >
                <MessageSquare aria-hidden="true" className="icon-sm" />
                {t("Open conversation")}
              </Button>
            ) : null}
          </>
        }
      >
        <Text
          as="div"
          size="micro"
          tone="secondary"
          {...surfaceAttributes({ frame: "neutral", edge: "top" }, "space-y-2 py-2.5")}
        >
          <p>{t("Included checks")}</p>
          <ul className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {group.items.map(({ check }) => (
              <Tooltip
                key={JSON.stringify([check.workflow, check.name, check.url])}
                label={check.workflow}
                asChild
              >
                <Text
                  as="li"
                  key={JSON.stringify([check.workflow, check.name, check.url])}
                  size="inherit"
                  tone="secondary"

                  {...surfaceAttributes(
                    { radius: "sm", variant: "raised" },
                    "max-w-full break-words px-2 py-1",
                  )}
                >
                  {check.name}
                </Text>
              </Tooltip>
            ))}
          </ul>
          <p>
            {t("Latest PR commit:")}{" "}
            <Code>{view.checks?.headOid.slice(0, 7) || t("Unavailable")}</Code>
            {t(". Results appear in the checks below.")}
          </p>
        </Text>
      </Disclosure>
    </Surface>
  );
}

export function CheckRepairProgress({
  cwd,
  repo,
  repair,
  view,
  onShowCheck,
}: {
  cwd: string;
  repo: string;
  repair: CheckRepair;
  view: GithubPrChecksView;
  onShowCheck?: (check: RepairItem["check"]) => void;
}) {
  useLocale();
  const groups = useCheckRepairs(cwd, repo, repair.number, view);
  if (!groups.length) return null;
  return (
    <div className="space-y-2" aria-label={t("Repair progress")}>
      {groups.map((group) => (
        <RepairCard
          key={group.sessionId}
          group={group}
          repair={repair}
          view={view}
          onShowCheck={onShowCheck}
        />
      ))}
    </div>
  );
}
