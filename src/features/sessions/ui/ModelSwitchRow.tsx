import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { useState } from "react";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useT } from "../../../shared/i18n";
import { ArrowLeftRight, Clock } from "../../../shared/ui/icons";
import { HARNESS_TITLE } from "../model/session";
import type {
  ModelSwitchMeta,
  ModelSwitchState,
  ModelSwitchStep,
} from "../model/modelSwitchHistory";
import { HarnessIcon } from "./HarnessIcon";

type Props = { meta: ModelSwitchMeta; embedded?: boolean };

/**
 * Provider, account and model switches with no message between them, as one
 * row: the state before the latest switch, the state now, and how many
 * switches the row holds. More than one switch opens a timed history.
 */
export function ModelSwitchRow({ meta, embedded = false }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const steps = meta.steps;
  const to = steps[steps.length - 1];
  const from = steps[steps.length - 2];
  if (!to || !from) return null;
  const switches = steps.length - 1;
  const title = t("Switched from {p0} to {p1}", { p0: describe(from), p1: describe(to) });
  const note = stepNoteLabel(to, t);
  const line = (
    <>
      <ArrowLeftRight className="icon-sm shrink-0" tone="muted" aria-hidden="true" />
      <SwitchState state={from} previous />
      <Text aria-hidden="true" size="inherit" tone="muted" className="shrink-0">
        →
      </Text>
      <SwitchState state={to} />
      <StepNote step={to} />
      {switches > 1 ? (
        <Text as="span" size="caption" tone="muted" className="shrink-0">
          {switches}
        </Text>
      ) : null}
    </>
  );

  return (
    <div
      className={`@container/switch min-w-0 py-1 font-sans ${embedded ? "" : "px-4"}`}
      data-model-switch
    >
      {switches > 1 ? (
        <Disclosure
          variant="step"
          chevron="end"
          tone="secondary"
          textSize="body"
          open={open}
          onOpenChange={setOpen}
          summaryLabel={t("{p0}, {p1} switches", {
            p0: note ? `${title}. ${note}` : title,
            p1: String(switches),
          })}
          summary={line}
          className="w-full min-w-0"
        >
          {open ? <SwitchHistory steps={steps} /> : null}
        </Disclosure>
      ) : (
        <Text
          role="note"
          aria-label={note ? `${title}. ${note}` : title}
          as="div"
          size="body"
          tone="secondary"
          className="flex min-w-0 items-center gap-1.5 py-1"
        >
          {line}
        </Text>
      )}
    </div>
  );
}

function SwitchState({ state, previous = false }: { state: ModelSwitchState; previous?: boolean }) {
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${previous ? "max-w-[45%] shrink-[3] opacity-70" : "shrink"}`}
    >
      <HarnessIcon harness={state.harness} className="icon-sm shrink-0" />
      {state.account ? (
        <Text
          size="inherit"
          tone={previous ? "inherit" : "neutral"}
          weight={previous ? undefined : "medium"}
          truncate
          className="min-w-0"
        >
          {state.account}
        </Text>
      ) : null}
      <Text
        aria-hidden="true"
        size="inherit"
        tone="muted"
        className={`shrink-0 ${previous ? "@max-[420px]/switch:hidden" : ""} ${state.account ? "" : "hidden"}`}
      >
        ·
      </Text>
      <Text
        size="inherit"
        tone={state.account || previous ? "inherit" : "neutral"}
        weight={state.account || previous ? undefined : "medium"}
        truncate
        className={`min-w-0 ${previous && state.account ? "@max-[420px]/switch:hidden" : ""}`}
      >
        {state.model}
      </Text>
    </span>
  );
}

function stepNoteLabel(step: ModelSwitchStep, t: ReturnType<typeof useT>) {
  if (step.note === "summary") return t("Summary goes with next message");
  if (step.note === "deferred") return t("Next message");
  return undefined;
}

function StepNote({ step }: { step: ModelSwitchStep }) {
  const label = stepNoteLabel(step, useT());
  if (!label) return null;
  return (
    <Tooltip label={label} asChild>
      <Clock
        aria-label={label}
        className="icon-sm shrink-0"
        tone={step.note === "summary" ? "warning" : "muted"}
      />
    </Tooltip>
  );
}

function SwitchHistory({ steps }: { steps: ModelSwitchStep[] }) {
  return (
    <ol
      {...surfaceAttributes({ frame: "pane", edge: "left" }, "ms-1.5 flex min-w-0 flex-col ps-3")}
    >
      {steps.map((step, index) => {
        const before = steps[index - 1];
        const current = index === steps.length - 1;
        const changed = before ? changedParts(before, step) : [];
        return (
          <Text
            key={`${index}:${step.at}`}
            as="li"
            size="body"
            tone="secondary"
            className="flex min-w-0 items-center gap-1.5 py-0.5"
          >
            <Text size="caption" tone="muted" className="min-w-[8ch] shrink-0 text-end">
              {index === 0 ? "" : <Timestamp value={step.at} format="time" tooltip={false} />}
            </Text>
            <HarnessIcon harness={step.harness} className="icon-sm shrink-0" />
            {step.account ? (
              <Text
                size="inherit"
                tone={current || changed.includes("account") ? "neutral" : "inherit"}
                weight={current || changed.includes("account") ? "medium" : undefined}
                truncate
                className="min-w-0"
              >
                {step.account}
              </Text>
            ) : null}
            {step.account ? (
              <Text aria-hidden="true" size="inherit" tone="muted" className="shrink-0">
                ·
              </Text>
            ) : null}
            <Text
              size="inherit"
              tone={changed.includes("model") ? "neutral" : "inherit"}
              truncate
              className="min-w-0"
            >
              {step.model}
            </Text>
            <StepNote step={step} />
          </Text>
        );
      })}
    </ol>
  );
}

type Part = "provider" | "account" | "model";

function changedParts(before: ModelSwitchState, after: ModelSwitchState): Part[] {
  if (before.harness !== after.harness) return ["provider"];
  return [
    ...(before.account !== after.account ? (["account"] as const) : []),
    ...(before.model !== after.model ? (["model"] as const) : []),
  ];
}

function describe(state: ModelSwitchState): string {
  return [HARNESS_TITLE[state.harness], state.account, state.model].filter(Boolean).join(" · ");
}
