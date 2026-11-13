import { useEffect, useRef } from "react";
import { t } from "../../../../shared/i18n";
import type { SocialClient } from "../../model/socialClient";
import type { AiAction } from "../../model/autonomy";
import type { SocialAgent, SocialPolicies } from "../../model/social";
import { savePolicyScope } from "../accounts/savePolicy";
import { useCommandState } from "./useCommandState";
export type { ReportState } from "./useCommandState";

const messageOf = (caught: unknown) =>
  caught instanceof Error && caught.message
    ? caught.message
    : t("Something went wrong. Try again.");
const mergeActions = (old: AiAction[], next: AiAction[]) =>
  [...new Map([...old, ...next].map((item) => [item.id, item])).values()].sort(
    (a, b) => b.at - a.at,
  );

/** Serialized owner actions and scoped, active-aware activity reads. No stale completion owns a newer plan. */
export function useCommandScreen(client: SocialClient, projectId?: string, active = true) {
  const { state, setter, runtime, scopeKey } = useCommandState(client, projectId);
  const {
    text,
    plan,
    results,
    approved,
    summary,
    actions,
    report,
    error,
    activityError,
    moreError,
    busy,
    next,
    loadingMore,
  } = state;
  const setText = setter("text");
  const setPlan = setter("plan");
  const setResults = setter("results");
  const setApproved = setter("approved");
  const setSummary = setter("summary");
  const setActions = setter("actions");
  const setReport = setter("report");
  const setError = setter("error");
  const setActivityError = setter("activityError");
  const setMoreError = setter("moreError");
  const setBusy = setter("busy");
  const setNext = setter("next");
  const setLoadingMore = setter("loadingMore");
  const lifetime = useRef({ version: 0 });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Async Host operations lose their UI owner when this hook unmounts.
  useEffect(() => {
    const owner = lifetime.current;
    return () => {
      owner.version++;
    };
  }, []);

  const refresh = async () => {
    if (runtime.read().feedRead && runtime.read().feedVersion === lifetime.current.version) return;
    const token = Symbol();
    const owner = lifetime.current.version;
    runtime.update({ feedRead: token, feedVersion: owner });
    try {
      const [sum, feed] = await Promise.allSettled([client.ai.summary(), client.ai.actions()]);
      if (owner !== lifetime.current.version) return;
      if (sum.status === "fulfilled") setSummary(sum.value);
      if (feed.status === "fulfilled") {
        setActions((old) =>
          runtime.read().paged ? mergeActions(old ?? [], feed.value.items) : feed.value.items,
        );
        // A disjoint refreshed head may hide whole pages above the retained tail.
        // Traverse its continuation again; mergeActions deduplicates retained history.
        const connected = feed.value.items.some((item) => runtime.read().headIds?.has(item.id));
        if (!runtime.read().paged || !connected) setNext(feed.value.next);
        runtime.update({ headIds: new Set(feed.value.items.map((item) => item.id)) });
      }
      setActivityError(
        sum.status === "rejected" || feed.status === "rejected"
          ? t("Could not load AI activity.")
          : undefined,
      );
    } finally {
      if (runtime.read().feedRead === token) runtime.update({ feedRead: undefined });
    }
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronize the active screen with Host activity through a bounded polling timer.
  useEffect(() => {
    if (!active) return;
    void refresh().catch(() => undefined);
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
    // Refresh reads current Host/project; state changes must not restart the polling interval.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Refresh lifetime follows scope and visibility only.
  }, [client, projectId, active]);

  const run = async (label: string, task: (current: () => boolean) => Promise<void>) => {
    if (runtime.read().operation) return;
    const token = Symbol();
    const owner = lifetime.current.version;
    runtime.update({ operation: token });
    const current = () => owner === lifetime.current.version && runtime.read().operation === token;
    setBusy(label);
    setError(undefined);
    try {
      await task(current);
    } catch (caught) {
      if (current()) setError(messageOf(caught));
    } finally {
      if (current()) {
        runtime.update({ operation: undefined });
        setBusy(undefined);
      }
    }
  };

  const submit = () => {
    const submitted = text;
    return run("plan", async (current) => {
      const nextPlan = await client.ai.command({
        text: submitted.trim(),
        ...(projectId ? { projectId } : {}),
      });
      if (!current()) return;
      setPlan(nextPlan);
      setResults({});
      setApproved([]);
      setText((value) => (value === submitted ? "" : value));
    });
  };
  const approve = (ids: string[]) => {
    if (!runtime.read().operation) setApproved((current) => [...new Set([...current, ...ids])]);
  };
  const runPlan = () => {
    if (!plan) return;
    void run("run", async (current) => {
      const response = await client.ai.runPlan({ planId: plan.planId, approvedStepIds: approved });
      if (!current()) return;
      setResults(Object.fromEntries(response.results.map((item) => [item.stepId, item])));
      await refresh();
    }).catch(() => undefined);
  };
  const undo = (actionId: string) =>
    void run("undo", async (current) => {
      await client.ai.undo(actionId);
      if (current()) await refresh();
    }).catch(() => undefined);
  const loadReport = (period: "day" | "week") =>
    void run("report", async (current) => {
      const data = await client.ai.report(period);
      if (current()) setReport({ period, data });
    }).catch(() => undefined);
  const saveModel = (agent: SocialAgent) =>
    void run("model", async (current) => {
      const policies = await client.request<SocialPolicies>("policy.get");
      if (current())
        await savePolicyScope(client, policies, "global", { ...policies.global, agent });
    }).catch(() => undefined);
  const loadMore = async () => {
    if (
      !next ||
      (runtime.read().feedRead && runtime.read().feedVersion === lifetime.current.version)
    )
      return;
    const token = Symbol();
    const owner = lifetime.current.version;
    runtime.update({ feedRead: token, feedVersion: owner });
    setLoadingMore(true);
    try {
      const page = await client.ai.actions({ cursor: next });
      if (owner !== lifetime.current.version) return;
      runtime.update({ paged: true });
      setActions((old) => mergeActions(old ?? [], page.items));
      setNext(page.next);
      setMoreError(undefined);
    } catch (caught) {
      if (owner === lifetime.current.version) setMoreError(messageOf(caught));
    } finally {
      if (runtime.read().feedRead === token) {
        runtime.update({ feedRead: undefined });
        setLoadingMore(false);
      }
    }
  };
  return {
    scopeKey,
    text,
    setText,
    plan,
    results,
    approved,
    summary,
    actions,
    report,
    error,
    setError,
    activityError,
    moreError,
    refresh,
    busy,
    submit,
    approve,
    runPlan,
    undo,
    loadReport,
    saveModel,
    next,
    loadingMore,
    loadMore,
  };
}
