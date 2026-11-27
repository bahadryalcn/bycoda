import { Divider } from "../../../shared/ui/Divider";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { useT } from "../../../shared/i18n";
import { ArrowLeftRight, Clock } from "../../../shared/ui/icons";
import { supportsProviderAccounts } from "../../providers/public/providerAccounts";
import { useProviderAccounts } from "../../providers/public/useProviderAccounts";
import { modelAccountIdentities } from "../model/accountModelChoices";
import { HARNESS_TITLE } from "../model/session";
import {
  sameSwitchState,
  type ModelSwitchMeta,
  type ModelSwitchState,
  type ModelSwitchStep,
} from "../model/modelSwitchHistory";
import { HarnessIcon } from "./HarnessIcon";
import { ModelAccountNumber } from "./ModelAccountIdentity";
import { ModelTriggerBadges } from "./ModelTriggerBadges";

type Props = { meta: ModelSwitchMeta; embedded?: boolean };

/** Earlier hops shown before the arrow; older ones fold into a count. */
const MAX_EARLIER = 3;

/**
 * Provider, account and model switches with no message between them, as one
 * divider row: the earlier states, an arrow, and the state now. The row reads
 * as one sentence to assistive tech.
 */
export function ModelSwitchRow({ meta, embedded = false }: Props) {
  const t = useT();
  const steps = meta.steps;
  const to = steps[steps.length - 1];
  if (!to || steps.length < 2) return null;
  const earlier = earlierStates(steps);
  const previous = earlier[earlier.length - 1];
  const shown = earlier.slice(-MAX_EARLIER);
  const folded = earlier.length - shown.length;
  const effort = changedEffort(previous, to);
  const note = stepNoteLabel(to, t);
  const title = t("Switched from {p0} to {p1}", {
    p0: earlier.map((state) => describe(state)).join(", "),
    p1: describe(to, effort ? t("Effort: {p0}", { p0: effort }) : undefined),
  });

  return (
    <div
      className={`@container/switch min-w-0 py-3 font-sans ${embedded ? "" : "px-4"}`}
      data-model-switch
    >
      <div className="flex items-center gap-3">
        <Divider decorative className="min-w-4 flex-1 self-center" />
        <Text
          as="div"
          role="note"
          aria-label={note ? `${title}. ${note}` : title}
          size="caption"
          tone="muted"
          className="flex min-w-0 max-w-full items-center gap-1.5 px-1.5"
        >
          <ArrowLeftRight className="icon-sm shrink-0" aria-hidden="true" />
          {folded > 0 ? (
            <Text
              aria-hidden="true"
              size="inherit"
              tone="inherit"
              className="shrink-0 tabular-nums"
            >
              +{folded}
            </Text>
          ) : null}
          {shown.map((state, index) => (
            <SwitchState
              key={`${index}:${stateKey(state)}`}
              state={state}
              separator={index < shown.length - 1}
            />
          ))}
          <Text aria-hidden="true" size="inherit" tone="inherit" className="shrink-0">
            →
          </Text>
          <SwitchState state={to} current effort={effort} />
          <StepNote step={to} note={note} />
        </Text>
        <Divider decorative className="min-w-4 flex-1 self-center" />
      </div>
    </div>
  );
}

/** Earlier hops, in order, without a hop that repeats the one before it. */
export function earlierStates(steps: ModelSwitchStep[]): ModelSwitchState[] {
  const out: ModelSwitchState[] = [];
  for (const step of steps.slice(0, -1)) {
    const last = out[out.length - 1];
    if (!last || !sameSwitchState(last, step)) out.push(step);
  }
  return out;
}

/** The effort to show on the new state: only when it differs from the state before. */
export function changedEffort(before: ModelSwitchState | undefined, to: ModelSwitchState) {
  return to.effort && before?.effort !== to.effort ? to.effort : undefined;
}

function stateKey(state: ModelSwitchState) {
  return `${state.harness}:${state.accountId ?? state.account ?? ""}:${state.model}`;
}

function SwitchState({
  state,
  current = false,
  effort,
  separator = false,
}: {
  state: ModelSwitchState;
  current?: boolean;
  effort?: string;
  separator?: boolean;
}) {
  const accounts = useProviderAccounts(
    supportsProviderAccounts(state.harness) ? state.harness : null,
  );
  const identity =
    state.accountId && supportsProviderAccounts(state.harness)
      ? modelAccountIdentities(state.harness, accounts).find((item) => item.id === state.accountId)
      : undefined;
  // Rows recorded before account ids existed, or whose account was removed, keep the label text.
  const labelText = identity ? undefined : state.account;
  return (
    <>
      <span
        className={`flex min-w-0 items-center gap-1.5 ${current ? "shrink-0" : "shrink opacity-70"}`}
      >
        <HarnessIcon harness={state.harness} className="icon-sm shrink-0" />
        <Text
          size="inherit"
          tone="inherit"
          weight={current ? "medium" : undefined}
          truncate
          className="min-w-0"
        >
          {state.model}
        </Text>
        {labelText ? (
          <Text
            size="inherit"
            tone="inherit"
            truncate
            className="min-w-0 @max-[420px]/switch:hidden"
          >
            · {labelText}
          </Text>
        ) : null}
        {identity?.accountNumber !== undefined ? (
          <Tooltip label={identity.accountLabel} asChild>
            <span className="inline-flex shrink-0">
              <ModelAccountNumber account={identity} />
            </span>
          </Tooltip>
        ) : null}
        {effort ? <ModelTriggerBadges effort={effort} /> : null}
      </span>
      {separator ? (
        <Text aria-hidden="true" size="inherit" tone="inherit" className="-ms-1.5 shrink-0">
          ,
        </Text>
      ) : null}
    </>
  );
}

function stepNoteLabel(step: ModelSwitchStep, t: ReturnType<typeof useT>) {
  if (step.note === "summary") return t("Summary goes with next message");
  if (step.note === "deferred") return t("Next message");
  return undefined;
}

function StepNote({ step, note }: { step: ModelSwitchStep; note?: string }) {
  if (!note) return null;
  return (
    <InfoTooltip
      label={note}
      icon={<Clock className="icon-sm" tone={step.note === "summary" ? "warning" : "muted"} />}
      className="shrink-0"
    >
      {note}
    </InfoTooltip>
  );
}

function describe(state: ModelSwitchState, extra?: string): string {
  return [HARNESS_TITLE[state.harness], state.account, state.model, extra]
    .filter(Boolean)
    .join(" · ");
}
