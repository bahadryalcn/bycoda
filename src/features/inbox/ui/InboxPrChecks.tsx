import { ActionHost } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tab } from "../../../shared/ui/Tabs";
import { useTooltip } from "../../../shared/ui/Tooltip";
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
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  CircleX,
  ExternalLink,
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

/** A state glyph; `"spinner"` is the shared pending Spinner instead of an icon. */
type Mark = { Icon: IconComponent | "spinner"; tone: BadgeTone };

function overallMark(overall: GithubPrChecksOverall): Mark {
  switch (overall.kind) {
    case "loading":
      return { Icon: "spinner", tone: "neutral" };
    case "error":
      return { Icon: AlertCircle, tone: "danger" };
    case "fail":
      return { Icon: CircleX, tone: "danger" };
    case "pending":
      return { Icon: "spinner", tone: "accent" };
    case "pass":
      return { Icon: CheckCircle, tone: "success" };
    case "neutral":
      return { Icon: CircleDashed, tone: "neutral" };
  }
}

function checkMark(state: GithubPrCheckState): Mark {
  switch (state) {
    case "pass":
      return { Icon: CheckCircle, tone: "success" };
    case "fail":
      return { Icon: CircleX, tone: "danger" };
    case "pending":
      return { Icon: "spinner", tone: "accent" };
    case "cancel":
      return { Icon: Minus, tone: "neutral" };
    case "unknown":
      return { Icon: CircleHelp, tone: "neutral" };
    case "skipping":
      return { Icon: CircleDashed, tone: "neutral" };
  }
}

function MarkGlyph({ mark, size }: { mark: Mark; size: "sm" | "md" }) {
  return (
    <Badge
      appearance="subtle"
      size="xs"
      tone={mark.tone}
      aria-hidden="true"
      icon={mark.Icon === "spinner" ? <Spinner size={size} /> : <mark.Icon strokeWidth={1.75} />}
    />
  );
}

/** PR detail Checks tab; its accessible name includes the overall counts. */
export function PrChecksTab({ overall }: { overall: GithubPrChecksOverall }) {
  useLocale();
  const mark = overallMark(overall);
  const label = `Checks: ${overall.description}`;
  return (
    <Tab value="checks" aria-label={label} tooltip={label}>
      <span className="leading-none">{t("Checks")}</span>
      <MarkGlyph mark={mark} size="sm" />
      {overall.kind === "fail" ? (
        <Badge variant="count" size="xs">
          {overall.failed}
        </Badge>
      ) : null}
    </Tab>
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
  const [loaded, setLoaded] = useState<{
    key: string;
    details: GithubCheckDetails | null;
    error: string | null;
  } | null>(null);
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
  // Details belong to the check revision they were fetched for, so a new key
  // starts empty without a clearing effect.
  const current = loaded?.key === detailsKey ? loaded : null;
  const details = current?.details ?? null;
  const error = current?.error ?? null;
  const wantsAutoExpand = autoExpand && expandable;
  const [previousWantsAutoExpand, setPreviousWantsAutoExpand] = useState(wantsAutoExpand);
  if (previousWantsAutoExpand !== wantsAutoExpand) {
    setPreviousWantsAutoExpand(wantsAutoExpand);
    if (wantsAutoExpand) setExpanded(true);
  }
  useEffect(() => {
    if (!expanded || !jobId || (!cwd && (!check.provider || check.provider === "github"))) return;
    let active = true;
    setLoading(true);
    // Routine polls keep evidence mounted while fetching updated job steps.
    fetchCheckDetails(cwd, repo, check)
      .then(
        (result) => {
          if (active) setLoaded({ key: detailsKey, details: result, error: null });
        },
        (reason: unknown) => {
          if (!active) return;
          const message = reason instanceof Error ? reason.message : String(reason);
          setLoaded((previous) => ({
            key: detailsKey,
            details: previous?.key === detailsKey ? previous.details : null,
            error: message,
          }));
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
  const subtitle =
    failureMessage || (failedStep ? t("Failed at {p0}", { p0: failedStep }) : status);
  const title = `${check.name} · ${status}${duration ? `, ${t("took {p0}", { p0: duration })}` : ""}${workflow ? `, ${workflow}` : ""}`;
  const rowHint = useTooltip({
    label: [
      check.name,
      workflow,
      failureMessage || failedStep ? subtitle : undefined,
      status,
      duration,
      failureMessage && failedStep ? t("Failed at {p0}", { p0: failedStep }) : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    when: "overflow",
  });
  const url = check.url;
  const linked = isHttpUrl(url);
  const body = (
    <>
      <span className="grid h-7 w-5 shrink-0 place-items-center">
        <MarkGlyph mark={mark} size="md" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2.5">
          <span
            data-check-name
            className={`min-w-0 ${expanded ? "break-all" : "truncate"} text-ui-secondary font-medium text-(--ui-tone-neutral-fg)`}
          >
            {check.name}
          </span>
          {workflow ? (
            <span className="min-w-0 shrink-[2] truncate text-ui-micro text-(--ui-text-secondary) @max-[560px]/checks:hidden">
              {workflow}
            </span>
          ) : null}
        </span>
        {(!repairItem || expanded) && (failureMessage || failedStep) ? (
          <span
            className={`mt-0.5 min-w-0 ${expanded ? "break-words" : "truncate"} text-ui-caption text-(--ui-text-secondary)`}
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
  const className =
    "flex w-full min-w-0 flex-1 items-center gap-2.5 rounded-(--ui-control-radius) text-left";
  return (
    <li
      {...rowHint.trigger}
      onPointerEnter={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-no-drag]")) return;
        rowHint.trigger.onPointerEnter(event);
      }}
      onPointerOver={(event) => {
        if (event.target instanceof Element && event.target.closest("[data-no-drag]"))
          rowHint.hide();
        else rowHint.trigger.onPointerEnter(event);
      }}
      onFocus={(event) => {
        if (event.target.closest("[data-no-drag]")) rowHint.hide();
        else rowHint.trigger.onFocus(event);
      }}
      ref={rowRef}
      tabIndex={-1}
      className="min-w-0 rounded-(--ui-control-radius) outline-none"
    >
      <ActionHost className="min-w-0 gap-2 px-2 py-1 @max-[420px]/checks:gap-1">
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
            aria-label={title}
            onClick={() => openUrlSafely(url)}
          >
            {body}
          </Button>
        ) : (
          <div className={className}>{body}</div>
        )}
        <span className={`shrink-0 text-left ${wideStatus ? "w-24" : "w-14"}`}>
          {repairItem ? (
            <CheckRepairStatus item={repairItem} />
          ) : (
            <Badge tone={mark.tone} size="xs" appearance="subtle">
              {status}
            </Badge>
          )}
        </span>
        <span className="mr-1 w-11 shrink-0 whitespace-nowrap text-right text-ui-caption tabular-nums text-(--ui-text-secondary) @max-[480px]/checks:hidden">
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
            tooltip={t("Fix with AI")}
            data-no-drag=""
            className="shrink-0"
          >
            <Sparkles className="icon-sm" strokeWidth={1.75} />
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
            data-no-drag=""
            className="shrink-0"
          >
            <ChevronRight
              className={`icon-xs transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
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
            tooltip={t("View full log")}
            aria-label={t("Open {p0} check", { p0: check.name })}
            data-no-drag=""
            onClick={() => openUrlSafely(url)}
          >
            <ExternalLink className="icon-xs" strokeWidth={1.75} />
          </Button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
      </ActionHost>
      {expanded ? (
        <div
          id={detailsId}
          className="min-w-0 space-y-3 py-3 pl-10 pr-3 text-ui-caption @max-[420px]/checks:pl-3"
        >
          {loading && !details && !error ? (
            <LoadingText className="px-2 py-1">{t("Loading steps…")}</LoadingText>
          ) : null}
          {error ? (
            <Alert tone="info" role="alert">
              <p>{t("Could not load job details.")}</p>
              <p className="break-words text-ui-micro">{error}</p>
              <Button
                variant="ghost"
                type="button"
                loading={loading}
                onClick={() => setRetry((value) => value + 1)}
              >
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
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-ui-micro text-(--ui-text-secondary) hover:text-(--ui-tone-neutral-fg) [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="icon-xs transition-transform group-open/steps:rotate-90 motion-reduce:transition-none" />
                    {t("View run steps")}
                    <span className="ml-auto pl-2 text-right text-ui-caption text-(--ui-text-secondary) @max-[420px]/checks:hidden">
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
                          <MarkGlyph mark={stepMark} size="md" />
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
                <EmptyState
                  size="inline"
                  kind="empty"
                  description={t("No steps reported for this job.")}
                />
              )}
              {check.state === "fail" && !details.annotations.length && !details.notice ? (
                <EmptyState
                  size="inline"
                  kind="empty"
                  description={t(
                    "No error annotations reported. View the full log at the check URL.",
                  )}
                />
              ) : null}
              {details.log ? (
                <details className="mt-3">
                  <summary>{t("View logs")}</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-ui-micro">
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
      {rowHint.tooltip}
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
  if (selection && !selectionValid) setSelection(null);
  if (loading && !checks && !error) {
    return <LoadingText className="py-5">{t("Loading checks…")}</LoadingText>;
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
          tooltip={t("Retry loading checks")}
          aria-label={t("Retry loading checks")}
          loading={loading || refreshing}
          startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} />}
          onClick={onRefresh}
        >
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
        <p className="px-2 text-ui-caption text-(--ui-text-secondary)">
          {t("Pipeline commit")}: {checks.pipelineOid.slice(0, 12)} · {t("Source commit")}:{" "}
          {checks.headOid.slice(0, 12)}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-ui-title font-medium leading-snug">{t(headline)}</h2>
            {stale ? (
              <Badge tone="warning" size="xs">
                {t("Saved results")}
              </Badge>
            ) : null}
          </div>
          {checks?.headOid ? (
            <p className="mt-1 break-all text-ui-caption text-(--ui-text-secondary)">
              {t("Checked commit")}:{" "}
              <span className="font-mono" title={checks.headOid}>
                {checks.headOid.slice(0, 12)}
              </span>
            </p>
          ) : null}
          {summary ? (
            <p className="mt-1 text-ui-caption text-(--ui-text-secondary)">
              {summary.charAt(0).toUpperCase() + summary.slice(1)}.
            </p>
          ) : null}
          <span className="sr-only">{describeCheckCounts(counts)}</span>
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
              <Sparkles className="icon-sm" strokeWidth={1.75} />
              {t("Fix all failed")}
              <Badge variant="count" size="xs" aria-hidden="true">
                {counts.fail}
              </Badge>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            type="button"
            iconOnly
            label={t("Refresh checks")}
            loading={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {stale ? (
        <Alert tone="warning" role={error ? "alert" : "status"}>
          <p className="text-ui-caption font-medium">
            {t(error ? "Checks refresh failed" : "Checking the latest revision…")}
          </p>
          {error ? <p className="break-words text-ui-caption">{error}</p> : null}
          <p className="break-words text-ui-caption">{t("Saved results may be out of date.")}</p>
          {error ? (
            <Button variant="ghost" loading={refreshing} onClick={onRefresh}>
              {t("Retry loading checks")}
            </Button>
          ) : null}
        </Alert>
      ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-2 py-1">
          <SegmentedControl
            label={t("Filter checks")}
            selectionRole="pressed"
            value={activeFilter}
            onValueChange={(value) => {
              if (value !== "attention" && value !== "all") return;
              if (value === "attention" && !attention) return;
              setFilter(value);
              setShowOthers(false);
              setSelection(null);
            }}
            options={[
              {
                value: "attention",
                label: t("Needs attention"),
                accessory: <span className="tabular-nums">{attention}</span>,
              },
              {
                value: "all",
                label: t("All checks"),
                accessory: <span className="tabular-nums">{rows.length}</span>,
              },
            ]}
          />
          <span className="text-ui-caption text-(--ui-text-secondary) @max-[420px]/checks:hidden">
            {counts.fail ? t("Failures first") : ""}
          </span>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState size="inline" kind="empty" description={t("No checks reported")} />
      ) : (
        <>
          {groups.map((group) =>
            group.rows.length ? (
              <div key={group.state} hidden={group.hidden} className={group.hidden ? "hidden" : ""}>
                <h3 className="mb-1.5 mt-3 flex items-center gap-2 px-2 text-ui-caption font-normal text-(--ui-text-secondary)">
                  {checkStateLabel(group.state)}
                  <span className="text-ui-caption text-(--ui-text-secondary)">
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
              <ChevronRight className={`icon-xs ${showOthers ? "rotate-90" : ""}`} />
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
