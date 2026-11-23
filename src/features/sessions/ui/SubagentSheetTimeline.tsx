import { Badge } from "../../../shared/ui/Badge";
import { ClampText } from "../../../shared/ui/ClampText";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { t as translate, useT } from "../../../shared/i18n";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { agentRunMarkdown, isReportStep } from "../model/agentRunMarkdown";
import type { AgentStep, Block } from "../model/session";

type Translate = typeof translate;
type StepInput = NonNullable<AgentStep["input"]>;

/**
 * The delegated conversation as one timeline: steps in order, grouped by the
 * round that produced them, with incoming messages (what the owner or the
 * parent sent, and where each stands) as rows of their own. Presentation only:
 * the steps carry the identity, mode and delivery state; nothing is inferred.
 */

/** Round of each step: its own, else the previous step's, else the first. */
export function stepRounds(steps: readonly AgentStep[]): number[] {
  let current = 1;
  return steps.map((step) => {
    if (step.round !== undefined) current = step.round;
    return current;
  });
}

/** Whether rounds or incoming messages need the timeline view (otherwise: the plain trail). */
export function hasRoundHistory(steps: readonly AgentStep[]): boolean {
  const rounds = stepRounds(steps);
  return rounds.some((round) => round !== rounds[0]);
}

export type TimelineRound = { round: number; steps: AgentStep[] };

/** Contiguous runs of one round, oldest first; a repeated round number joins its group. */
export function groupRounds(steps: readonly AgentStep[]): TimelineRound[] {
  const rounds = stepRounds(steps);
  const groups: TimelineRound[] = [];
  steps.forEach((step, index) => {
    const round = rounds[index];
    const last = groups[groups.length - 1];
    if (last?.round === round) last.steps.push(step);
    else groups.push({ round, steps: [step] });
  });
  return groups;
}

function senderLabel(sender: string | undefined, t: Translate): string {
  switch (sender?.trim().toLowerCase()) {
    case undefined:
    case "":
      return t("Message");
    case "owner":
    case "user":
    case "you":
      return t("You");
    case "parent":
    case "main":
      return t("Main agent");
    default:
      return sender!.trim();
  }
}

function singleModeLabel(mode: StepInput["mode"], t: Translate): string | undefined {
  switch (mode) {
    case "auto":
      return t("Auto");
    case "queue":
      return t("Queue");
    case "steer":
      return t("Steer");
    default:
      return undefined;
  }
}

/** The requested mode, then the one the Host used when it differs (auto, or a fallback). */
function modeLabel(input: StepInput, t: Translate): string | undefined {
  const requested = singleModeLabel(input.mode, t);
  const effective =
    input.effectiveMode !== input.mode ? singleModeLabel(input.effectiveMode, t) : undefined;
  return requested && effective ? `${requested} · ${effective}` : (effective ?? requested);
}

type DeliveryTone = "neutral" | "accent" | "success" | "danger" | "warning";

/** Provider acceptance is shown as acceptance; nothing here claims the message was read. */
function deliveryLabel(
  delivery: StepInput["delivery"],
  t: Translate,
): { text: string; tone: DeliveryTone } | undefined {
  switch (delivery) {
    case "queued":
      return { text: t("Queued"), tone: "neutral" };
    case "sending":
      return { text: t("Sending"), tone: "accent" };
    case "submitted":
      return { text: t("Submitted"), tone: "neutral" };
    case "accepted":
      return { text: t("Accepted"), tone: "success" };
    case "failed":
      return { text: t("Failed"), tone: "danger" };
    case "cancelled":
      return { text: t("Cancelled"), tone: "neutral" };
    case "unknown":
      return { text: t("Unconfirmed"), tone: "warning" };
    default:
      return undefined;
  }
}

/**
 * One message sent to the agent: who sent it, how, where it stands, and its text
 * exactly as sent (plain, wrapped, whole on request). Replies are Markdown; a
 * message someone typed is not.
 */
export function TimelineInput({ step, input }: { step: AgentStep; input: StepInput }) {
  const t = useT();
  const mode = modeLabel(input, t);
  const delivery = deliveryLabel(input.delivery, t);
  return (
    <Surface
      as="section"
      frame="card"
      radius="card"
      padding="sm"
      data-timeline-message={step.id}
      data-timeline-input={step.id}
      aria-label={senderLabel(input.sender, t)}
      className="my-1 flex min-w-0 flex-col gap-1"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Text size="caption" weight="medium" className="min-w-0 wrap-anywhere">
          {senderLabel(input.sender, t)}
        </Text>
        {mode ? (
          <Badge size="xs" appearance="subtle" tone="neutral">
            {mode}
          </Badge>
        ) : null}
        {delivery ? (
          <Badge size="xs" appearance="subtle" tone={delivery.tone}>
            {delivery.text}
          </Badge>
        ) : null}
        <CopyButton
          iconOnly
          className="ms-auto shrink-0"
          type="button"
          label={t("Copy message")}
          resetKeys={[step.id]}
          text={step.text}
        />
      </div>
      {input.detail ? (
        <Text as="p" size="caption" tone="secondary" className="wrap-anywhere">
          {input.detail}
        </Text>
      ) : null}
      <ClampText lines={12} size="secondary" tone="inherit" leading="normal">
        <Text
          as="p"
          size="inherit"
          tone="inherit"
          className="min-w-0 whitespace-pre-wrap wrap-anywhere select-text"
        >
          {step.text}
        </Text>
      </ClampText>
    </Surface>
  );
}

/** One-line recap of an earlier round, for its collapsed header. */
export function roundSummary(steps: readonly AgentStep[]): string {
  const reply = [...steps].reverse().find((step) => step.kind === "message" && !step.input);
  const line = (reply ?? steps.find((step) => step.input))?.text.trim().split("\n")[0] ?? "";
  const first = line.replace(/[*_`#>]+/g, "");
  return truncateGraphemes(first, 96);
}

/**
 * The whole conversation as Markdown for copying: every round in order, each
 * incoming message labelled with sender, mode and state. A run without rounds
 * or incoming messages is copied exactly as before.
 */
export function timelineMarkdown(block: Block, status: string | undefined): string | undefined {
  const run = block.agentRun;
  if (!run) return undefined;
  const timeline = hasRoundHistory(run.steps) || run.steps.some((step) => step.input);
  if (!timeline) return agentRunMarkdown(block, status);
  const multi = hasRoundHistory(run.steps);
  const rounds = stepRounds(run.steps);
  const steps: AgentStep[] = [];
  run.steps.forEach((step, index) => {
    if (multi && (index === 0 || rounds[index] !== rounds[index - 1]))
      steps.push({
        id: `round:${index}`,
        kind: "message",
        text: `### ${translate("Round {p0}", { p0: rounds[index] })}`,
      });
    if (!step.input) {
      steps.push(step);
      return;
    }
    const label = [
      senderLabel(step.input.sender, translate),
      modeLabel(step.input, translate),
      deliveryLabel(step.input.delivery, translate)?.text,
    ]
      .filter(Boolean)
      .join(" · ");
    const detail = step.input.detail ? `\n_${step.input.detail}_` : "";
    steps.push({
      id: step.id,
      kind: "message",
      text: `**${label}**${detail}\n\n${step.text.trim()}`,
    });
  });
  // A report is a final answer, never an incoming message or a round heading.
  return agentRunMarkdown({ ...block, agentRun: { ...run, steps } }, status);
}

/** Whether a step is the closing report the sheet shows once, below the trail. */
export function isTimelineReport(step: AgentStep, report: string | undefined): boolean {
  return !step.input && isReportStep(step, report);
}
