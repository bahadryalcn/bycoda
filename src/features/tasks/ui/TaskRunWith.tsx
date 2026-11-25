import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import type { WorkExecutor } from "../../../shared/model/host-contracts/work-executor";
import { useConnectionErrorShownCentrally } from "../../../shared/ui/connectionErrorGate";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { useProjectCrews } from "../../crews/model/crewClient";
import { TaskFormRow } from "./TaskFormFields";

/** The Run with choice value for the Host-picked executor; crew choices use their id. */
const AUTO_EXECUTOR = "auto:";

function executorFor(value: string): WorkExecutor | undefined {
  if (!value) return undefined;
  return value === AUTO_EXECUTOR ? { kind: "auto" } : { kind: "crew", crewDefinitionId: value };
}

/**
 * The crews a work form can run with on one machine and project, and whether the chosen
 * executor still resolves. A saved crew that is gone is invalid instead of being replaced.
 */
export function useRunWith(cwd: string, machineId: string, executor: WorkExecutor | undefined) {
  const query = useProjectCrews(cwd, Boolean(machineId && cwd));
  const centralError = useConnectionErrorShownCentrally(query.error);
  const crews =
    query.data?.machine.id === machineId && query.data.taskExecutionSupported
      ? query.data.definitions
      : [];
  const crewId = executor?.kind === "crew" ? executor.crewDefinitionId : undefined;
  const crew = crews.find((entry) => entry.id === crewId);
  const loading = Boolean(crewId) && !query.data && !query.error && query.isFetching;
  return {
    query,
    centralError,
    crews,
    crew,
    crewId,
    valid: !crewId || Boolean(crew),
    loading,
    /** Offer the row only where a crew can run or one is already chosen. */
    offered: Boolean(executor) || crews.length > 0,
  };
}

export type RunWith = ReturnType<typeof useRunWith>;

/**
 * Who runs the work: one agent, a saved crew, or Auto (the Host picks a fitting crew or one agent
 * when the work starts). Loading, load failure and a crew that is gone show below the choice.
 */
export function TaskRunWithRow({
  runWith,
  executor,
  disabled,
  issue,
  choiceHidden = false,
  onChange,
  children,
}: {
  runWith: RunWith;
  executor: WorkExecutor | undefined;
  disabled?: boolean;
  /** Why the chosen crew cannot run with the rest of the form; the Host enforces the same rule. */
  issue?: string;
  /** A crew entry point fixed the choice; only its loading and failure still show. */
  choiceHidden?: boolean;
  onChange: (executor: WorkExecutor | undefined) => void;
  /** Rows that only apply to the chosen executor, shown right below the choice. */
  children?: ReactNode;
}) {
  useLocale();
  const { query } = runWith;
  return (
    <div>
      {choiceHidden ? null : (
        <TaskFormRow label={t("Run with")}>
        <SearchableSelect
          label={t("Run with")}
          hideLabel
          variant="pill"
          value={executor?.kind === "auto" ? AUTO_EXECUTOR : (runWith.crewId ?? "")}
          disabled={disabled}
          options={[
            { value: "", label: t("Agent") },
            { value: AUTO_EXECUTOR, label: t("Auto") },
            ...runWith.crews.map((entry) => ({
              value: entry.id,
              label: entry.name,
              description: entry.projectId ? t("This project") : t("All projects on this host"),
            })),
          ]}
          onChange={(value) => onChange(executorFor(value))}
        />
        </TaskFormRow>
      )}
      {choiceHidden ? null : children}
      {runWith.loading ? <LoadingText>{t("Loading crews…")}</LoadingText> : null}
      {query.error && !runWith.centralError ? (
        <InlineError
          details={query.error.message}
          retry={{
            onRetry: () => {
              void query.refetch().catch(() => {});
            },
            pending: query.isFetching,
          }}
        >
          {t("Could not load the crews for this project.")}
        </InlineError>
      ) : !runWith.valid && !runWith.loading ? (
        <InlineMessage tone="warning">
          {t("Connect an updated host and choose an available crew.")}
        </InlineMessage>
      ) : issue ? (
        <InlineMessage tone="warning">{issue}</InlineMessage>
      ) : null}
    </div>
  );
}
