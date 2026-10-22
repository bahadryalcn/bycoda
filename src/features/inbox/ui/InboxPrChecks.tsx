import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { fetchCheckDetails, hasCheckDetails } from "../model/prChecks";
import { t, useLocale } from "../../../shared/i18n";
import { CheckRepairForm, type CheckRepair } from "./CheckRepairForm";
import {
  CheckRepairProgress,
  CheckRepairStatus,
  findCheckRepair,
  useCheckRepairs,
  type RepairGroup,
} from "./CheckRepairProgress";
import { CheckEvidence } from "./CheckEvidence";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  CircleX,
  ExternalLink,
  LoaderCircle,
  Minus,
  RefreshCw,
  Sparkles,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { GithubPrChecksView } from "../hooks/useGithubPrChecks";
import {
  CHECK_STATES,
  checkDuration,
  checkStateLabel,
  countChecks,
  describeCheckCounts,
  isHttpUrl,
  sortChecks,
  type GithubPrCheck,
  type GithubPrChecksOverall,
  type GithubPrCheckState,
  type GithubCheckDetails,
} from "../model/githubPrChecks";

function overallMark(overall: GithubPrChecksOverall): {
  Icon: IconComponent;
  className: string;
} {
  switch (overall.kind) {
    case "loading":
      return { Icon: LoaderCircle, className: "animate-spin text-(--ui-text-secondary)" };
    case "error":
      return { Icon: AlertCircle, className: "text-(--ui-tone-danger-fg)" };
    case "fail":
      return { Icon: CircleX, className: "text-(--ui-tone-danger-fg)" };
    case "pending":
      return {
        Icon: LoaderCircle,
        className: "animate-spin text-(--ui-tone-warning-fg)",
      };
    case "pass":
      return { Icon: CheckCircle, className: "text-(--ui-tone-success-fg)" };
    case "neutral":
      return { Icon: CircleDashed, className: "text-(--ui-text-secondary)" };
  }
}

function checkMark(state: GithubPrCheckState): {
  Icon: IconComponent;
  className: string;
} {
  switch (state) {
    case "pass":
      return { Icon: CheckCircle, className: "text-(--ui-tone-success-fg)" };
    case "fail":
      return { Icon: CircleX, className: "text-(--ui-tone-danger-fg)" };
    case "pending":
      return { Icon: LoaderCircle, className: "animate-spin text-(--ui-text-secondary)" };
    case "cancel":
      return { Icon: Minus, className: "text-(--ui-text-secondary)" };
    case "unknown":
      return { Icon: CircleHelp, className: "text-(--ui-text-secondary)" };
    case "skipping":
      return { Icon: CircleDashed, className: "text-(--ui-text-secondary)" };
  }
}

/** The Checks tab: label plus an overall mark whose name spells out the counts. */
export function PrChecksTab({
  id,
  controls,
  overall,
  selected,
  onSelect,
}: {
  id?: string;
  controls?: string;
  overall: GithubPrChecksOverall;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  const mark = overallMark(overall);
  const label = `Checks: ${overall.description}`;
  const failClass = mark.className.split(" ").find((entry) => entry.startsWith("text-")) ?? "";
  return (
    <Button
      variant="tab"
      type="button"
      role="tab"
      id={id}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
    >
      <span className="leading-none">{t("Checks")}</span>
      <mark.Icon className={`size-3.5 shrink-0 ${mark.className}`} strokeWidth={1.75} />
      {overall.kind === "fail" ? (
        <span className={`tabular-nums leading-none ${failClass}`}>{overall.failed}</span>
      ) : null}
      {selected ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-(--ui-tone-neutral-solid)" />
      ) : null}
    </Button>
  );
}

function selectedChecksStillFailed(
  selected: readonly GithubPrCheck[],
  current: readonly GithubPrCheck[],
): boolean {
  const failures = new Map<string, number>();
  const identity = (check: GithubPrCheck) =>
    JSON.stringify([check.workflow, check.name, check.url]);
  for (const check of current) {
    if (check.state !== "fail") continue;
    const key = identity(check);
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  return selected.every((check) => {
    const key = identity(check);
    const count = failures.get(key) ?? 0;
    if (count === 0) return false;
    failures.set(key, count - 1);
    return true;
  });
}

function PrCheckRow({
  check,
  cwd,
  repo,
  headOid,
  autoExpand,
  refreshToken,
  onFix,
  fixDisabled,
  fixAnchor,
  repairItem,
  wideStatus,
  revealToken,
}: {
  check: GithubPrCheck;
  cwd: string;
  repo: string;
  headOid: string;
  autoExpand: boolean;
  refreshToken: unknown;
  onFix?: (anchor: HTMLButtonElement) => void;
  fixDisabled?: boolean;
  fixAnchor?: HTMLButtonElement;
  repairItem?: RepairGroup["items"][number];
  wideStatus: boolean;
  revealToken?: number;
}) {
  useLocale();
  const rowRef = useRef<HTMLLIElement>(null);
  const fixRef = useRef<HTMLButtonElement>(null);
  const fixOpen = Boolean(fixAnchor && fixAnchor === fixRef.current);
  const jobId = hasCheckDetails(check, repo) ? JSON.stringify(check.detailsRef ?? check.url) : null;
  const expandable = Boolean(cwd && jobId);
  const [expanded, setExpanded] = useState(autoExpand && expandable);
  useEffect(() => {
    if (!revealToken) return;
    if (expandable) setExpanded(true);
    const row = rowRef.current;
    if (!row) return;
    row.focus({ preventScroll: true });
    const scroller = row.closest<HTMLElement>("[data-inbox-detail-scroll]");
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const scaleY = scroller.offsetHeight ? bounds.height / scroller.offsetHeight : 1;
    // scrollIntoView also scrolls hidden ancestors, including the desktop shell.
    // Move only the PR viewport, accounting for browser preview zoom.
    scroller.scrollTop +=
      (row.getBoundingClientRect().top - bounds.top) / (scaleY || 1) - scroller.clientTop;
  }, [revealToken, expandable]);
  const [details, setDetails] = useState<GithubCheckDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const detailsId = useId();
  const detailsKey = JSON.stringify([
    cwd,
    repo,
    headOid,
    jobId,
    check.provider,
    check.instance,
    check.state,
    check.startedAt,
    check.completedAt,
  ]);
  useEffect(() => {
    if (autoExpand && expandable) setExpanded(true);
  }, [autoExpand, expandable]);
  useEffect(() => {
    setDetails(null);
  }, [detailsKey]);
  useEffect(() => {
    if (!expanded || !jobId || (!cwd && (!check.provider || check.provider === "github"))) return;
    let active = true;
    setLoading(true);
    setError(null);
    // Routine polls keep evidence mounted while fetching updated job steps.
    fetchCheckDetails(cwd, repo, check)
      .then(
        (result) => {
          if (active) setDetails(result);
        },
        (reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [expanded, cwd, repo, jobId, detailsKey, refreshToken, retry]);
  const mark = checkMark(check.state);
  const status = checkStateLabel(check.state);
  const duration = checkDuration(check.startedAt, check.completedAt);
  const workflow = check.workflow.trim();
  const meta = [workflow, status, check.allowFailure ? t("Failure allowed") : null, duration]
    .filter((part) => part)
    .join(" · ");
  const failedStep = details?.steps
    .filter((step) => step.state === "fail")
    .map((step) => step.name)
    .join(", ");
  const failureMessage = details?.annotations
    .find((annotation) => annotation.level === "failure")
    ?.message.split(/\r?\n/)
    .find((line) => line.trim());
  const subtitle = failureMessage || (failedStep ? `Failed at ${failedStep}` : status);
  const title = `${check.name} · ${status}${duration ? `, took ${duration}` : ""}${workflow ? `, ${workflow}` : ""}`;
  const url = check.url;
  const linked = isHttpUrl(url);
  const body = (
    <>
      <span className="grid h-7 w-5 shrink-0 place-items-center">
        <mark.Icon className={`size-4 ${mark.className}`} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span
            data-check-name
            title={check.name}
            className={`min-w-0 ${expanded ? "break-words" : "truncate"} text-[14px] font-medium leading-snug tracking-[-0.15px] text-(--ui-tone-neutral-fg) @max-[420px]/checks:text-[12px]`}
          >
            {check.name}
          </span>
          {workflow ? (
            <span className="min-w-0 shrink-[2] truncate text-[11px] text-(--ui-text-secondary) @max-[560px]/checks:hidden">
              {workflow}
            </span>
          ) : null}
        </span>
        {(!repairItem || expanded) && (failureMessage || failedStep) ? (
          <span
            title={subtitle}
            className="mt-0.5 min-w-0 truncate text-[12px] leading-relaxed text-(--ui-text-secondary) @max-[420px]/checks:text-[11px]"
          >
            {subtitle}
          </span>
        ) : null}
        <span className="sr-only">
          {meta}
          {failureMessage && failedStep ? t("; Failed at {p0}", { p0: failedStep }) : ""}
        </span>
      </span>
    </>
  );
  const className = "flex w-full min-w-0 flex-1 items-center gap-2.5 rounded-md text-left";
  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className={`min-w-0 rounded-xl outline-none ${expanded ? "bg-(--ui-surface-hover)" : ""}`}
    >
      <div className="group/check flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 hover:bg-(--ui-surface-hover) @max-[420px]/checks:gap-1">
        {expandable ? (
          <Button
            variant="item"
            fullWidth
            motion="none"
            className="w-full min-w-0 flex-1 text-left"
            type="button"
            aria-label={t("{p0} details", { p0: check.name })}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(!expanded)}
          >
            {body}
          </Button>
        ) : linked ? (
          // The desktop WebView cannot rely on target=_blank, so rows open
          // through the same opener as every other external link.
          <Button
            variant="item"
            fullWidth
            motion="none"
            className="w-full min-w-0 flex-1 text-left"
            type="button"
            title={title}
            aria-label={title}
            onClick={() => void openUrl(url)}
          >
            {body}
          </Button>
        ) : (
          <div title={title} className={className}>
            {body}
          </div>
        )}
        <span className={`shrink-0 text-left ${wideStatus ? "w-24" : "w-14"}`}>
          {repairItem ? (
            <CheckRepairStatus item={repairItem} />
          ) : (
            <span className={`text-[11px] ${mark.className.replace("animate-spin", "")}`}>
              {status}
            </span>
          )}
        </span>
        <span className="mr-1 w-11 shrink-0 whitespace-nowrap text-right text-(length:--ui-font-caption) tabular-nums text-(--ui-text-secondary) @max-[480px]/checks:hidden">
          {duration}
        </span>
        {onFix ? (
          <Button
            iconOnly
            label={t("Fix {p0} with AI", { p0: check.name })}
            variant="ghost"
            type="button"
            ref={fixRef}
            onClick={(event) => onFix(event.currentTarget)}
            disabled={fixDisabled}
            aria-haspopup="dialog"
            aria-expanded={fixOpen}
            aria-label={t("Fix {p0} with AI", { p0: check.name })}
            title={t("Fix with AI")}
            className="shrink-0"
          >
            <Sparkles className="size-3.5" strokeWidth={1.75} />
          </Button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden="true" />
        )}
        {expandable ? (
          <Button
            iconOnly
            label={t(expanded ? "Collapse {p1} details" : "Expand {p1} details", {
              p1: check.name,
            })}
            variant="ghost"
            type="button"
            aria-label={t(expanded ? "Collapse {p1} details" : "Expand {p1} details", {
              p1: check.name,
            })}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(!expanded)}
            className="shrink-0"
          >
            <ChevronRight
              className={`size-3 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
              strokeWidth={1.75}
            />
          </Button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden="true" />
        )}
        {linked ? (
          <Button
            iconOnly
            label={t("Open {p0} check", { p0: check.name })}
            variant="ghost"
            type="button"
            title={t("View full log")}
            className="opacity-60 group-hover/check:opacity-100 focus-visible:opacity-100"
            aria-label={t("Open {p0} check", { p0: check.name })}
            onClick={() => void openUrl(url)}
          >
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </Button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
      </div>
      {expanded ? (
        <div
          id={detailsId}
          className="min-w-0 space-y-3 py-3 pl-10 pr-3 text-[12px] @max-[420px]/checks:pl-3"
        >
          {loading && !details ? (
            <p
              role="status"
              className="flex items-center gap-2 px-2 py-1 text-(--ui-text-secondary)"
            >
              <LoaderCircle className="size-4 shrink-0 animate-spin" strokeWidth={1.75} />
              {t("Loading steps…")}
            </p>
          ) : null}
          {error ? (
            <Alert tone="info" role="alert">
              <p>{t("Could not load job details.")}</p>
              <p className="break-words text-[11px]">{error}</p>
              <Button variant="ghost" type="button" onClick={() => setRetry((value) => value + 1)}>
                {t("Retry details")}
              </Button>
            </Alert>
          ) : null}
          {details ? (
            <>
              {details.annotations.length ? (
                <CheckEvidence
                  annotations={details.annotations}
                  cwd={cwd}
                  repo={repo}
                  headOid={headOid}
                />
              ) : null}
              {details.steps.length ? (
                <details className="group/steps">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-(--ui-text-secondary) hover:text-(--ui-tone-neutral-fg) [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3 transition-transform group-open/steps:rotate-90 motion-reduce:transition-none" />
                    {t("View run steps")}
                    <span className="ml-auto pl-2 text-right text-(length:--ui-font-caption) text-(--ui-text-secondary) @max-[420px]/checks:hidden">
                      {describeCheckCounts(countChecks(details.steps))}
                    </span>
                  </summary>
                  <ol className="space-y-1" aria-label={t("{p0} steps", { p0: check.name })}>
                    {details.steps.map((step, index) => {
                      const stepMark = checkMark(step.state);
                      return (
                        <li
                          key={index}
                          className={`flex items-center gap-2 rounded px-2 py-1 ${step.state === "fail" ? "bg-(--ui-tone-danger-subtle)" : ""}`}
                        >
                          <stepMark.Icon
                            className={`size-4 shrink-0 ${stepMark.className}`}
                            strokeWidth={1.75}
                          />
                          <span className="min-w-0 flex-1 break-words text-(--ui-text-secondary)">
                            {step.name}
                            <span className="sr-only">: {checkStateLabel(step.state)}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-(--ui-text-secondary)">
                            {checkDuration(step.startedAt, step.completedAt)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </details>
              ) : (
                <p className="text-(--ui-text-secondary)">{t("No steps reported for this job.")}</p>
              )}
              {check.state === "fail" && !details.annotations.length && !details.notice ? (
                <p className="mt-3 text-(--ui-text-secondary)">
                  {t("No error annotations reported. View the full log at the check URL.")}
                </p>
              ) : null}
              {details.log ? (
                <details className="mt-3">
                  <summary>{t("View logs")}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px]">
                    {details.log}
                  </pre>
                </details>
              ) : null}
              {details.notice ? (
                <p role="status" className="mt-3 text-(--ui-text-secondary)">
                  {details.notice}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Checks tab body: manual refresh, initial loading, the no-checks state and a
 * load error with retry. A failed refresh keeps the previous rows on screen
 * behind an explicit out-of-date notice.
 */
export function InboxPrChecks({
  view,
  onRefresh,
  cwd = "",
  repo = "",
  repair,
}: {
  view: GithubPrChecksView;
  onRefresh: () => void;
  cwd?: string;
  repo?: string;
  repair?: CheckRepair;
}) {
  useLocale();
  const { checks, loading, refreshing, error, stale } = view;
  const repairGroups = useCheckRepairs(cwd, repo, repair?.number, view);
  const revealScope = JSON.stringify([cwd, repo, repair?.number, checks?.headOid]);
  const [revealed, setRevealed] = useState<{
    name: string;
    workflow: string;
    scope: string;
    token: number;
  } | null>(null);
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const [showOthers, setShowOthers] = useState(false);
  const allFixRef = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{
    checks: GithubPrCheck[];
    anchor: HTMLButtonElement;
    scope: string;
  } | null>(null);
  const selectionValid = Boolean(
    selection &&
    checks &&
    selection.scope === revealScope &&
    selectedChecksStillFailed(selection.checks, checks.checks),
  );
  useEffect(() => {
    if (selection && !selectionValid) setSelection(null);
  }, [selection, selectionValid]);
  if (loading) {
    return (
      <div className="flex justify-center py-10 text-(--ui-text-secondary)">
        <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} />
      </div>
    );
  }
  if (!checks && error) {
    return (
      <div className="flex flex-col items-start gap-2" data-inbox-pr-checks>
        <Alert tone="info" role="alert">
          {error}
        </Alert>
        <Button
          variant="ghost"
          type="button"
          title={t("Retry loading checks")}
          aria-label={t("Retry loading checks")}
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          {t("Retry")}
        </Button>
      </div>
    );
  }
  const rows = checks ? sortChecks(checks.checks) : [];
  const counts = countChecks(rows);
  const attention = counts.fail + counts.pending + counts.cancel + counts.unknown;
  const activeFilter = attention ? filter : "all";
  const groups = CHECK_STATES.map((state) => ({
    state,
    rows: rows.filter((row) => row.state === state),
    hidden:
      activeFilter === "attention" && !showOthers && (state === "pass" || state === "skipping"),
  }));
  const requiredFailures = rows.filter((row) => row.state === "fail" && !row.allowFailure).length;
  const headline = requiredFailures
    ? `${requiredFailures} ${requiredFailures === 1 ? "check needs" : "checks need"} a fix`
    : counts.fail
      ? t("Optional checks failed")
      : counts.pending
        ? `${counts.pending} ${counts.pending === 1 ? "check is" : "checks are"} running`
        : attention
          ? `${attention} ${attention === 1 ? "check needs" : "checks need"} attention`
          : counts.pass
            ? "Checks passed"
            : "No checks ran";
  const summary = describeCheckCounts({ ...counts, fail: 0 });
  return (
    <section
      data-inbox-pr-checks
      aria-label={t("Pull request checks")}
      className="@container/checks flex min-w-0 flex-col gap-2"
    >
      {checks?.pipelineOid && checks.pipelineOid !== checks.headOid ? (
        <p className="px-2 text-xs text-(--ui-text-secondary)">
          {t("Pipeline commit")}: {checks.pipelineOid.slice(0, 12)} · {t("Source commit")}:{" "}
          {checks.headOid.slice(0, 12)}
        </p>
      ) : null}
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-3 px-2">
        <div className="min-w-0">
          {rows.length ? (
            <>
              <h2 className="text-[18px] font-medium leading-snug tracking-[-0.35px] @max-[420px]/checks:text-[16px]">
                {headline}
              </h2>
              {summary ? (
                <p className="mt-1 text-[12px] text-(--ui-text-secondary)">
                  {summary.charAt(0).toUpperCase() + summary.slice(1)}.
                </p>
              ) : null}
              <span className="sr-only">{describeCheckCounts(counts)}</span>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {repair && rows.some((row) => row.state === "fail") ? (
            <Button
              variant="ghost"
              ref={allFixRef}
              type="button"
              disabled={refreshing || stale || Boolean(error)}
              onClick={(event) =>
                setSelection({
                  checks: rows.filter((row) => row.state === "fail"),
                  anchor: event.currentTarget,
                  scope: revealScope,
                })
              }
              aria-haspopup="dialog"
              aria-label={t("Fix all failed")}
              aria-expanded={Boolean(selection && selection.anchor === allFixRef.current)}
              className="shrink-0"
            >
              <Sparkles className="size-3.5" strokeWidth={1.75} />
              {t("Fix all failed")}
              <span
                aria-hidden="true"
                className="ml-1 border-l border-current/20 pl-2 text-(length:--ui-font-caption) opacity-55"
              >
                {counts.fail}
              </span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            type="button"
            title={t("Refresh checks")}
            aria-label={t("Refresh checks")}
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? (
              <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
            )}
          </Button>
        </div>
      </div>
      {repair ? (
        <CheckRepairProgress
          cwd={cwd}
          repo={repo}
          repair={repair}
          view={view}
          onShowCheck={(check) => {
            setFilter("all");
            setSelection(null);
            setRevealed((previous) => ({
              name: check.name,
              workflow: check.workflow,
              scope: revealScope,
              token: (previous?.token ?? 0) + 1,
            }));
          }}
        />
      ) : null}
      {stale && error ? (
        <p role="status" className="px-2 text-[12px] text-(--ui-text-secondary)">
          {t("Saved results may be out of date.")}
        </p>
      ) : null}
      {selection && selectionValid && repair ? (
        <CheckRepairForm
          key={`${selection.scope}:${JSON.stringify(selection.checks)}`}
          anchor={selection.anchor}
          checks={selection.checks}
          headOid={checks?.headOid ?? ""}
          cwd={cwd}
          repo={repo}
          repair={repair}
          blocked={refreshing || stale || Boolean(error)}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {rows.length > 0 ? (
        <div className="flex items-center justify-between gap-3 py-2">
          <div
            className="inline-flex gap-0.5 rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-hover) p-0.5"
            aria-label={t("Filter checks")}
          >
            {(
              [
                ["attention", "Needs attention", attention],
                ["all", "All checks", rows.length],
              ] as const
            ).map(([value, label, count]) => (
              <Button
                variant="ghost"
                key={value}
                type="button"
                aria-label={`${label}: ${count}`}
                aria-pressed={activeFilter === value}
                disabled={value === "attention" && !attention}
                onClick={() => {
                  setFilter(value);
                  setShowOthers(false);
                  setSelection(null);
                }}
              >
                {label}
                <span className="tabular-nums text-(--ui-text-secondary)">{count}</span>
              </Button>
            ))}
          </div>
          <span className="text-(length:--ui-font-caption) text-(--ui-text-secondary) @max-[420px]/checks:hidden">
            {counts.fail ? t("Failures first") : ""}
          </span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-[13px] text-(--ui-text-secondary)">{t("No checks reported")}</p>
      ) : (
        <>
          {groups.map((group) =>
            group.rows.length ? (
              <div key={group.state} hidden={group.hidden} className={group.hidden ? "hidden" : ""}>
                <h3 className="mb-1.5 mt-3 flex items-center gap-2 px-2 text-[12px] font-normal text-(--ui-text-secondary)">
                  {checkStateLabel(group.state)}
                  <span className="text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                    {group.rows.length}
                  </span>
                </h3>
                <ul className="flex flex-col gap-0.5">
                  {group.rows.map((check, index) => (
                    <PrCheckRow
                      key={JSON.stringify([
                        cwd,
                        repo,
                        repair?.number,
                        checks?.headOid,
                        check.workflow,
                        check.name,
                        check.url,
                        group.rows
                          .slice(0, index)
                          .filter(
                            (row) =>
                              row.workflow === check.workflow &&
                              row.name === check.name &&
                              row.url === check.url,
                          ).length,
                      ])}
                      check={check}
                      wideStatus={repairGroups.length > 0}
                      revealToken={
                        revealed?.scope === revealScope &&
                        revealed.name === check.name &&
                        revealed.workflow === check.workflow
                          ? revealed.token
                          : undefined
                      }
                      repairItem={checks ? findCheckRepair(repairGroups, check, checks) : undefined}
                      onFix={
                        repair && check.state === "fail"
                          ? (anchor) =>
                              setSelection({
                                checks: [check],
                                anchor,
                                scope: revealScope,
                              })
                          : undefined
                      }
                      fixDisabled={refreshing || stale || Boolean(error)}
                      fixAnchor={selection?.anchor}
                      cwd={cwd}
                      repo={repo}
                      headOid={checks?.headOid ?? ""}
                      autoExpand={
                        repairGroups.length === 0 &&
                        check === rows.find((row) => row.state === "fail")
                      }
                      refreshToken={checks}
                    />
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {activeFilter === "attention" && counts.pass + counts.skipping > 0 ? (
            <Button
              variant="ghost"
              type="button"
              aria-expanded={showOthers}
              onClick={() => setShowOthers(!showOthers)}
              className="mt-3 text-left"
            >
              <ChevronRight className={`size-3 ${showOthers ? "rotate-90" : ""}`} />
              {describeCheckCounts({
                ...countChecks([]),
                pass: counts.pass,
                skipping: counts.skipping,
              })}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
