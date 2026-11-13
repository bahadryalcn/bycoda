import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { LiveText } from "../../../shared/ui/LiveText";
import { Badge, type BadgeTone } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Spinner } from "../../../shared/ui/Spinner";
import { Tab } from "../../../shared/ui/Tabs";
import { useTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { fetchCheckDetails, hasCheckDetails } from "../model/prChecks";
import { useT, useFormat } from "../../../shared/i18n";
import { CheckRepairForm, type CheckRepair } from "./CheckRepairForm";
import {
  CheckRepairProgress,
  CheckRepairStatus,
  findCheckRepair,
  useCheckRepairs,
  type RepairGroup,
} from "./CheckRepairProgress";
import { CheckEvidence } from "./CheckEvidence";
import { selectedChecksStillFailed } from "./prCheckSelection";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
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
  const t = useT();
  const mark = overallMark(overall);
  const label = t("Checks: {p0}", { p0: overall.description });
  return (
    <Tab value="checks" aria-label={label} tooltip={label}>
      <Text size="inherit" tone="inherit" leading="none">
        {t("Checks")}
      </Text>
      <MarkGlyph mark={mark} size="sm" />
      {overall.kind === "fail" ? (
        <Badge variant="count" size="xs">
          {overall.failed}
        </Badge>
      ) : null}
    </Tab>
  );
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
  const t = useT();
  const { formatNumber } = useFormat();
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
  const status = checkStateLabel(check.state, t);
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
          <Text
            data-check-name
            size="secondary"
            weight="medium"
            tone="neutral"
            truncate={!expanded}
            className={`min-w-0 ${expanded ? "break-all" : ""}`}
          >
            {check.name}
          </Text>
          {workflow ? (
            <Text
              size="micro"
              tone="secondary"
              truncate
              className="min-w-0 shrink-[2] @max-[560px]/checks:hidden"
            >
              {workflow}
            </Text>
          ) : null}
        </span>
        {(!repairItem || expanded) && (failureMessage || failedStep) ? (
          <Text
            size="caption"
            tone="secondary"
            truncate={!expanded}
            className={`mt-0.5 min-w-0 ${expanded ? "break-words" : ""}`}
          >
            {subtitle}
          </Text>
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
  const statusCell = (
    <span className={`shrink-0 text-left ${wideStatus ? "w-24" : "w-14"}`}>
      {repairItem ? (
        <CheckRepairStatus item={repairItem} />
      ) : (
        <Badge tone={mark.tone} size="xs" appearance="subtle">
          {status}
        </Badge>
      )}
    </span>
  );
  const durationCell = (
    <Text
      size="caption"
      tone="secondary"
      className="mr-1 w-11 shrink-0 whitespace-nowrap text-right tabular-nums @max-[480px]/checks:hidden"
    >
      {duration}
    </Text>
  );
  const fixButton = onFix ? (
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
  );
  const linkButton = linked ? (
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
  );
  const detailsBody = expanded ? (
    <Text
      as="div"
      size="caption"
      tone="inherit"
      id={detailsId}
      className="min-w-0 space-y-3 py-3 pl-10 pr-3 @max-[420px]/checks:pl-3"
    >
      {loading && !details && !error ? (
        <LoadingText className="px-2 py-1">{t("Loading steps…")}</LoadingText>
      ) : null}
      {error ? (
        <Alert tone="danger">
          <Text as="p" size="caption" tone="inherit">
            {t("Could not load job details.")}
          </Text>
          <Text as="p" size="micro" tone="inherit" className="break-words">
            {error}
          </Text>
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
            <Disclosure
              size="sm"
              summary={
                <>
                  {t("View run steps")}{" "}
                  <Text size="caption" tone="secondary" className="@max-[420px]/checks:hidden">
                    {describeCheckCounts(countChecks(details.steps), t, formatNumber)}
                  </Text>
                </>
              }
            >
              <ol className="space-y-1" aria-label={t("{p0} steps", { p0: check.name })}>
                {details.steps.map((step, index) => {
                  const stepMark = checkMark(step.state);
                  return (
                    <li
                      key={index}
                      {...surfaceAttributes(
                        {
                          radius: "sm",
                          tone: step.state === "fail" ? "danger" : undefined,
                        },
                        "flex items-center gap-2 px-2 py-1",
                      )}
                    >
                      <MarkGlyph mark={stepMark} size="md" />
                      <Text size="inherit" tone="secondary" className="min-w-0 flex-1 break-words">
                        {step.name}
                        <span className="sr-only">: {checkStateLabel(step.state, t)}</span>
                      </Text>
                      <Text size="inherit" tone="secondary" className="shrink-0 tabular-nums">
                        {checkDuration(step.startedAt, step.completedAt)}
                      </Text>
                    </li>
                  );
                })}
              </ol>
            </Disclosure>
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
              description={t("No error annotations reported. View the full log at the check URL.")}
            />
          ) : null}
          {details.log ? (
            <Disclosure size="sm" className="mt-3" summary={t("View logs")}>
              <OutputBlock size="micro" tone="inherit" className="mt-2 max-h-72 overflow-auto">
                {details.log}
              </OutputBlock>
            </Disclosure>
          ) : null}
          {/* Always mounted so a notice is announced when it first appears. */}
          <LiveText
            tone="secondary"
            className="mt-3 block empty:hidden"
            text={details.notice ?? ""}
          />
        </>
      ) : null}
    </Text>
  ) : null;
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
      className="min-w-0 rounded-(--ui-control-radius)"
    >
      {expandable ? (
        <Disclosure
          variant="row"
          size="sm"
          chevron="end"
          open={expanded}
          onOpenChange={setExpanded}
          summary={
            <span className="flex min-w-0 items-center gap-2.5">
              {body}
              {statusCell}
              {durationCell}
            </span>
          }
          summaryActions={
            <>
              {fixButton}
              {linkButton}
            </>
          }
        >
          {detailsBody}
        </Disclosure>
      ) : (
        <ActionHost
          padding={{ inline: "md", block: "xs" }}
          className="min-w-0 gap-2 @max-[420px]/checks:gap-1"
        >
          {linked ? (
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
          {statusCell}
          {durationCell}
          {fixButton}
          <span className="size-7 shrink-0" aria-hidden="true" />
          {linkButton}
        </ActionHost>
      )}
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
  const t = useT();
  const { formatNumber } = useFormat();
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
        <Alert tone="danger">{error}</Alert>
        <Button
          variant="ghost"
          type="button"
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
    other: state === "pass" || state === "skipping",
  }));
  const othersHidden = groups.some((group) => group.other && group.rows.length > 0);
  const renderGroup = (group: (typeof groups)[number]) =>
    group.rows.length ? (
      <div key={group.state}>
        <SectionLabel as="h3" count={group.rows.length} className="mb-1.5 mt-3 px-2">
          {checkStateLabel(group.state, t)}
        </SectionLabel>
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
                repairGroups.length === 0 && check === rows.find((row) => row.state === "fail")
              }
              refreshToken={checks}
            />
          ))}
        </ul>
      </div>
    ) : null;
  const requiredFailures = rows.filter((row) => row.state === "fail" && !row.allowFailure).length;
  const headline = requiredFailures
    ? t(requiredFailures === 1 ? "{p0} check needs a fix" : "{p0} checks need a fix", {
        p0: formatNumber(requiredFailures),
      })
    : counts.fail
      ? t("Optional checks failed")
      : counts.pending
        ? t(counts.pending === 1 ? "{p0} check is running" : "{p0} checks are running", {
            p0: formatNumber(counts.pending),
          })
        : attention
          ? t(attention === 1 ? "{p0} check needs attention" : "{p0} checks need attention", {
              p0: formatNumber(attention),
            })
          : counts.pass
            ? t("Checks passed")
            : t("No checks ran");
  const summary = describeCheckCounts({ ...counts, fail: 0 }, t, formatNumber);
  return (
    <section
      data-inbox-pr-checks
      aria-label={t("Pull request checks")}
      className="@container/checks flex min-w-0 flex-col gap-2"
    >
      {checks?.pipelineOid && checks.pipelineOid !== checks.headOid ? (
        <Text as="p" size="caption" tone="secondary" className="px-2">
          {t("Pipeline commit")}: {checks.pipelineOid.slice(0, 12)} · {t("Source commit")}:{" "}
          {checks.headOid.slice(0, 12)}
        </Text>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <Heading size="section">{headline}</Heading>
            {stale ? (
              <Badge tone="warning" size="xs">
                {t("Saved results")}
              </Badge>
            ) : null}
          </div>
          {checks?.headOid ? (
            <Text as="p" size="caption" tone="secondary" className="mt-1 break-all">
              {t("Checked commit")}:{" "}
              <Tooltip label={checks.headOid} asChild>
                <Code>{checks.headOid.slice(0, 12)}</Code>
              </Tooltip>
            </Text>
          ) : null}
          {summary ? (
            <Text as="p" size="caption" tone="secondary" className="mt-1">
              {summary.charAt(0).toUpperCase() + summary.slice(1)}.
            </Text>
          ) : null}
          <span className="sr-only">{describeCheckCounts(counts, t, formatNumber)}</span>
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
        <Alert tone={error ? "danger" : "warning"}>
          <Text as="p" size="caption" tone="inherit" weight="medium">
            {t(error ? "Checks refresh failed" : "Checking the latest revision…")}
          </Text>
          {error ? (
            <Text as="p" size="caption" tone="inherit" className="break-words">
              {error}
            </Text>
          ) : null}
          <Text as="p" size="caption" tone="inherit" className="break-words">
            {t("Saved results may be out of date.")}
          </Text>
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
          <Text size="caption" tone="secondary" className="@max-[420px]/checks:hidden">
            {counts.fail ? t("Failures first") : ""}
          </Text>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState size="inline" kind="empty" description={t("No checks reported")} />
      ) : (
        <>
          {groups.filter((group) => !group.other).map(renderGroup)}
          {othersHidden ? (
            <Disclosure
              size="sm"
              className={activeFilter === "attention" ? "mt-3" : "[&>summary]:hidden"}
              open={activeFilter !== "attention" || showOthers}
              onOpenChange={setShowOthers}
              summary={describeCheckCounts(
                {
                  ...countChecks([]),
                  pass: counts.pass,
                  skipping: counts.skipping,
                },
                t,
                formatNumber,
              )}
            >
              {groups.filter((group) => group.other).map(renderGroup)}
            </Disclosure>
          ) : null}
        </>
      )}
    </section>
  );
}
