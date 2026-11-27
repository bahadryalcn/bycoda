import type { ReactNode, Ref } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Stepper } from "../../../shared/ui/Stepper";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Square } from "../../../shared/ui/icons";
import type { SshSetup, SshSetupFlow, SshSetupStep } from "../model/protocol";

const FLOW_STEPS: Record<SshSetupFlow, SshSetupStep[]> = {
  add: ["connect", "install", "pair", "open"],
  update: ["connect", "update", "open"],
  reconnect: ["open"],
};

const stepLabel = (step: SshSetupStep) =>
  ({
    connect: t("Sign in over SSH"),
    install: t("Install bycoda Host"),
    update: t("Update bycoda Host"),
    pair: t("Pair this desktop"),
    open: t("Open the connection"),
  })[step];

const stepHint = (step: SshSetupStep) =>
  ({
    connect: t("Checks the address and your SSH login."),
    install: t("Installs bycoda Host if it is missing, then starts it."),
    update: t("Replaces bycoda Host with the version this app needs."),
    pair: t("Gives this desktop its own key on that computer."),
    open: t("Connects to bycoda Host through SSH."),
  })[step];

const title = (flow: SshSetupFlow | undefined, name: string) =>
  flow === "add"
    ? t("Adding {p0}", { p0: name })
    : flow === "update"
      ? t("Updating {p0}", { p0: name })
      : t("Connecting to {p0}", { p0: name });

/**
 * A running SSH setup: what it is doing to which computer, its steps, the question it waits
 * on, and Stop. A flow with one step shows no step list.
 */
export function SshSetupProgress({
  name,
  job,
  stopping,
  onStop,
  prompt,
  ref,
}: {
  name: string;
  /** Undefined until the first status read. */
  job: SshSetup | undefined;
  /** Stop was pressed and the job has not ended yet. */
  stopping: boolean;
  onStop: () => void;
  /** The SSH question form while the job waits for an answer. */
  prompt?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  const steps = job ? FLOW_STEPS[job.flow] : [];
  const current = job ? Math.max(0, steps.indexOf(job.step)) : 0;
  const waiting = Boolean(job?.prompt) && !stopping;
  const heading = title(job?.flow, name);
  return (
    <Surface
      variant="card"
      padding="lg"
      className="flex flex-col gap-4"
      ref={ref}
      aria-busy={!waiting}
    >
      <div className="flex items-start justify-between gap-3">
        {waiting ? (
          <Text wrap="anywhere" as="div" size="secondary" tone="primary" weight="medium">
            {heading}
          </Text>
        ) : (
          <LoadingText delay={false} className="min-w-0">
            {heading}
          </LoadingText>
        )}
        <Button
          stableWidth
          type="button"
          variant="secondary"
          className="shrink-0"
          startIcon={<Square className="icon-sm" aria-hidden />}
          loading={stopping}
          loadingLabel={t("Stopping…")}
          onClick={onStop}
        >
          {t("Stop")}
        </Button>
      </div>
      {steps.length > 1 ? (
        <Stepper
          orientation="vertical"
          details="current"
          label={t("Setup steps")}
          current={current}
          steps={steps.map((step) => ({
            id: step,
            label: stepLabel(step),
            description: stepHint(step),
          }))}
        />
      ) : null}
      {prompt}
    </Surface>
  );
}
