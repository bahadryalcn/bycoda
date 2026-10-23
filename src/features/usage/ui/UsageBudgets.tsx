import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
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

const scopes = ["project", "session", "workspace"] as const;
const scopeLabel = { project: "Project", session: "Session", workspace: "Workspace" };
const periodLabel = { all: "All time", weekly: "Rolling 7 days", fiveHour: "5 hours" };
const subscribeNothing = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function UsageBudgets({ refresh = 0 }: { refresh?: number }) {
  const mounted = useSyncExternalStore(subscribeNothing, clientSnapshot, serverSnapshot);
  return mounted ? <UsageBudgetsContent refresh={refresh} /> : null;
}

function UsageBudgetsContent({ refresh }: { refresh: number }) {
  useLocale();
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
  const readings = pending ? {} : (load?.readings ?? {});
  const error = writeError || load?.error;
  const now = load?.now ?? 0;
  const editorVisible =
    editor === "new" ||
    (editor &&
      (editor.scope === "workspace"
        ? !lock.lockedGroupIds.has(editor.target)
        : !isProjectLockedIn(lock, editor.project ?? editor.target)));

  const visible = budgets.filter((b) =>
    b.scope === "workspace"
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
    <section className="mb-7 space-y-3" aria-label={t("Usage budgets")} aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-ui-body font-medium">{t("Usage budgets")}</h2>
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
      <p className="text-ui-caption text-(--ui-text-secondary)">
        {t(
          "Budgets apply to local desktop turns. Host tasks, remote sessions and other machines are not covered.",
        )}
      </p>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="info" role="status">
          {t("Budget saved")}
        </Alert>
      ) : null}
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
      {pending && !visible.length ? (
        <Alert tone="info" role="status">
          {t("Checking budget usage…")}
        </Alert>
      ) : null}
      {!pending && !visible.length && !editor && !error ? (
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("No usage budgets. Add a project, session or workspace budget.")}
        </p>
      ) : null}
      {visible.map((budget) => {
        const reading = readings[budget.id];
        const known = reading?.used != null;
        const format = (n: number) =>
          budget.metric === "tokens" ? formatUsageTokens(n) : `${n.toFixed(1)}%`;
        return (
          <div key={budget.id} className="space-y-2 border-b border-stroke py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words text-ui-caption font-medium">{budget.label}</h3>
                <p className="text-ui-caption text-(--ui-text-secondary)">
                  {t(scopeLabel[budget.scope])} · {t(periodLabel[budget.period])} ·{" "}
                  {t(budget.action === "block" ? "Block new turns" : "Monitor only")}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  disabled={pending}
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
                  disabled={pending}
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
                <p className="text-ui-caption">
                  {format(reading.used!)} / {format(reading.limit)} ·{" "}
                  {t(
                    reading.state === "exceeded"
                      ? "Budget reached"
                      : reading.state === "warning"
                        ? "Approaching budget"
                        : "Within budget",
                  )}
                </p>
              </>
            ) : (
              <Alert tone="info" role="status">
                {t(
                  pending
                    ? "Checking budget usage…"
                    : "Usage unavailable. No zero usage is assumed.",
                )}
              </Alert>
            )}
            {budget.metric === "accountPercent" ? (
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {budget.provider} ·{" "}
                {providerAccounts(budget.provider).find((a) => a.id === budget.accountId)?.label ??
                  t("Account unavailable")}{" "}
                · {t("Account-wide threshold, not attributed scope consumption.")}
                {reading?.resetsAt != null
                  ? ` · ${formatResetCountdown(reading.resetsAt - now)}`
                  : null}
              </p>
            ) : null}
            {budget.scope === "workspace" &&
            !loadProjectGroups().some((g) => g.id === budget.target) ? (
              <p className="text-ui-caption text-danger">{t("Workspace unavailable")}</p>
            ) : null}
          </div>
        );
      })}
      <details className="text-ui-caption text-(--ui-text-secondary)">
        <summary>{t("How budgets are measured")}</summary>
        <p className="mt-2">
          {t(
            "Token budgets include input, output and cache tokens from local records. Project and workspace reports use 15-minute buckets; boundary buckets are included. Session budgets require complete turn metrics. Percentage rules compare the selected account's weekly or 5-hour usage with your threshold; they do not reserve provider capacity. Missing or stale data blocks new turns only when blocking is enabled. Running turns can exceed a budget.",
          )}
        </p>
      </details>
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
  const [scope, setScope] = useState<BudgetScope>(budget?.scope ?? "project");
  const [target, setTarget] = useState(budget?.target ?? "");
  const [label, setLabel] = useState(budget?.label ?? "");
  const [metric, setMetric] = useState<UsageBudget["metric"]>(budget?.metric ?? "tokens");
  const [period, setPeriod] = useState<UsageBudget["period"]>(budget?.period ?? "weekly");
  const [capacity, setCapacity] = useState(String(budget?.capacity ?? 1_000_000));
  const [percent, setPercent] = useState(String(budget?.percent ?? 100));
  const [action, setAction] = useState<UsageBudget["action"]>(budget?.action ?? "monitor");
  const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
  const [account, setAccount] = useState(budget ? `${budget.provider}:${budget.accountId}` : "");
  const [error, setError] = useState("");
  const targets =
    scope === "project"
      ? projectPaths.map((p) => ({ value: pathKey(p), label: p }))
      : scope === "workspace"
        ? groups.map((g) => ({ value: g.id, label: g.name }))
        : sessions.map((s) => ({ value: s.id, label: `${s.title} · ${s.cwd}` }));
  if (budget?.scope === scope && !targets.some((o) => o.value === budget.target)) {
    targets.push({ value: budget.target, label: budget.label });
  }
  const selectedAccount = accounts.find((a) => `${a.provider}:${a.id}` === account);
  return (
    <form
      className="space-y-3 border-y border-stroke py-3"
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
          onSave();
        } catch {
          setError(t("Usage budget settings could not be saved."));
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <BudgetSelect
          label={t("Scope")}
          value={scope}
          onChange={(v) => {
            setScope(v as BudgetScope);
            setTarget("");
          }}
          options={scopes.map((s) => ({ value: s, label: t(scopeLabel[s]) }))}
        />
        <BudgetSelect
          label={t("Budget target")}
          value={target}
          onChange={setTarget}
          options={targets}
        />
        <TextField
          label={t("Budget name")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
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
            { value: "accountPercent", label: t("Provider account threshold (%)") },
          ]}
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
          label={t("When reached")}
          value={action}
          onChange={(v) => setAction(v as UsageBudget["action"])}
          options={[
            { value: "monitor", label: t("Monitor only") },
            { value: "block", label: t("Block new turns") },
          ]}
        />
      </div>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {t("Save budget")}
        </Button>
        <Button onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}

function BudgetSelect(props: ComponentProps<typeof SearchableSelect>) {
  return (
    <div className="space-y-1">
      <span className="text-ui-caption font-medium">{props.label}</span>
      <SearchableSelect {...props} />
    </div>
  );
}
