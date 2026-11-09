import { useCallback, useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import type { SocialClient } from "../../model/socialClient";
import type { AiPlan, AiReport, AiSummary } from "../../model/socialActions";
import type { AiAction } from "../../model/autonomy";
import type { SocialAgent, SocialPolicies } from "../../model/social";
import { savePolicyScope } from "../accounts/savePolicy";
import type { StepResult } from "./commandModel";

export type ReportState = { period: "day" | "week"; data: AiReport };

const messageOf = (caught: unknown) =>
  caught instanceof Error && caught.message
    ? caught.message
    : t("Something went wrong. Try again.");

/**
 * State and Host calls for the Command screen. Every write goes through the SocialClient
 * wrappers; the screen never composes an action name itself.
 */
export function useCommandScreen(client: SocialClient, projectId?: string) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<AiPlan | undefined>();
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [approved, setApproved] = useState<string[]>([]);
  const [summary, setSummary] = useState<AiSummary | undefined>();
  // undefined until a feed read succeeds, so a failed read is never shown as an empty feed.
  const [actions, setActions] = useState<AiAction[] | undefined>();
  const [report, setReport] = useState<ReportState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const read = useCallback(
    () => Promise.allSettled([client.ai.summary(), client.ai.actions()]),
    [client],
  );
  const apply = useCallback(([sum, feed]: Awaited<ReturnType<typeof read>>) => {
    if (sum.status === "fulfilled") setSummary(sum.value);
    if (feed.status === "fulfilled") setActions(feed.value.items);
    // A failed read is reported, never shown as an empty feed.
    if (sum.status === "rejected" || feed.status === "rejected")
      throw new Error(t("Could not load AI activity."));
  }, []);
  const refresh = useCallback(async () => apply(await read()), [read, apply]);

  useEffect(() => {
    read()
      .then(apply)
      .catch(() => setError(t("Could not load AI activity.")));
  }, [read, apply]);

  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await task();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(undefined);
    }
  }, []);

  const submit = () =>
    run("plan", async () => {
      const next = await client.ai.command({
        text: text.trim(),
        ...(projectId ? { projectId } : {}),
      });
      setPlan(next);
      setResults({});
      setApproved([]);
      setText("");
    });

  const approve = (ids: string[]) => setApproved((current) => [...new Set([...current, ...ids])]);

  const runPlan = () => {
    if (!plan) return;
    void run("run", async () => {
      const response = await client.ai.runPlan({ planId: plan.planId, approvedStepIds: approved });
      setResults(Object.fromEntries(response.results.map((item) => [item.stepId, item])));
      await refresh();
    }).catch(() => undefined);
  };

  const undo = (actionId: string) =>
    void run("undo", async () => {
      await client.ai.undo(actionId);
      await refresh();
    }).catch(() => undefined);

  const loadReport = (period: "day" | "week") =>
    void run("report", async () => {
      setReport({ period, data: await client.ai.report(period) });
    }).catch(() => undefined);

  /** Saves the global agent; the first-use card calls this and nothing else. */
  const saveModel = (agent: SocialAgent) =>
    void run("model", async () => {
      const current = await client.request<SocialPolicies>("policy.get");
      await savePolicyScope(client, current, "global", { ...current.global, agent });
    }).catch(() => undefined);

  return {
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
    busy,
    submit,
    approve,
    runPlan,
    undo,
    loadReport,
    saveModel,
  };
}
