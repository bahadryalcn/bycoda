import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
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
      <ArrowLeftRight className="icon-sm shrink-0" tone="muted" aria-hidden="true" />
      <SwitchState state={from} previous />
      <Text aria-hidden="true" size="inherit" tone="muted" className="shrink-0">
        →
      </Text>
      <SwitchState state={to} />
      <StepNote step={to} />
      {switches > 1 ? (
        <Text
          as="span"
          size="caption"
          tone="muted"
          {...surfaceAttributes(
            { radius: "pill", frame: "pane", edge: "all" },
            "shrink-0   border-(--ui-pane-border) px-1.5",
          )}
        >
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
            className="w-full min-w-0 text-left"
            textSize="body"
            textTone="secondary"
          >
            {line}
            <ChevronRight
              className={`ml-auto icon-sm shrink-0 ${open ? "rotate-90" : ""}`}
              tone="secondary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
          {open ? <SwitchHistory steps={steps} /> : null}
        </>
      ) : (
        <Text
          role="note"
          aria-label={title}
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
      <HarnessIcon harness={state.harness} className="size-3.5 shrink-0" />
      {state.account ? (
        <Text
          size="inherit"
          tone={previous ? "inherit" : "neutral"}
          weight={previous ? undefined : "medium"}
          truncate
          className={`min-w-0  `}
        >
          {state.account}
        </Text>
      ) : null}
      <Text
        aria-hidden="true"
        size="inherit"
        tone="muted"
        className={`shrink-0  ${previous ? "@max-[420px]/switch:hidden" : ""} ${state.account ? "" : "hidden"}`}
      >
        ·
      </Text>
      <Text
        size="inherit"
        tone={state.account || previous ? "inherit" : "neutral"}
        weight={state.account || previous ? undefined : "medium"}
        truncate
        className={`min-w-0  ${previous && state.account ? "@max-[420px]/switch:hidden" : ""} `}
      >
        {state.model}
      </Text>
    </span>
  );
}

function StepNote({ step }: { step: ModelSwitchStep }) {
  const t = useT();
  if (step.note === "summary") {
    return (
      <Text size="caption" tone="warning" truncate className="shrink-0">
        {t("Summary goes with next message")}
      </Text>
    );
  }
  if (step.note === "deferred") {
    return (
      <Text size="caption" tone="muted" className="shrink-0 italic">
        {t("Next message")}
      </Text>
    );
  }
  return null;
}

function SwitchHistory({ steps }: { steps: ModelSwitchStep[] }) {
  const t = useT();
  return (
    <ol
      {...surfaceAttributes(
        { frame: "pane", edge: "left" },
        "ml-1.5 flex min-w-0 flex-col  border-(--ui-pane-border) pl-3",
      )}
    >
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
          <Text
            key={`${index}:${step.at}`}
            as="li"
            size="body"
            tone="secondary"
            className="flex min-w-0 items-center gap-1.5 py-0.5"
          >
            <Text size="caption" tone="muted" className="w-11 shrink-0 font-mono">
              {index === 0 ? "" : <Timestamp value={step.at} format="time" tooltip={false} />}
            </Text>
            <HarnessIcon harness={step.harness} className="size-3.5 shrink-0" />
            {step.account ? (
              <Text
                size="inherit"
                tone={current || changed.includes("account") ? "neutral" : "inherit"}
                weight={current || changed.includes("account") ? "medium" : undefined}
                truncate
                className={`min-w-0  `}
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
              className={`min-w-0  `}
            >
              {step.model}
            </Text>
            {tags.length ? (
              <Text size="caption" tone="muted" className="shrink-0">
                {tags.join(" · ")}
              </Text>
            ) : null}
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
