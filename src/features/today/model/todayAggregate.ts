import { pathKey, projectName } from "../../../shared/lib/paths";
import type { AccountUsage, UsagePricing } from "../../providers/public/providerUsage";
import {
  durationSamples,
  emptyUsageFilters,
  filterUsage,
  sessionUsage,
  usageBreakdown,
  usageSamples,
  usageTotals,
  type UsageTurn,
  type UsageWindow,
} from "../../usage/public/usageAnalytics";

export type TodayPeriod = "today" | "week";

export type TodayProject = {
  key: string;
  label: string;
  /** Full folder path, for display and as the working directory of a summary request only. */
  path: string;
  cost: number;
  runMs: number;
  sessions: number;
  /** Tokens without a known price: the cost is a floor. */
  unpricedTokens: number;
  /** Titles of the sessions touched, longest-running first. */
  titles: string[];
};

export type TodayTotals = {
  cost: number;
  runMs: number;
  sessions: number;
  unpricedTokens: number;
};

export type TodayDay = TodayTotals & { key: string; start: number };

export type TodayData = {
  period: TodayPeriod;
  window: UsageWindow;
  totals: TodayTotals;
  projects: TodayProject[];
  /** One entry per local day of the window, oldest first. */
  days: TodayDay[];
};

const noGroup = () => null;

/** Local midnight, or the Monday of the current week (as the Usage page and activity totals). */
export function todayWindow(period: TodayPeriod, now: number): UsageWindow {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return { start: start.getTime(), end: now };
}

function dayKey(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Cost comes from the Usage page's own functions over the same provider-log rows and pricing;
 * run time and sessions come from its recorded turns. Nothing is priced here.
 */
function summarizeWindow(
  usage: readonly AccountUsage[],
  turns: readonly UsageTurn[],
  pricing: UsagePricing,
  window: UsageWindow,
): { totals: TodayTotals; projects: TodayProject[] } {
  const filters = emptyUsageFilters();
  const logs = filterUsage(usageSamples(usage, pricing, noGroup), filters, window);
  const runtime = durationSamples(turns, window, filters, noGroup);
  const rows = usageBreakdown([...logs, ...runtime], "project", "cost");
  const projects = new Map<string, TodayProject>();
  for (const row of rows) {
    projects.set(row.key, {
      key: row.key,
      label: row.label,
      path: "",
      cost: row.cost,
      runMs: row.duration,
      sessions: 0,
      unpricedTokens: row.unpricedTokens,
      titles: [],
    });
  }
  const sessions = sessionUsage(turns, window, filters, pricing, noGroup).sort(
    (a, b) => b.duration - a.duration,
  );
  for (const session of sessions) {
    const key = session.project ? pathKey(session.project) : "";
    let project = projects.get(key);
    if (!project) {
      project = {
        key,
        label: session.project ? projectName(session.project) : "Unknown folder",
        path: "",
        cost: 0,
        runMs: 0,
        sessions: 0,
        unpricedTokens: 0,
        titles: [],
      };
      projects.set(key, project);
    }
    project.path ||= session.project;
    project.sessions++;
    if (session.title) project.titles.push(session.title);
  }
  const list = [...projects.values()].sort(
    (a, b) => b.cost - a.cost || b.runMs - a.runMs || a.label.localeCompare(b.label),
  );
  return {
    projects: list,
    totals: {
      cost: usageTotals(logs).cost,
      runMs: usageTotals(runtime).duration,
      sessions: sessions.length,
      unpricedTokens: list.reduce((sum, project) => sum + project.unpricedTokens, 0),
    },
  };
}

/** Today or this week, by project and by local day. */
export function summarizeToday(input: {
  usage: readonly AccountUsage[];
  turns: readonly UsageTurn[];
  pricing: UsagePricing;
  period: TodayPeriod;
  now: number;
}): TodayData {
  const { usage, turns, pricing, period, now } = input;
  const window = todayWindow(period, now);
  const whole = summarizeWindow(usage, turns, pricing, window);
  const days: TodayDay[] = [];
  for (const cursor = new Date(window.start); cursor.getTime() < window.end;) {
    const start = cursor.getTime();
    cursor.setDate(cursor.getDate() + 1);
    const end = Math.min(cursor.getTime(), window.end);
    days.push({
      key: dayKey(start),
      start,
      ...summarizeWindow(usage, turns, pricing, { start, end }).totals,
    });
  }
  return {
    period,
    window,
    totals: whole.totals,
    projects: whole.projects,
    days,
  };
}
