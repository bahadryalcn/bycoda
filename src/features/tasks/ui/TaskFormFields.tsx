import "./task-form.css";
import type { ReactNode } from "react";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Select } from "../../../shared/ui/Select";
import { t, useLocale } from "../../../shared/i18n";
import {
  invalidateMachineSnapshot,
  machineProjects,
} from "../../automations/model/machineSnapshot";
import { useEffect, useState } from "react";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { backgroundMachineFor, hostProjectCwd } from "../../automations/model/hostAutomationClient";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import type { RemoteMachine } from "../../connections";
import type { RecentProject } from "../../projects/public/recents";

// The same choices as an automation's run time limit.
export const RUN_TIME_LIMIT_OPTIONS = [
  {
    value: "0",
    get label() {
      return t("No limit");
    },
  },
  {
    value: "15",
    get label() {
      return t("15 minutes");
    },
  },
  {
    value: "30",
    get label() {
      return t("30 minutes");
    },
  },
  {
    value: "60",
    get label() {
      return t("1 hour");
    },
  },
  {
    value: "120",
    get label() {
      return t("2 hours");
    },
  },
  {
    value: "240",
    get label() {
      return t("4 hours");
    },
  },
  {
    value: "480",
    get label() {
      return t("8 hours");
    },
  },
] as const;

/** The machine that would run a task for the project at `cwd`, if connected. */
export function machineName(
  machines: readonly RemoteMachine[],
  cwd: string,
  machineId?: string,
): string | undefined {
  const machine = backgroundMachineFor(machines, cwd);
  if (!machine || (machineId && machine.id !== machineId)) return undefined;
  return isLocalSyncMachine(machine) ? t("this computer") : machine.name;
}

const NO_PROJECTS: RecentProject[] = [];

/** Project discovery belongs to the selected host. Late responses cannot replace
 * the new host's choices, and errors have a local retry action. */
export function useTaskMachineProjects(target: RemoteMachine | undefined, enabled = true) {
  const [revision, setRevision] = useState(0);
  // The answer belongs to the host and revision it was read for; any other key
  // starts empty and loading, with no reset pass after render.
  const [answer, setAnswer] = useState<{
    key: string;
    projects: RecentProject[];
    error: string | null;
  } | null>(null);
  const key = JSON.stringify([
    target?.id,
    target?.endpoint,
    target?.environmentId,
    target?.localHost,
    target?.name,
    enabled,
    revision,
  ]);
  useEffect(() => {
    if (!target || !enabled) return;
    let cancelled = false;
    void machineProjects(target).then(
      (entries) => {
        if (!cancelled)
          setAnswer({
            key,
            projects: entries.map((project) => ({
              path: hostProjectCwd(target, project),
              openedAt: 0,
            })),
            error: null,
          });
      },
      (reason) => {
        if (!cancelled) setAnswer({ key, projects: [], error: String(reason) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  const current = answer?.key === key ? answer : null;
  const projects = current?.projects ?? NO_PROJECTS;
  const error = current?.error ?? null;
  const loading = Boolean(target && enabled) && !current;
  const retry = () => {
    if (target) invalidateMachineSnapshot(target.id);
    setRevision((value) => value + 1);
  };
  return { projects, error, loading, retry };
}

export function ProjectDiscoveryStatus({
  state,
}: {
  state: ReturnType<typeof useTaskMachineProjects>;
}) {
  return state.error ? (
    <InlineMessage tone="warning" live="assertive" retry={{ onRetry: state.retry }}>
      {state.error}
    </InlineMessage>
  ) : state.loading ? (
    <LoadingText>{t("Loading projects…")}</LoadingText>
  ) : null;
}

/** One settings row: title and an optional one-line description, the control at the end. */
export function TaskFormRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="task-form-row">
      <span className="task-form-row-text">
        <span>{label}</span>
        {description ? <span className="task-form-row-desc">{description}</span> : null}
      </span>
      <span className="task-form-row-control">{children}</span>
    </div>
  );
}

export function ContinueUntilDoneField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      className="task-form-row task-form-check"
      label={t("Continue until complete")}
      description={t("Keeps correcting while progress is made; asks for input when needed.")}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

/** Where the task runs: automatic, the shared checkout or a separate worktree. */
export function TaskExecutionMode({
  isolate,
  disabled,
  onChange,
}: {
  isolate?: boolean;
  disabled?: boolean;
  onChange: (isolate: boolean | undefined) => void;
}) {
  return (
    <TaskFormRow label={t("Execution mode")}>
      <Select
        hideLabel
        disabled={disabled}
        label={t("Execution mode")}
        value={isolate === undefined ? "automatic" : isolate ? "isolated" : "shared"}
        options={[
          { value: "automatic", label: t("Automatic") },
          { value: "shared", label: t("Shared checkout") },
          { value: "isolated", label: t("Separate worktree") },
        ]}
        onValueChange={(value) =>
          onChange(value === "automatic" ? undefined : value === "isolated")
        }
      />
    </TaskFormRow>
  );
}

export function AutoMergeField({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  useLocale();
  return (
    <Checkbox
      className="task-form-row task-form-check"
      label={t("Merge automatically")}
      description={t("Automatic merge is suspended. Review changes to renew approval.")}
      checked={checked}
      disabled={disabled || !checked}
      onChange={(event) => {
        if (!event.target.checked) onChange(false);
      }}
    />
  );
}
