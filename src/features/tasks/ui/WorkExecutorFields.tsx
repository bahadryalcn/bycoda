import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  AUTOMATIC_SUBAGENTS,
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENT_MAX_EFFORT_KEY,
  CROSS_SUBAGENTS_KEY,
  decodeAdvisor,
  decodeSubagents,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import type {
  ModelRoutingItemChoice,
  ModelRoutingRole,
} from "../../../shared/model/host-contracts/model-routing";
import type { WorkExecutor, WorkHelpers } from "../../../shared/model/host-contracts/work-executor";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Text } from "../../../shared/ui/Text";
import { CrewTaskPicker, useProjectCrews } from "../../crews/public/CrewTaskPicker";
import { DelegationLayerRows } from "../../model-routing/public/delegation";
import type { RemoteMachine } from "../../connections/public/protocol";
import type { HarnessId } from "../../sessions/public/session";
import { TaskModelChoiceField } from "./TaskModelChoiceField";

const ignoreValidity = () => {};

/** The helper keys a task may set; image models stay a Settings-only choice. */
const HELPER_KEYS = [CROSS_SUBAGENTS_KEY, CROSS_ADVISOR_KEY, CROSS_SUBAGENT_MAX_EFFORT_KEY];

/** The task's helper choice in the wire values the shared delegation rows edit. */
function helperValues(helpers: WorkHelpers): Record<string, string> {
  return {
    [CROSS_SUBAGENTS_KEY]: (helpers.models?.length && encodeSubagents(helpers.models)) || "auto",
    ...(helpers.advisor === null
      ? { [CROSS_ADVISOR_KEY]: "null" }
      : helpers.advisor
        ? { [CROSS_ADVISOR_KEY]: encodeAdvisor(helpers.advisor)! }
        : {}),
    ...(helpers.maxEffort ? { [CROSS_SUBAGENT_MAX_EFFORT_KEY]: helpers.maxEffort } : {}),
  };
}

function setHelper(helpers: WorkHelpers, key: string, value: string | undefined): WorkHelpers {
  // Off inside Use is the Off choice; Automatic is "any model Settings allow".
  if (key === CROSS_SUBAGENTS_KEY && value === "[]") return { mode: "off" };
  let { models, advisor, maxEffort } = helpers;
  if (key === CROSS_SUBAGENTS_KEY)
    models = value && value !== AUTOMATIC_SUBAGENTS ? decodeSubagents(value) : undefined;
  else if (key === CROSS_ADVISOR_KEY)
    advisor = value === "null" ? null : value ? decodeAdvisor(value) : undefined;
  else maxEffort = value || undefined;
  return {
    mode: "use",
    ...(models?.length ? { models } : {}),
    ...(maxEffort ? { maxEffort } : {}),
    ...(advisor === undefined ? {} : { advisor }),
  };
}

export type WorkExecutorFieldsProps = {
  /** Settings job that picks the model: `task.worker`, `automation`, `crew.member`. */
  routingRole: ModelRoutingRole;
  machine?: Pick<RemoteMachine, "id">;
  routingSupported: boolean;
  cwd: string;
  /** Provider whose catalog fills the helper model lists. */
  harness: HarnessId;
  modelSettings: Record<string, string>;
  executor: WorkExecutor | undefined;
  onExecutorChange: (executor: WorkExecutor | undefined) => void;
  /** Why the chosen crew cannot run with the rest of the form; the Host enforces the same rule. */
  executorIssue?: string;
  /** Whether the chosen crew still exists on this machine and project. */
  onCrewValidityChange?: (valid: boolean) => void;
  modelChoice: ModelRoutingItemChoice | undefined;
  onModelChoiceChange: (choice: ModelRoutingItemChoice) => void;
  /** The caller's own model picker, shown for a fixed choice. */
  fixedModel: ReactNode;
  helpers: WorkHelpers | undefined;
  onHelpersChange: (helpers: WorkHelpers | undefined) => void;
  /** Hide the executor row where the executor is not a choice (a crew's own member). */
  hideExecutor?: boolean;
  disabled?: boolean;
};

/**
 * Who runs the work and how: Executor (Agent, Crew or Auto), Model (Use settings or a choice)
 * and Helpers (Use settings, Off or Use). The one control set for new Task, Epic, Crew and
 * automation forms, so each says the same thing the Host later records in `resolved`.
 */
export function WorkExecutorFields(props: WorkExecutorFieldsProps) {
  useLocale();
  const { executor, helpers, disabled } = props;
  const crews = useProjectCrews(props.cwd, !!props.cwd && !!props.machine);
  const available =
    crews.data?.machine.id === props.machine?.id && crews.data?.taskExecutionSupported === true;
  const definitions = available ? crews.data!.definitions : [];
  const executorKind = executor?.kind ?? "agent";
  const crewId = executor?.kind === "crew" ? executor.crewDefinitionId : "";
  const crewsOffered = available || executorKind !== "agent";
  const helpersMode = helpers?.mode ?? "settings";
  return (
    <div className="work-executor">
      {props.hideExecutor ? null : (
        <div className="work-executor-row">
          <Text size="caption" tone="secondary">
            {t("Run with")}
          </Text>
          <SegmentedControl
            label={t("Run with")}
            value={executorKind}
            options={[
              { value: "agent", label: t("Agent"), disabled },
              ...(crewsOffered
                ? [
                    {
                      value: "crew",
                      label: t("Crew"),
                      disabled: disabled || (!definitions.length && executorKind !== "crew"),
                    },
                    { value: "auto", label: t("Auto"), disabled },
                  ]
                : []),
            ]}
            onValueChange={(next) =>
              props.onExecutorChange(
                next === "crew"
                  ? { kind: "crew", crewDefinitionId: definitions[0]?.id ?? crewId }
                  : next === "auto"
                    ? { kind: "auto" }
                    : undefined,
              )
            }
          />
          {executorKind === "crew" ? (
            <CrewTaskPicker
              cwd={props.cwd}
              machineId={props.machine?.id}
              value={crewId}
              disabled={disabled}
              onChange={(id) => props.onExecutorChange({ kind: "crew", crewDefinitionId: id })}
              onValidityChange={props.onCrewValidityChange ?? ignoreValidity}
            />
          ) : null}
          {props.executorIssue ? (
            <InlineMessage tone="warning">{props.executorIssue}</InlineMessage>
          ) : null}
        </div>
      )}
      <div className="work-executor-row">
        <Text size="caption" tone="secondary">
          {t("Model")}
        </Text>
        <TaskModelChoiceField
          machine={props.machine}
          routingRole={props.routingRole}
          value={props.modelChoice}
          supported={props.routingSupported}
          onChange={props.onModelChoiceChange}
          fixed={props.fixedModel}
        />
      </div>
      <div className="work-executor-row">
        <Text size="caption" tone="secondary">
          {t("Helpers")}
        </Text>
        <SegmentedControl
          label={t("Helpers")}
          value={helpersMode}
          options={[
            { value: "settings", label: t("Use settings"), disabled },
            { value: "off", label: t("Off"), disabled },
            { value: "use", label: t("Use"), disabled },
          ]}
          onValueChange={(next) =>
            props.onHelpersChange(next === "settings" ? undefined : { mode: next as "off" | "use" })
          }
        />
        {helpersMode === "use" ? (
          <DelegationLayerRows
            harness={props.harness}
            values={helperValues(helpers!)}
            inherited={{}}
            override
            disabled={!!disabled}
            keys={HELPER_KEYS}
            onSet={(key, value) => props.onHelpersChange(setHelper(helpers!, key, value))}
          />
        ) : null}
      </div>
    </div>
  );
}
