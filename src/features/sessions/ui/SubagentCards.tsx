import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { Text } from "../../../shared/ui/Text";
import { ModelLabel } from "./ModelLabel";
import { motionAttributes } from "../../../shared/ui/Motion";
import { createContext, useContext, useEffect } from "react";
import { useLocale, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { CrewMemberChild } from "../../../shared/model/host-contracts/delegation";
import { ChevronRight, ExternalLink, Square } from "../../../shared/ui/icons";
import { crewMemberOf } from "../model/delegatedAgents";
import { delegatedChildIdOf } from "../model/delegatedBlockId";
import type { Block } from "../model/session";
import { useSession } from "../model/sessionsStore";
import { useSubagentModelName } from "../model/reactiveReads";
import {
  needsApproval,
  subagentName,
  subagentReport,
  toolCallState,
} from "../model/transcriptActivity";
import { requestViewDelegated, stopDelegated } from "./delegatedFocus";
import { useStopRequests } from "./useStopRequests";
import { ActivityPhases } from "./AgentTranscriptActivity";
import { blockForStep } from "./agentStepBlocks";
import { SubagentMarks, SubagentReport, SubagentStateLine } from "./SubagentAnatomy";
import { consumeOpenSubagent, OPEN_SUBAGENT_EVENT, requestViewSubagent } from "./subagentFocus";
import { TranscriptVirtualRows } from "./TranscriptVirtualRows";
import { useTranscriptRevealTarget } from "./transcriptVirtualization";
import { useRetainedDisclosure } from "./useRetainedDisclosure";

/** The conversation whose transcript renders these rows; Crew member cards open and stop through it. */
export const DelegatedRunOwner = createContext<string | undefined>(undefined);

type DelegatedCard = {
  member?: CrewMemberChild;
  /** The task, in the slot a native run gives to its model. */
  subtitle?: string;
  onOpen: () => void;
  /** Present while the member is still running. */
  onStop?: () => void;
  stopping?: boolean;
  stopFailed?: boolean;
};

/**
 * Every delegated run in the turn, one row each. The main transcript cycles —
 * work folds behind a line, messages stay visible — and a subagent you are
 * watching must not move while that happens, so these rows are never part of a
 * fold and hold their place from the moment the agents start.
 *
 * A row is a mascot, a name, and what that agent is doing right now. Click it
 * and the agent's own trail opens underneath.
 */
export function SubagentStack({
  blocks,
  cwd,
  live = false,
  embedded = false,
  onOpenFile,
  onOpenDiff,
}: {
  blocks: Block[];
  cwd?: string;
  live?: boolean;
  embedded?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  return (
    <div className={`flex min-w-0 flex-col ${embedded ? "" : "px-4"}`}>
      <TranscriptVirtualRows
        listId={`agents:${blocks[0]?.id}`}
        rows={blocks.map((block) => ({
          id: block.id,
          blockIds: [block.id],
          pinned:
            needsApproval(block) ||
            !!block.streaming ||
            ((live || !!delegatedChildIdOf(block.id)) && toolCallState(block) === "pending"),
          render: () => (
            <SubagentRow
              block={block}
              cwd={cwd}
              live={live}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          ),
        }))}
      />
    </div>
  );
}

/**
 * One delegated run's row, stateful about being opened. A run that died opens
 * itself, so the provider's reason is not buried behind a face that looks like
 * every other finished one. A click takes the row over from there and it stays
 * where the reader puts it. The same row serves inside a settled turn's trail,
 * where the run sits as one step of the work it was spawned from.
 */
export function SubagentRow({
  block,
  cwd,
  live = false,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  // A Crew member's ask is a child session: it runs whether or not this turn does, opens in
  // the session's own sheet, and stops through the pane that owns it.
  const parentId = useContext(DelegatedRunOwner);
  const childId = delegatedChildIdOf(block.id);
  const child = useSession(childId);
  const stops = useStopRequests();
  const running = toolCallState(block) === "pending";
  const delegated: DelegatedCard | undefined =
    childId && parentId
      ? {
          member: child && crewMemberOf(child),
          subtitle: child?.title,
          onOpen: () => requestViewDelegated(parentId, childId),
          ...(running
            ? {
                onStop: () => stops.request(childId, () => stopDelegated(parentId, childId)),
                stopping: stops.stopping.has(childId),
                stopFailed: stops.failed.has(childId),
              }
            : {}),
        }
      : undefined;
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`agent:${block.id}`, null);
  const reveal = useTranscriptRevealTarget();
  const open = reveal === block.id || (override ?? toolCallState(block) === "rejected");
  // The composer's activity dock opens a run from outside the transcript. The
  // row may only mount after the transcript reveals it, so check on mount too.
  useEffect(() => {
    const openIfAsked = () => {
      if (consumeOpenSubagent(block.id)) setOverride(true);
    };
    openIfAsked();
    window.addEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
    return () => window.removeEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
  }, [block.id, setOverride]);
  return (
    <SubagentPanel
      block={block}
      cwd={cwd}
      live={live || (!!delegated && running)}
      delegated={delegated}
      open={open}
      onToggle={() => setOverride(!open)}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/**
 * One delegated run: its name, what it is doing, and — once opened — the trail
 * it left, with the same tool rows, thinking and prose the main transcript
 * shows. While it runs the trail is a short window pinned to the newest step,
 * so a subagent doing hundreds of things cannot push the turn off the screen.
 */
function SubagentPanel({
  block,
  cwd,
  live = false,
  delegated,
  open,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  /** Set for a Crew member's child session; the card then opens and stops that session. */
  delegated?: DelegatedCard;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const name = subagentName(block);
  const model = useSubagentModelName(block);
  const state = toolCallState(block);
  const active = live && state === "pending";
  const runSteps = block.agentRun?.steps;
  const steps = runSteps ?? [];
  // The run's trail as transcript blocks, so the panel groups it the way the
  // main transcript groups the agent's own work: what it said, then the calls
  // that line introduced, folding behind it once it moves on.
  const stepBlocks = steps.map(blockForStep);
  const report = subagentReport(block);
  const openPanel = delegated?.onOpen ?? (() => requestViewSubagent(block.id));

  // Identity row: marks, name and the model beside it; the name gives room
  // back so a run named with its whole brief cannot push the state off the row.
  const nameClass = "min-w-0 text-start font-sans";
  const label = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      {active ? (
        <WorkingIndicator
          glyph={false}
          className={nameClass}
          truncate
          text={{ size: "body", weight: "medium" }}
        >
          {name}
        </WorkingIndicator>
      ) : (
        <Text
          size="body"
          weight="medium"
          truncate
          tone={state === "rejected" ? "danger" : "secondary"}
          {...motionAttributes(
            { transition: "colors", duration: "standard" },
            `${nameClass} ${state === "rejected" ? "" : "group-hover:text-(--ui-tone-neutral-fg)"}`,
          )}
        >
          {name}
        </Text>
      )}
      {(delegated?.subtitle ?? model) ? (
        <Text size="caption" tone="muted" truncate className="max-w-[40%] shrink-0">
          {delegated?.subtitle ?? (
            <ModelLabel model={block.agentRun?.model ?? ""} name={model} size="xs" />
          )}
        </Text>
      ) : null}
    </span>
  );
  const marks = (
    <SubagentMarks
      name={name}
      model={block.agentRun?.model}
      member={delegated?.member}
      active={active}
      failed={state === "rejected"}
    />
  );
  const stateLine = (
    <SubagentStateLine
      block={block}
      busy={live}
      steps={steps}
      inline
      className="max-w-[55%] shrink-0"
    />
  );

  const stopButton = delegated?.onStop ? (
    <Button
      motion="none"
      iconOnly
      variant="ghost"
      type="button"
      label={
        delegated.stopping
          ? t("Stopping {p0}…", { p0: name })
          : delegated.stopFailed
            ? t("Could not stop. Retry")
            : t("Stop {p0}", { p0: name })
      }
      disabled={delegated.stopping}
      onClick={delegated.onStop}
      className="shrink-0"
    >
      <Square className="icon-xs" strokeWidth={1.75} aria-hidden />
    </Button>
  ) : null;

  // A run can report its first step late (or never). Its prompt and status
  // remain inspectable in the panel even before the trail arrives.
  if (steps.length === 0 && !report) {
    return (
      <div className="flex min-w-0 flex-col">
        <div className="-mx-1.5 flex min-w-0 items-center gap-0.5">
          <Button
            motion="none"
            variant="item"
            type="button"
            aria-label={t("Open {p0} in its own panel", { p0: name })}
            onClick={openPanel}
            className="min-w-0 flex-1"
          >
            {marks}
            {label}
            {stateLine}
            <span className="icon-sm shrink-0" />
          </Button>
          {stopButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="-mx-1.5 flex min-w-0 items-center gap-0.5">
        <Button
          motion="none"
          className="min-w-0 flex-1 text-left"
          variant="item"
          type="button"
          selected={open}
          aria-expanded={open}
          aria-label={
            open ? t("Hide {p0}'s work", { p0: name }) : t("Show {p0}'s work", { p0: name })
          }
          onClick={onToggle}
          // An open row keeps the wash it lit up under the cursor, so the panel
          // below reads as hanging off it rather than off the transcript.
        >
          {marks}
          {label}
          {stateLine}
          <ChevronRight
            {...motionAttributes(
              { transition: "transform", duration: "standard" },
              `icon-sm shrink-0 ${open ? "rotate-90" : ""}`,
            )}
            tone="secondary"
            aria-hidden
          />
        </Button>
        <Button
          motion="none"
          iconOnly
          label={t("Open {p0} in its own panel", { p0: name })}
          variant="ghost"
          type="button"
          aria-label={t("Open {p0} in its own panel", { p0: name })}
          tooltip={t("Open in panel")}
          onClick={openPanel}
          className="shrink-0"
        >
          <ExternalLink className="icon-sm" aria-hidden />
        </Button>
        {stopButton}
      </div>
      <div className="zen-phase-body" data-open={open}>
        {open ? (
          /*
           * No scroll window of its own. Each phase inside already keeps the
           * group the run is working in to a short pinned window; wrapping a
           * second window around them nests one 17.5rem scroller inside
           * another, and the inner one can never reach its own last row.
           */
          <div className="flex min-w-0 flex-col pb-1">
            <ActivityPhases
              blocks={stepBlocks}
              cwd={cwd}
              done={!active}
              padded={false}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
            <SubagentReport
              block={block}
              cwd={cwd}
              onOpenFile={onOpenFile}
              heading="h4"
              className="mt-2 ps-5"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
