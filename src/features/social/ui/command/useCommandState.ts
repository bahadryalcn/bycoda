import { useRef, useState, type SetStateAction } from "react";
import type { AiPlan, AiReport, AiSummary } from "../../model/socialActions";
import type { AiAction } from "../../model/autonomy";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import type { StepResult } from "./commandModel";

export type ReportState = { period: "day" | "week"; data: AiReport };
type CommandState = {
  text: string;
  plan?: AiPlan;
  results: Record<string, StepResult>;
  approved: string[];
  summary?: AiSummary;
  actions?: AiAction[];
  report?: ReportState;
  error?: string;
  activityError?: string;
  moreError?: string;
  busy?: string;
  next?: string;
  loadingMore: boolean;
};
export type CommandRuntime = {
  operation?: symbol;
  feedRead?: symbol;
  feedVersion?: number;
  paged: boolean;
  headIds?: Set<string>;
};
const initial = (): CommandState => ({ text: "", results: {}, approved: [], loadingMore: false });

/** Retained local state and in-flight identity per Host/project; callbacks always update their original owner. */
export function useCommandState(client: SocialClient, projectId?: string) {
  const key = JSON.stringify([...socialQueryScope(client), projectId ?? ""]);
  const [states, setStates] = useState<Record<string, CommandState>>({});
  const runtimes = useRef(new Map<string, { current: CommandRuntime }>());
  let runtime = runtimes.current.get(key);
  if (!runtime) {
    runtime = { current: { paged: false } };
    runtimes.current.set(key, runtime);
  }
  const setter =
    <Key extends keyof CommandState>(field: Key) =>
    (next: SetStateAction<CommandState[Key]>) =>
      setStates((all) => {
        const current = all[key] ?? initial();
        const value =
          typeof next === "function"
            ? (next as (old: CommandState[Key]) => CommandState[Key])(current[field])
            : next;
        return { ...all, [key]: { ...current, [field]: value } };
      });
  const currentRuntime = runtime;
  return {
    scopeKey: key,
    state: states[key] ?? initial(),
    setter,
    runtime: {
      read: () => currentRuntime.current,
      update: (patch: Partial<CommandRuntime>) => Object.assign(currentRuntime.current, patch),
    },
  };
}
