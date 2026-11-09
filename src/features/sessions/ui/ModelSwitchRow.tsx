import { Timestamp } from "../../../shared/ui/Timestamp";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { ArrowLeftRight, ChevronRight } from "../../../shared/ui/icons";
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
  const line = (
    <>
      <ArrowLeftRight className="icon-sm shrink-0 text-(--ui-text-muted)" aria-hidden="true" />
      <SwitchState state={from} previous />
      <span aria-hidden="true" className="shrink-0 text-(--ui-text-muted)">
        →
      </span>
      <SwitchState state={to} />
      <StepNote step={to} />
      {switches > 1 ? (
        <span className="shrink-0 rounded-full border border-(--ui-pane-border) px-1.5 text-ui-caption leading-4 text-(--ui-text-muted)">
          {switches}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={`@container/switch min-w-0 py-1 font-sans ${embedded ? "" : "px-4"}`}
      data-model-switch
    >
      {switches > 1 ? (
        <>
          <Button
            motion="none"
            fullWidth
            variant="item"
            type="button"
            selected={open}
            aria-expanded={open}
            aria-label={t("{p0}, {p1} switches", { p0: title, p1: String(switches) })}
            onClick={() => setOpen(!open)}
            className="w-full min-w-0 text-left text-ui-body text-(--ui-text-secondary)"
          >
            {line}
            <ChevronRight
              className={`ml-auto icon-sm shrink-0 text-(--ui-text-secondary) ${open ? "rotate-90" : ""}`}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
          {open ? <SwitchHistory steps={steps} /> : null}
        </>
      ) : (
        <div
          role="note"
          aria-label={title}
          className="flex min-w-0 items-center gap-1.5 py-1 text-ui-body text-(--ui-text-secondary)"
        >
          {line}
        </div>
      )}
    </div>
  );
}

function SwitchState({ state, previous = false }: { state: ModelSwitchState; previous?: boolean }) {
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${previous ? "max-w-[45%] shrink-[3] opacity-70" : "shrink"}`}
    >
      <HarnessIcon harness={state.harness} className="size-3.5 shrink-0" />
      {state.account ? (
        <span
          className={`min-w-0 truncate ${previous ? "" : "font-medium text-(--ui-tone-neutral-fg)"}`}
        >
          {state.account}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`shrink-0 text-(--ui-text-muted) ${previous ? "@max-[420px]/switch:hidden" : ""} ${state.account ? "" : "hidden"}`}
      >
        ·
      </span>
      <span
        className={`min-w-0 truncate ${previous && state.account ? "@max-[420px]/switch:hidden" : ""} ${state.account || previous ? "" : "font-medium text-(--ui-tone-neutral-fg)"}`}
      >
        {state.model}
      </span>
    </span>
  );
}

function StepNote({ step }: { step: ModelSwitchStep }) {
  const t = useT();
  if (step.note === "summary") {
    return (
      <span className="shrink-0 truncate text-ui-caption text-(--ui-tone-warning-fg)">
        {t("Summary goes with next message")}
      </span>
    );
  }
  if (step.note === "deferred") {
    return (
      <span className="shrink-0 text-ui-caption italic text-(--ui-text-muted)">
        {t("Next message")}
      </span>
    );
  }
  return null;
}

function SwitchHistory({ steps }: { steps: ModelSwitchStep[] }) {
  const t = useT();
  return (
    <ol className="ml-1.5 flex min-w-0 flex-col border-l border-(--ui-pane-border) pl-3">
      {steps.map((step, index) => {
        const before = steps[index - 1];
        const current = index === steps.length - 1;
        const changed = before ? changedParts(before, step) : [];
        const tags = [
          ...changed.map((part) =>
            part === "provider" ? t("Provider") : part === "account" ? t("Account") : t("Model"),
          ),
          ...(index === 0 ? [t("Before")] : []),
          ...(current ? [t("Now")] : []),
        ];
        return (
          <li
            key={`${index}:${step.at}`}
            className="flex min-w-0 items-center gap-1.5 py-0.5 text-ui-body text-(--ui-text-secondary)"
          >
            <span className="w-11 shrink-0 font-mono text-ui-caption text-(--ui-text-muted)">
              {index === 0 ? "" : <Timestamp value={step.at} format="time" tooltip={false} />}
            </span>
            <HarnessIcon harness={step.harness} className="size-3.5 shrink-0" />
            {step.account ? (
              <span
                className={`min-w-0 truncate ${current || changed.includes("account") ? "font-medium text-(--ui-tone-neutral-fg)" : ""}`}
              >
                {step.account}
              </span>
            ) : null}
            {step.account ? (
              <span aria-hidden="true" className="shrink-0 text-(--ui-text-muted)">
                ·
              </span>
            ) : null}
            <span
              className={`min-w-0 truncate ${changed.includes("model") ? "text-(--ui-tone-neutral-fg)" : ""}`}
            >
              {step.model}
            </span>
            {tags.length ? (
              <span className="shrink-0 text-ui-caption text-(--ui-text-muted)">
                {tags.join(" · ")}
              </span>
            ) : null}
            <StepNote step={step} />
          </li>
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
