import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Alert } from "../../../shared/ui/Alert";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Badge } from "../../../shared/ui/Badge";
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { t } from "../../../shared/i18n";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { useLockSnapshot } from "../../group-lock/hooks/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/model/lockState";
import { loadProjectGroups } from "../../projects/model/projectGroups";
import { loadRecents } from "../../projects/model/recents";
import { providerAccounts } from "../../providers/model/providerAccounts";
import { formatUsageTokens } from "../../providers/model/providerUsage";
import { formatResetCountdown } from "../../providers/model/rateLimits";
import { getSessions, useShellSessions } from "../../sessions/model/sessionsStore";
import { pathKey } from "../../../shared/lib/paths";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { createBudgetReader } from "../model/usageBudgetReadings";
import {
  deleteUsageBudget,
  loadUsageBudgets,
  saveUsageBudget,
  subscribeUsageBudgets,
} from "../model/usageBudgetStore";
import {
  normalizeBudget,
  type BudgetReading,
  type BudgetScope,
  type UsageBudget,
} from "../model/usageBudgets";

const scopes = ["machine", "project", "session", "workspace"] as const;
const scopeLabel = {
  machine: "This machine",
  project: "Project",
  session: "Session",
  workspace: "Workspace",
};
const periodLabel = { all: "All time", weekly: "Rolling 7 days", fiveHour: "5 hours" };
const subscribeNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function UsageBudgets({ refresh = 0 }: { refresh?: number }) {
  const mounted = useSyncExternalStore(subscribeNothing, clientSnapshot, serverSnapshot);
  return mounted ? <UsageBudgetsContent refresh={refresh} /> : null;
}

function UsageBudgetsContent({ refresh }: { refresh: number }) {
  const sessions = useShellSessions();
  const lock = useLockSnapshot();
  const [version, setVersion] = useState(0);
  const [load, setLoad] = useState<{
    version: number;
    refresh: number;
    budgets: UsageBudget[];
    readings: Record<string, BudgetReading>;
    error: string;
    now: number;
  } | null>(null);
  const [writeError, setError] = useState("");
  const [editor, setEditor] = useState<UsageBudget | "new" | null>(null);
  const [saved, setSaved] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeUsageBudgets(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    const timer = window.setInterval(() => setVersion((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const rules = loadUsageBudgets();
        const instant = Date.now();
        const reader = createBudgetReader(getSessions(), instant);
        const rows = await Promise.all(rules.map(async (b) => [b.id, await reader(b)] as const));
        if (!cancelled)
          setLoad({
            version,
            refresh,
            budgets: rules,
            readings: Object.fromEntries(rows),
            error: "",
            now: instant,
          });
      } catch {
        if (!cancelled)
          setLoad({
            version,
            refresh,
            budgets: [],
            readings: {},
            error: t("Usage budget settings could not be read."),
            now: Date.now(),
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [version, refresh]);

  const pending = load?.version !== version || load?.refresh !== refresh;
  const budgets = load?.budgets ?? [];
  const readings = load?.readings ?? {};
  const error = writeError || load?.error;
  const now = load?.now ?? 0;
  const editorVisible =
    editor === "new" ||
    (editor &&
      (editor.scope === "machine"
        ? true
        : editor.scope === "workspace"
          ? !lock.lockedGroupIds.has(editor.target)
          : !isProjectLockedIn(lock, editor.project ?? editor.target)));

  const visible = budgets.filter((b) =>
    b.scope === "machine"
      ? true
      : b.scope === "workspace"
        ? !lock.lockedGroupIds.has(b.target)
        : b.scope === "project"
          ? !isProjectLockedIn(lock, b.target)
          : !!b.project && !isProjectLockedIn(lock, b.project),
  );
  const remove = (id: string) => {
    try {
      deleteUsageBudget(id);
      setSaved(false);
      setError("");
    } catch (cause) {
      setError(t("Usage budget settings could not be saved."));
      throw cause;
    }
  };
  return (
    <section className="space-y-2" aria-label={t("Usage budgets")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading size="section" level={2}>
            {t("Usage budgets")}
          </Heading>
          <InfoPopover label={t("About usage budgets")}>
            <p>
              {t(
                "Budgets apply to local desktop turns. Host tasks, remote sessions and other machines are not covered.",
              )}
            </p>
            <p>
              {t(
                "Local rules can overlap. Their readings are not added together and provider quota percentages are never pooled.",
              )}
            </p>
            <p>
              {t(
                "Token budgets include input, output and cache tokens from local records. Project and workspace reports use 15-minute buckets; boundary buckets are included. Session budgets require complete turn metrics. Percentage rules compare the selected account's weekly or 5-hour usage with your threshold; they do not reserve provider capacity. Missing or stale data blocks new turns only when blocking is enabled. Running turns can exceed a budget.",
              )}
            </p>
          </InfoPopover>
          {(["block", "monitor"] as const).map((action) => {
            const count = visible.filter((budget) => budget.action === action).length;
            return count ? (
              <Badge key={action}>
                {count} {t(action === "block" ? "Block new turns" : "Monitor only")}
              </Badge>
            ) : null;
          })}
          {!pending && !visible.length && !editor && !error ? (
            <EmptyState
              size="inline"
              kind="empty"
              description={t("No usage budgets. Add a project, session or workspace budget.")}
            />
          ) : null}
        </div>
        <Button
          ref={addButton}
          onClick={() => {
            setEditor("new");
            setSaved(false);
          }}
        >
          {t("Add budget")}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="info">{t("Budget saved")}</Alert> : null}
      {editor && editorVisible ? (
        <BudgetEditor
          key={editor === "new" ? "new" : editor.id}
          budget={editor === "new" ? undefined : editor}
          sessions={sessions.filter((s) => !isProjectLockedIn(lock, s.cwd))}
          projectPaths={[
            ...new Set([...loadRecents().map((p) => p.path), ...sessions.map((s) => s.cwd)]),
          ].filter((p) => !isProjectLockedIn(lock, p))}
          groups={loadProjectGroups().filter((g) => !lock.lockedGroupIds.has(g.id))}
          onCancel={() => {
            setEditor(null);
            addButton.current?.focus();
          }}
          onSave={() => {
            setEditor(null);
            setSaved(true);
            setError("");
            addButton.current?.focus();
          }}
        />
      ) : null}
      {pending && !visible.length ? <LoadingText>{t("Checking budget usage…")}</LoadingText> : null}
      {visible.map((budget) => {
        const reading =
          budget.scope === "machine" &&
          (lock.lockedGroupIds.size > 0 || (lock.lockedProjectKeys?.size ?? 0) > 0)
            ? undefined
            : readings[budget.id];
        const known = reading?.used != null;
        const format = (n: number) =>
          budget.metric === "tokens" ? formatUsageTokens(n) : `${n.toFixed(1)}%`;
        return (
          <Surface key={budget.id} variant="outline" padding="md" className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <SectionLabel as="h3" classNames={{ label: "usage-budget-title" }}>
                  {budget.label}
                </SectionLabel>
                <Text as="p">
                  {t(scopeLabel[budget.scope])} · {t(periodLabel[budget.period])} ·{" "}
                  {t(budget.action === "block" ? "Block new turns" : "Monitor only")}
                </Text>
                <Text as="p" className="break-all">
                  {budget.scope === "machine"
                    ? t("Supported local Codex and Claude usage")
                    : budget.scope === "workspace"
                      ? (loadProjectGroups().find((group) => group.id === budget.target)?.name ??
                        t("Workspace unavailable"))
                      : budget.scope === "session"
                        ? (sessions.find((session) => session.id === budget.target)?.title ??
                          budget.target)
                        : budget.target}
                </Text>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditor(budget);
                    setSaved(false);
                  }}
                >
                  {t("Edit")}
                </Button>
                <ConfirmMorph
                  label={t("Remove")}
                  tone="danger"
                  confirmMode="press"
                  onConfirm={() => remove(budget.id)}
                />
              </div>
            </div>
            {known && reading ? (
              <>
                <UsageMeter
                  label={budget.label}
                  segments={[{ id: "used", label: t("used"), value: reading.used! }]}
                  limit={reading.limit}
                  unit={budget.metric === "tokens" ? t("tokens") : "%"}
                  compact
                  showRemaining={false}
                />
                <Text as="p" tone="inherit">
                  {format(reading.used!)} / {format(reading.limit)} ·{" "}
                  {t(
                    reading.state === "exceeded"
                      ? "Budget reached"
                      : reading.state === "warning"
                        ? "Approaching budget"
                        : "Within budget",
                  )}
                </Text>
              </>
            ) : (
              <Alert tone="info">
                {t(
                  pending
                    ? "Checking budget usage…"
                    : "Usage unavailable. No zero usage is assumed.",
                )}
              </Alert>
            )}
            {pending && known ? (
              <LoadingText size="caption" tone="secondary">
                {t("Refreshing usage… Previous results remain visible.")}
              </LoadingText>
            ) : null}
            {!pending && known ? (
              <Text as="p">
                {t("Last observed")}: <Timestamp value={now} format="relative" />
              </Text>
            ) : null}
            {budget.metric === "accountPercent" ? (
              <Text as="p">
                {budget.provider} ·{" "}
                {providerAccounts(budget.provider).find((a) => a.id === budget.accountId)?.label ??
                  t("Account unavailable")}{" "}
                · {t("Account-wide threshold, not attributed scope consumption.")}
                {reading?.resetsAt != null
                  ? ` · ${formatResetCountdown(reading.resetsAt - now)}`
                  : null}
              </Text>
            ) : null}
            {budget.scope === "workspace" &&
            !loadProjectGroups().some((g) => g.id === budget.target) ? (
              <Text as="p" tone="danger">
                {t("Workspace unavailable")}
              </Text>
            ) : null}
          </Surface>
        );
      })}
    </section>
  );
}

function BudgetEditor({
  budget,
  sessions,
  projectPaths,
  groups,
  onSave,
  onCancel,
}: {
  budget?: UsageBudget;
  sessions: ReturnType<typeof getSessions>;
  projectPaths: string[];
  groups: ReturnType<typeof loadProjectGroups>;
  onSave: () => void;
  onCancel: () => void;
}) {
  const draftKey = `usage-budget:${budget?.id ?? "new"}`;
  const [scope, setScope] = useRetainedState<BudgetScope>(
    `${draftKey}:scope`,
    budget?.scope ?? "project",
  );
  const [target, setTarget] = useRetainedState(`${draftKey}:target`, budget?.target ?? "");
  const [label, setLabel] = useRetainedState(`${draftKey}:label`, budget?.label ?? "");
  const [metric, setMetric] = useRetainedState<UsageBudget["metric"]>(
    `${draftKey}:metric`,
    budget?.metric ?? "tokens",
  );
  const [period, setPeriod] = useRetainedState<UsageBudget["period"]>(
    `${draftKey}:period`,
    budget?.period ?? "weekly",
  );
  const [capacity, setCapacity] = useRetainedState(
    `${draftKey}:capacity`,
    String(budget?.capacity ?? 1_000_000),
  );
  const [percent, setPercent] = useRetainedState(
    `${draftKey}:percent`,
    String(budget?.percent ?? 100),
  );
  const [action, setAction] = useRetainedState<UsageBudget["action"]>(
    `${draftKey}:action`,
    budget?.action ?? "monitor",
  );
  const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
  const [account, setAccount] = useRetainedState(
    `${draftKey}:account`,
    budget ? `${budget.provider}:${budget.accountId}` : "",
  );
  const [error, setError] = useState("");
  const targets =
    scope === "machine"
      ? [{ value: "local", label: t("This machine") }]
      : scope === "project"
        ? projectPaths.map((p) => ({ value: pathKey(p), label: p }))
        : scope === "workspace"
          ? groups.map((g) => ({ value: g.id, label: g.name }))
          : sessions.map((s) => ({ value: s.id, label: `${s.title} · ${s.cwd}` }));
  if (budget?.scope === scope && !targets.some((o) => o.value === budget.target)) {
    targets.push({ value: budget.target, label: budget.label });
  }
  const selectedAccount = accounts.find((a) => `${a.provider}:${a.id}` === account);
  const effectiveLimit =
    Number(capacity) > 0 &&
    Number(percent) > 0 &&
    Number(percent) <= 100 &&
    Number.isFinite(Number(capacity) * Number(percent))
      ? formatUsageTokens((Number(capacity) * Number(percent)) / 100)
      : "—";
  const clearDraft = (saved?: UsageBudget) => {
    const value = budget ? (saved ?? budget) : undefined;
    setScope(value?.scope ?? "project");
    setTarget(value?.target ?? "");
    setLabel(value?.label ?? "");
    setMetric(value?.metric ?? "tokens");
    setPeriod(value?.period ?? "weekly");
    setCapacity(String(value?.capacity ?? 1_000_000));
    setPercent(String(value?.percent ?? 100));
    setAction(value?.action ?? "monitor");
    setAccount(value ? `${value.provider}:${value.accountId}` : "");
  };
  return (
    <form
      {...surfaceAttributes({ frame: "card", radius: "card" }, "space-y-3 p-3")}
      onSubmit={(event) => {
        event.preventDefault();
        const next = normalizeBudget({
          id: budget?.id ?? crypto.randomUUID(),
          scope,
          target,
          project: sessions.find((s) => s.id === target)?.cwd ?? budget?.project,
          label: label.trim() || targets.find((o) => o.value === target)?.label,
          metric,
          period,
          capacity: metric === "tokens" ? Number(capacity) : 100,
          percent: Number(percent),
          action,
          provider: selectedAccount?.provider ?? "codex",
          accountId: selectedAccount?.id ?? "default",
        });
        if (
          !next ||
          !targets.some((o) => o.value === target) ||
          (metric === "accountPercent" && !selectedAccount)
        ) {
          setError(
            t("Choose a target and valid positive limits. Percent must be between 0 and 100."),
          );
          return;
        }
        try {
          saveUsageBudget(next);
          clearDraft(next);
          onSave();
        } catch {
          setError(t("Usage budget settings could not be saved."));
        }
      }}
    >
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <BudgetSelect
          label={t("Scope")}
          info={
            scope === "machine" ? (
              <InfoPopover label={t("About machine budgets")}>
                <p>
                  {t(
                    "Supported local Codex and Claude usage. Missing, unsupported or private data stays unknown; a blocking rule refuses new turns until usage can be verified.",
                  )}
                </p>
                <p>
                  {t(
                    "Multiple profiles of one provider may share logs; common usage remains unknown until their sources can be verified.",
                  )}
                </p>
              </InfoPopover>
            ) : undefined
          }
          value={scope}
          onChange={(v) => {
            setScope(v as BudgetScope);
            setTarget(v === "machine" ? "local" : "");
            if (v === "machine") setMetric("tokens");
          }}
          options={scopes.map((s) => ({ value: s, label: t(scopeLabel[s]) }))}
        />
        <BudgetSelect
          label={t("Budget target")}
          value={target}
          onChange={setTarget}
          options={targets}
        />
        <BudgetSelect
          label={t("Measurement")}
          value={metric}
          onChange={(v) => {
            setMetric(v as UsageBudget["metric"]);
            if (v === "accountPercent" && period === "all") setPeriod("weekly");
          }}
          options={[
            { value: "tokens", label: t("Token allocation") },
            ...(scope === "machine"
              ? []
              : [{ value: "accountPercent", label: t("Provider account threshold (%)") }]),
          ]}
        />
        {metric === "tokens" ? (
          <NumberField
            label={t("Token capacity")}
            min={1}
            step={1}
            required
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        ) : (
          <BudgetSelect
            label={t("Provider account")}
            value={account}
            onChange={setAccount}
            options={accounts.map((a) => ({
              value: `${a.provider}:${a.id}`,
              label: `${a.provider} · ${a.label}`,
            }))}
          />
        )}
        <NumberField
          label={t(metric === "tokens" ? "Allocation (%)" : "Account usage threshold (%)")}
          min={0.01}
          max={100}
          step="any"
          required
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
        <BudgetSelect
          label={t("Period")}
          value={period}
          onChange={(v) => setPeriod(v as UsageBudget["period"])}
          options={(metric === "tokens"
            ? (["all", "weekly", "fiveHour"] as const)
            : (["weekly", "fiveHour"] as const)
          ).map((p) => ({ value: p, label: t(periodLabel[p]) }))}
        />
        <BudgetSelect
          label={t("When reached")}
          value={action}
          onChange={(v) => setAction(v as UsageBudget["action"])}
          options={[
            { value: "monitor", label: t("Monitor only") },
            { value: "block", label: t("Block new turns") },
          ]}
        />
        <TextField
          label={t("Budget name (optional)")}
          placeholder={
            targets.find((option) => option.value === target)?.label ?? t("Budget target")
          }
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
        />
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Text as="p" size="secondary">
          {metric === "tokens"
            ? `${t("Effective token limit")}: ${effectiveLimit}`
            : `${t("Account usage threshold (%)")}: ${percent}%`}
          {" · "}
          {t(action === "block" ? "Block new turns" : "Monitor only")}
        </Text>
        <Button type="submit" variant="primary">
          {t("Save budget")}
        </Button>
        <Button
          onClick={() => {
            clearDraft();
            onCancel();
          }}
        >
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

function BudgetSelect({
  info,
  ...props
}: ComponentProps<typeof SearchableSelect> & { info?: ReactNode }) {
  return (
    <div className="space-y-1">
      <Text tone="inherit" weight="medium" className="flex items-center gap-1">
        {props.label}
        {info}
      </Text>
      <SearchableSelect hideLabel {...props} />
    </div>
  );
}
