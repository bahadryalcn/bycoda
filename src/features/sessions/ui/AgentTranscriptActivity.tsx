import { useFollowBottom } from "../hooks/useFollowBottom";
import {
  handoffPhaseOf,
  subscribeHandoffPhase,
} from "../../../integrations/harness/core/handoffPhase";
import { useLocale, useT } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Minus,
  PenLine,
  Bot,
  Search,
  Terminal,
  Wrench,
  X,
} from "../../../shared/ui/icons";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FilePreview } from "../../files/ui/FilePreview";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { ToolDiffPreview } from "./ToolDiffPreview";
import { hasToolInspection, ToolInspectionPanel } from "./ToolInspectionPanel";
import { Spinner } from "../../../shared/ui/Spinner";
import { SubagentReport, SubagentStateLine } from "./SubagentAnatomy";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { useApprovalDecisionContext } from "./ApprovalDecisionContext";
import { useApprovalDecisionControl } from "./useApprovalDecisionControl";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import type { ApprovalDecision } from "../../../integrations/harness";
import {
  isEditTool,
  isReadTool,
  isSearchTool,
  stubFilePreview,
} from "../../../integrations/harness/core/preview";
import { useSubagentModelName, useToolCallDisplay } from "../model/reactiveReads";
import { Shimmer } from "../../../shared/ui/Shimmer";
import {
  HARNESS_TITLE,
  type AgentStep,
  type Block,
  type InterjectionMeta,
  type ToolPreview,
} from "../model/session";
import { HarnessIcon } from "./HarnessIcon";
import { formatElapsed, useElapsedFrom } from "./useElapsedFrom";
import { consumeOpenSubagent, OPEN_SUBAGENT_EVENT, requestViewSubagent } from "./subagentFocus";
import { AgentMarkdown } from "./AgentMarkdown";
import {
  activityPhaseTitle,
  buildActivityPhases,
  isIncompleteTool,
  isSubagentBlock,
  isThinkingBlock,
  isProseBlock,
  needsApproval,
  proseSummary,
  subagentBrief,
  subagentName,
  subagentReport,
  toolCallLabel,
  isStoppedBlock,
  toolCallState,
  type ActivityPhase,
  type ActivityPhaseKind,
  type ToolCallState,
} from "../model/transcriptActivity";
import { bycodaToolCall, bycodaWorkSummary, type BycodaToolCall } from "../model/bycodaToolCall";
import { NEAR_BOTTOM_PX } from "./transcriptScroll";
import { useClampOverflow } from "./useClampOverflow";
import { useRetainedDisclosure } from "./useRetainedDisclosure";

/*
 * Tool calls often land in a burst. Each arrival waits for the one before it
 * to finish its whole entrance — rail, branch, row — before starting its own.
 * The first few play at STEP_ENTRANCE_MS; a queue running past
 * STEP_QUEUE_CALM_MS plays the rest faster, down to STEP_ENTRANCE_MIN_MS by
 * STEP_QUEUE_MS, so a long burst still catches up.
 */
const STEP_ENTRANCE_MS = 480;
const STEP_ENTRANCE_MIN_MS = 160;
const STEP_QUEUE_CALM_MS = 960;
const STEP_QUEUE_MS = 2000;
/**
 * Notes and thinking lines sit in the trail like tool rows: no extra inset, the
 * normal weight a sentence reads at, and the same minimum row height.
 */
const ACTIVITY_LINE_BUTTON =
  "min-h-7 w-full min-w-0 justify-start px-0 py-0.5 text-left font-normal whitespace-normal";

/**
 * The turn's work as phases. Related reasoning and calls stay together while
 * assistant prose remains outside as full-size transcript text. The phase the
 * agent is in stays open, with new steps scrolling inside a short window; the
 * moment it moves on the phase folds back to its header.
 */
type ActivityPhasesProps = {
  blocks: Block[];
  cwd?: string;
  done?: boolean;
  /** False inside a nested panel, which supplies its own gutter. */
  padded?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
};

export const ActivityPhases = memo(function ActivityPhases({
  blocks,
  cwd,
  done,
  padded = true,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: ActivityPhasesProps) {
  useLocale();
  const phases = useMemo(() => buildActivityPhases(blocks), [blocks]);

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${padded ? "px-4" : ""}`}>
      {phases.map((phase, index) => (
        <ActivityPhaseGroup
          key={phase.id}
          phase={phase}
          cwd={cwd}
          active={!done && index === phases.length - 1}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}, sameActivity);

/**
 * A settled group is the same calls it was on the last token. Comparing the
 * blocks themselves keeps every earlier turn out of the streaming re-render,
 * which is most of what makes a long transcript stutter while the agent works.
 */
function sameActivity(a: ActivityPhasesProps, b: ActivityPhasesProps): boolean {
  return (
    a.cwd === b.cwd &&
    a.done === b.done &&
    a.padded === b.padded &&
    a.onApproval === b.onApproval &&
    a.onOpenFile === b.onOpenFile &&
    a.onOpenDiff === b.onOpenDiff &&
    a.blocks.length === b.blocks.length &&
    a.blocks.every((block, index) => block === b.blocks[index])
  );
}

/**
 * Keep a live phase body on its newest step. Pinning happens in layout
 * before paint so the window follows without a visible hitch; only a real
 * wheel away from the bottom pauses that.
 */

/**
 * One phase: a header the whole group hangs off, and the steps under it on a
 * rail. Folding is automatic — the group opens while it is the live one and
 * closes when the agent moves on — until you click, after which it stays where
 * you put it. A step still waiting on you keeps the group open regardless.
 * While live, the open body stays a short scrolling window pinned to the
 * newest step; after the turn settles an opened group is full height again.
 */
type ActivityPhaseGroupProps = {
  phase: ActivityPhase;
  cwd?: string;
  active: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
};

/**
 * `buildActivityPhases` returns new phase objects for every frame, but a phase
 * that holds the same blocks renders the same, so only the live one re-renders.
 */
function sameActivityPhaseGroup(a: ActivityPhaseGroupProps, b: ActivityPhaseGroupProps): boolean {
  return (
    a.cwd === b.cwd &&
    a.active === b.active &&
    a.onApproval === b.onApproval &&
    a.onOpenFile === b.onOpenFile &&
    a.onOpenDiff === b.onOpenDiff &&
    (a.phase === b.phase ||
      (a.phase.id === b.phase.id &&
        a.phase.kind === b.phase.kind &&
        a.phase.headline === b.phase.headline &&
        a.phase.steps.length === b.phase.steps.length &&
        a.phase.steps.every((step, index) => step === b.phase.steps[index])))
  );
}

const ActivityPhaseGroup = memo(function ActivityPhaseGroup({
  phase,
  cwd,
  active,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: ActivityPhaseGroupProps) {
  const t = useT();
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`phase:${phase.id}`, null);
  const waiting = phase.steps.some(needsApproval);
  const needsAttention =
    waiting ||
    phase.steps.some((step) => step.role === "tool" && toolCallState(step) === "rejected");
  const open = waiting || (override ?? active);
  const [liveScroller, setLiveScroller] = useState<HTMLDivElement | null>(null);
  // A step's own growth is followed by the hook's resize observer; the layout
  // pass is only needed when a step arrives, so a rebuilt array is not a trigger.
  const lastStepId = phase.steps[phase.steps.length - 1]?.id;
  const followKey = `${phase.steps.length}:${lastStepId ?? ""}`;
  useFollowBottom(liveScroller, active && open, followKey, NEAR_BOTTOM_PX, true);
  // Steps already here when the group mounted, or that landed while it was
  // folded, are history: only a step you watch arrive gets the entrance.
  const settled = useRef<Set<Block["id"]> | null>(null);
  settled.current ??= new Set(phase.steps.map((step) => step.id));
  useEffect(() => {
    for (const step of phase.steps) settled.current?.add(step.id);
  }, [phase.steps]);
  const turnFor = useStepQueue(phase.steps);
  const title = activityPhaseTitle(phase, active);
  const bycodaPhase = !!bycodaWorkSummary(phase.steps, active);
  let compactCommand: Block | undefined;
  if (active && override !== true && !needsAttention) {
    for (let index = phase.steps.length - 1; index >= 0; index -= 1) {
      const step = phase.steps[index];
      if (step.role === "tool" && step.tool?.kind === "shell") {
        // Recognized app calls already have a compact action row; repeating the
        // shell preview here exposes their full executable path and arguments.
        compactCommand = bycodaToolCall(step) ? undefined : step;
        break;
      }
    }
  }
  // Opening a group on purpose is also how you read the line that titled it,
  // whole. The auto-open while it runs is a live view, not a reading one, and
  // a one-line note the header already shows in full has nothing to add.
  const headline =
    override === true && phase.headline && headlineHasMore(phase.headline)
      ? phase.headline
      : undefined;
  const inert = phase.steps.length === 0 && !headlineHasMore(phase.headline);

  // A lone call the agent never introduced is not a group: a header repeating
  // the single row under it says nothing twice.
  if (!phase.headline && phase.steps.length === 1) {
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        {bycodaPhase ? null : <ActivityPhaseIcon kind={phase.kind} className="mt-[7px]" />}
        <div className="min-w-0 flex-1">
          <ActivityRow
            block={phase.steps[0]}
            cwd={cwd}
            live={active}
            onApproval={onApproval}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        </div>
      </div>
    );
  }

  const label = active ? (
    <Shimmer className="min-w-0 flex-1 truncate font-sans text-ui-body" duration={1.6}>
      {title}
    </Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and
    // only the answer reads at full strength.
    <span className="min-w-0 flex-1 truncate font-sans text-ui-body text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
      {title}
    </span>
  );

  // A line the agent wrote with nothing under it is just that line.
  if (inert) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-1">
        <ActivityPhaseIcon kind={phase.kind} />
        {label}
      </div>
    );
  }

  return (
    <div className="transcript-activity-group flex min-w-0 flex-col">
      <Button
        motion="none"
        fullWidth
        variant="item"
        type="button"
        selected={open}
        aria-expanded={open}
        tooltip={title}
        aria-label={
          open
            ? t("Hide the steps for {p0}", { p0: title })
            : t("Show the steps for {p0}", { p0: title })
        }
        onClick={() => setOverride(!open)}
        className="w-full min-w-0 text-left"
      >
        {/*
         * The two icons share one 14px box, so the swap is instant: fading
         * between them leaves both half-drawn on top of each other.
         */}
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          {bycodaPhase ? (
            <BycodaMark className="size-3.5" />
          ) : (
            <ActivityPhaseIcon kind={phase.kind} />
          )}
        </span>
        {label}
        <ChevronRight
          className={`icon-sm shrink-0 text-(--ui-text-secondary) ${open ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
      </Button>
      <div className="zen-phase-body" data-open={open}>
        {open ? (
          <>
            {compactCommand ? (
              <div className="flex min-w-0 items-start gap-1.5 px-2 pt-1 pb-1.5 text-ui-caption text-(--ui-text-secondary)">
                <Terminal className="mt-0.5 icon-xs shrink-0" aria-hidden="true" />
                <span
                  className="line-clamp-1 break-all font-mono"
                  title={toolCallLabel(compactCommand, cwd)}
                >
                  {toolCallLabel(compactCommand, cwd)}
                </span>
              </div>
            ) : null}
            <div
              ref={setLiveScroller}
              className={
                active && override !== true && !needsAttention
                  ? "zen-phase-live zen-phase-summary"
                  : undefined
              }
            >
              <div className="flex min-w-0 flex-col">
                {headline ? (
                  <div className="zen-phase-step py-1">
                    <AgentMarkdown
                      className={headline.role === "reasoning" ? "agent-reasoning" : undefined}
                      text={headline.text}
                      cwd={cwd}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                ) : null}
                {phase.steps.map((block) => {
                  const arriving = active && !settled.current?.has(block.id);
                  return (
                    <PhaseStep
                      key={block.id}
                      live={active}
                      turn={arriving ? turnFor(block.id) : undefined}
                    >
                      <ActivityRow
                        block={block}
                        cwd={cwd}
                        live={active}
                        onApproval={onApproval}
                        onOpenFile={onOpenFile}
                        onOpenDiff={onOpenDiff}
                      />
                    </PhaseStep>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </div>
      {open && active && override !== true && !needsAttention && phase.steps.length > 3 ? (
        <Button variant="link" motion="none" onClick={() => setOverride(true)}>
          {t("Show more")}
        </Button>
      ) : null}
    </div>
  );
}, sameActivityPhaseGroup);

type StepTurn = { wait: number; pace: number };

/**
 * A group's queue of arriving steps: how long each one waits for the step
 * before it to finish, and how long its own entrance then takes. A step keeps
 * the turn it was first given however often the group renders.
 */
function useStepQueue(steps: readonly Block[]) {
  const queue = useRef({ next: 0, turns: new Map<Block["id"], StepTurn>() });
  useEffect(() => {
    const current = new Set(steps.map((step) => step.id));
    for (const id of queue.current.turns.keys()) {
      if (!current.has(id)) queue.current.turns.delete(id);
    }
  }, [steps]);

  return (id: Block["id"]) => {
    const { turns } = queue.current;
    let turn = turns.get(id);
    if (!turn) {
      const now = performance.now();
      const start = Math.max(now, queue.current.next);
      const wait = start - now;
      const backlog = (STEP_QUEUE_MS - wait) / (STEP_QUEUE_MS - STEP_QUEUE_CALM_MS);
      const pace = Math.max(STEP_ENTRANCE_MIN_MS, STEP_ENTRANCE_MS * Math.min(1, backlog));
      queue.current.next = start + pace;
      turn = { wait, pace };
      turns.set(id, turn);
    }
    return turn;
  };
}

/**
 * One step on a phase's rail. A step that lands while you watch makes room
 * first — what is below glides down, the rail runs into the gap and branches
 * off — and only then does the row fade in. One that lands behind others
 * stays out of the layout until its turn. The grid and clipping that does
 * that come off once the row has settled, so nothing inside stays clipped.
 */
function PhaseStep({
  live,
  turn: arrival,
  children,
}: {
  live: boolean;
  /** Set only on the render a step arrives in; later renders drop it. */
  turn?: StepTurn;
  children: ReactNode;
}) {
  useLocale();
  const [turn] = useState(arrival);
  const [stage, setStage] = useState<"waiting" | "entering" | "settled">(() =>
    !turn ? "settled" : turn.wait > 0 ? "waiting" : "entering",
  );

  useEffect(() => {
    if (stage !== "waiting" || !turn) return;
    const timer = window.setTimeout(() => setStage("entering"), turn.wait);
    return () => window.clearTimeout(timer);
  }, [stage, turn]);

  return (
    <div
      className="zen-phase-step"
      style={turn ? ({ "--step-ms": `${Math.round(turn.pace)}ms` } as CSSProperties) : undefined}
      data-live={live || undefined}
      data-waiting={stage === "waiting" || undefined}
      data-entering={stage === "entering" || undefined}
      onAnimationEnd={(e) => {
        // The row's own fade is the last beat; nested rails bubble theirs.
        if (
          e.animationName === "zen-step-in" &&
          (e.target as Element).parentElement === e.currentTarget
        ) {
          setStage("settled");
        }
      }}
    >
      {children}
    </div>
  );
}

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
      {blocks.map((block) => (
        <SubagentRow
          key={block.id}
          block={block}
          cwd={cwd}
          live={live}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
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
function SubagentRow({
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
  const [override, setOverride] = useRetainedDisclosure<boolean | null>(`agent:${block.id}`, null);
  const open = override ?? toolCallState(block) === "rejected";
  // The composer's activity dock opens a run from outside the transcript. The
  // row may only mount after the transcript reveals it, so check on mount too.
  useEffect(() => {
    const openIfAsked = () => {
      if (consumeOpenSubagent(block.id)) setOverride(true);
    };
    openIfAsked();
    window.addEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
    return () => window.removeEventListener(OPEN_SUBAGENT_EVENT, openIfAsked);
  }, [block.id]);
  return (
    <SubagentPanel
      block={block}
      cwd={cwd}
      live={live}
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
  open,
  onToggle,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const name = subagentName(block);
  const brief = subagentBrief(block);
  const model = useSubagentModelName(block);
  const state = toolCallState(block);
  const active = live && state === "pending";
  const steps = block.agentRun?.steps ?? [];
  // The run's trail as transcript blocks, so the panel groups it the way the
  // main transcript groups the agent's own work: what it said, then the calls
  // that line introduced, folding behind it once it moves on.
  const stepBlocks = useMemo(() => steps.map(agentStepBlock), [steps]);
  const report = subagentReport(block);

  // Identity row: the name takes the room it needs and gives the rest back, so
  // a provider that names a run with its whole brief cannot push the row off the
  // pane. State, clock and model sit on the line below, as in the detached sheet.
  const label = active ? (
    <Shimmer className="min-w-0 flex-1 truncate text-start font-sans text-ui-body" duration={1.6}>
      {name}
    </Shimmer>
  ) : (
    <span
      className={`min-w-0 flex-1 truncate text-start font-sans text-ui-body transition-colors duration-200 ${
        state === "rejected"
          ? "text-(--ui-tone-danger-fg)"
          : "text-(--ui-text-secondary) group-hover:text-(--ui-tone-neutral-fg)"
      }`}
    >
      {name}
    </span>
  );
  const stateLine = (
    <SubagentStateLine
      block={block}
      busy={live}
      steps={steps}
      model={model}
      className="pb-0.5 ps-6"
    />
  );

  // A run can report its first step late (or never). Its prompt and status
  // remain inspectable in the panel even before the trail arrives.
  if (steps.length === 0 && !report) {
    return (
      <div className="flex min-w-0 flex-col">
        <Button
          motion="none"
          variant="item"
          type="button"
          aria-label={t("Open {p0} in its own panel", { p0: name })}
          tooltip={brief}
          onClick={() => requestViewSubagent(block.id)}
          className="-mx-1.5 min-w-0"
        >
          <SubagentMascot name={name} state={state} active={active} />
          {label}
          <span className="icon-sm shrink-0" />
        </Button>
        {stateLine}
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
          tooltip={brief}
          onClick={onToggle}
          // An open row keeps the wash it lit up under the cursor, so the panel
          // below reads as hanging off it rather than off the transcript.
        >
          <SubagentMascot name={name} state={state} active={active} />
          {label}
          <ChevronRight
            className={`icon-sm shrink-0 text-(--ui-text-secondary) transition-transform duration-200 group-hover:text-(--ui-text-secondary) ${
              open ? "rotate-90" : ""
            }`}
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
          onClick={() => requestViewSubagent(block.id)}
          className="shrink-0"
        >
          <ExternalLink className="icon-sm" aria-hidden />
        </Button>
      </div>
      {stateLine}
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

/**
 * The pixel mascot standing in for a subagent, hopping while it works. The
 * sprite is hashed off the agent's name, so the same reviewer keeps the same
 * face across a session and two agents in a row are told apart at a glance.
 */
function SubagentMascot({
  name,
  state,
  active = false,
}: {
  name: string;
  state: ToolCallState;
  active?: boolean;
}) {
  useLocale();
  return (
    <ProjectMascot
      project={name}
      active={active}
      className={`size-3.5 shrink-0 ${
        state === "rejected"
          ? "text-(--ui-tone-danger-fg)"
          : state === "pending"
            ? "text-(--ui-text-secondary)"
            : "text-(--ui-text-secondary)"
      }`}
    />
  );
}

/**
 * A mirrored step as the transcript block it stands for, so a subagent's trail
 * goes through the same rows — labels, file chips, diffs — as the main agent's.
 */
export function agentStepBlock(step: AgentStep): Block {
  if (step.kind !== "tool") {
    return {
      id: step.id,
      role: step.kind === "reasoning" ? "reasoning" : "assistant",
      text: step.text,
    };
  }
  return {
    id: step.id,
    role: "tool",
    text: step.text,
    tool: {
      callId: step.id,
      title: step.text,
      ...(step.toolKind ? { kind: step.toolKind } : {}),
      ...(step.status ? { status: step.status } : {}),
      ...(step.detail ? { detail: step.detail } : {}),
      ...(step.preview ? { preview: step.preview } : {}),
      ...(step.output ? { output: step.output } : {}),
      ...(step.outputTruncated ? { outputTruncated: true } : {}),
    },
  };
}

/** Whether the line that titled a group has more in it than the header shows. */
function headlineHasMore(block?: Block): boolean {
  if (!block) return false;
  return block.role === "reasoning" || /\n\s*\n/.test(block.text.trim());
}

/** What the group was for, at a glance: look, change, run, think. */
export function ActivityPhaseIcon({
  kind,
  className = "",
}: {
  kind: ActivityPhaseKind;
  className?: string;
}) {
  useLocale();
  const props = {
    className: `size-3.5 shrink-0 text-(--ui-text-secondary) ${className}`,
    strokeWidth: 1.75,
  };
  if (kind === "edit") return <PenLine {...props} />;
  if (kind === "research") return <Search {...props} />;
  if (kind === "run") return <Terminal {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  if (kind === "think") return null;
  if (kind === "other") return <Wrench {...props} />;
  return <Minus {...props} />;
}

/**
 * One step of the agent's work, whatever that step was: a tool call, a thought,
 * a paragraph. In a phase the rail draws the bullet, so the row drops its own
 * leading icon and leans on the rail instead.
 */
export const ActivityRow = memo(function ActivityRow({
  block,
  cwd,
  live = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  useLocale();
  if (isThinkingBlock(block)) {
    return <ActivityThinkingRow block={block} cwd={cwd} expandable bare onOpenFile={onOpenFile} />;
  }
  if (block.interjection) {
    return <ActivityInterjectionRow block={block} />;
  }
  if (block.role === "system") {
    return <ActivityStatusRow block={block} />;
  }
  if (isProseBlock(block)) {
    return <ActivityNoteRow block={block} cwd={cwd} bare expandable onOpenFile={onOpenFile} />;
  }
  // Only a settled turn routes a delegated run here; live turns pin the row
  // outside the trail. Either way it is the same row, so it still opens onto
  // the agent's own work.
  if (isSubagentBlock(block)) {
    return (
      <SubagentRow
        block={block}
        cwd={cwd}
        live={live}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }
  return (
    <ActivityToolRow
      block={block}
      cwd={cwd}
      live={live}
      bare
      onApproval={onApproval}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
});

/** A status row folded into the trail: one muted line, nothing to open. */
function ActivityStatusRow({ block }: { block: Block }) {
  useLocale();
  const startedAt = block.statusRunningSince;
  const running = startedAt != null;
  // Idle (paused) once the row settles, so a finished row keeps no ticker.
  const elapsedMs = useElapsedFrom(startedAt, !running);
  const elapsed = running ? formatElapsed(elapsedMs) : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 py-1">
      {running ? <Spinner size="xs" className="shrink-0" /> : null}
      <span
        title={block.text}
        className={`min-w-0 flex-1 truncate font-sans text-ui-body ${block.notice === "interrupt" ? "font-medium text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
      >
        {block.text.trim()}
      </span>
      {elapsed ? (
        <span className="shrink-0 text-ui-micro text-(--ui-text-secondary) tabular-nums">
          {elapsed}
        </span>
      ) : null}
    </div>
  );
}

/**
 * An interjection inside the work trail: one compact line naming where it came
 * from and what it said. It opens on a click, so folding the work never costs
 * you a note you wanted to read.
 */
function ActivityInterjectionRow({ block }: { block: Block }) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(
    `ActivityInterjectionRow:${block.id}`,
    false,
  );
  const meta = block.interjection;
  if (!meta) return null;
  const chrome = interjectionChrome(meta);
  const summary = proseSummary(block.text);
  const label = (
    <span className="min-w-0 flex-1 truncate font-sans text-ui-body">
      <span className="text-(--ui-text-secondary)">{chrome.label}</span>
      {chrome.severityText ? (
        <span className={`text-ui-micro ${chrome.severityClass}`}> {chrome.severityText}</span>
      ) : null}
      {summary ? (
        <span className="text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary)">
          {" · "}
          {summary}
        </span>
      ) : null}
    </span>
  );

  if (!block.text.trim()) {
    return (
      <div
        aria-label={t("{p0} note", { p0: chrome.label })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={
          open ? t("Hide the {p0} note", { p0: chrome.label }) : `${chrome.label}: ${summary}`
        }
        onClick={() => setOpen((value) => !value)}
        className="min-w-0 text-left"
      >
        {label}
      </Button>
      {open ? (
        <div className="min-w-0 pb-2">
          <pre className={INTERJECTION_BODY}>{block.text}</pre>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The line that keeps a long think from reading as a stall. Opening the fold
 * around it does not open the thought itself — reasoning is only ever read on
 * purpose, one line until you ask for it.
 */
export function ActivityThinkingRow({
  block,
  cwd,
  expandable = false,
  bare = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  expandable?: boolean;
  bare?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ActivityThinkingRow:${block.id}`, false);
  const text = open ? t("Thinking…") : proseSummary(block.text) || t("Thinking…");
  // In a group the rail is the bullet, so there is nothing to breathe while
  // reasoning streams in — the line itself does.
  const pulse = block.streaming ? "zen-thinking-pulse" : "";
  const icon = bare ? null : (
    <Minus className={`icon-sm shrink-0 text-(--ui-text-secondary) ${pulse}`} strokeWidth={1.75} />
  );
  const label = (
    <span
      className={`min-w-0 flex-1 truncate font-sans text-ui-body text-(--ui-text-secondary) ${bare ? pulse : ""}`}
    >
      {text}
    </span>
  );

  if (!expandable) {
    return (
      <div
        aria-label={t("Thinking: {p0}", { p0: text })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={open ? t("Hide thinking") : t("Show thinking: {p0}", { p0: text })}
        onClick={() => setOpen((value) => !value)}
        className={ACTIVITY_LINE_BUTTON}
      >
        {icon}
        <span
          className={`min-w-0 flex-1 truncate font-sans text-ui-body font-normal text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-text-secondary) ${
            bare ? pulse : ""
          }`}
        >
          {text}
        </span>
      </Button>
      {open ? (
        <div className={`min-w-0 pb-2 ${bare ? "" : "pl-5"}`}>
          <AgentMarkdown
            className="agent-reasoning"
            text={block.text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A line the agent wrote mid-run, kept to one line. It opens on click, so
 * folding the work never costs you a paragraph you wanted to read.
 */
function ActivityNoteRow({
  block,
  cwd,
  bare = false,
  expandable = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  bare?: boolean;
  expandable?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ActivityNoteRow:${block.id}`, false);
  const text = proseSummary(block.text);
  const icon = bare ? null : (
    <Minus className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
  );

  if (!expandable) {
    return (
      <div
        aria-label={t("Agent said: {p0}", { p0: text })}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        <span className="line-clamp-2 min-w-0 flex-1 font-sans text-ui-body font-normal text-(--ui-text-secondary)">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        selected={open}
        aria-expanded={open}
        aria-label={open ? t("Hide the full note") : t("Agent said: {p0}", { p0: text })}
        onClick={() => setOpen((value) => !value)}
        className={ACTIVITY_LINE_BUTTON}
      >
        {icon}
        <span className="line-clamp-2 min-w-0 flex-1 text-left font-sans text-ui-body font-normal text-(--ui-text-secondary) transition-colors duration-200 group-hover:text-(--ui-tone-neutral-fg)">
          {text}
        </span>
      </Button>
      {open ? (
        <div className="min-w-0 pb-2">
          <AgentMarkdown text={block.text} cwd={cwd} onOpenFile={onOpenFile} />
        </div>
      ) : null}
    </div>
  );
}

function ActivityToolRow({
  block,
  cwd,
  live = false,
  bare = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  bare?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const t = useT();
  const [errorOpen, setErrorOpen] = useRetainedDisclosure<boolean>(
    `ActivityToolRow:${block.id}`,
    false,
  );
  const appCall = bycodaToolCall(block);
  if (appCall) {
    return <BycodaCallRow block={block} call={appCall} onApproval={onApproval} />;
  }
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const pending = needsApproval(block);
  const errorDetail = !pending && state === "rejected" ? block.tool?.detail?.trim() : undefined;
  const hasResult = !pending && hasToolInspection(block);
  const inspectionLabel =
    block.tool?.preview?.kind === "write" ? "Show changes for {p2}" : "Show output for {p2}";
  const summary = (
    <ToolCallSummary
      label={label}
      preview={block.tool?.preview}
      cwd={cwd}
      chip={bare}
      failed={state === "rejected"}
      status={state}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );

  // Every row shares one height and inset, so the trail keeps a single rhythm
  // whether or not a row can open.
  return (
    <div className="flex min-w-0 flex-col">
      {hasResult ? (
        <ActionHost
          aria-label={`${errorDetail ? "Failed tool call" : "Tool call"}: ${label}`}
          className="-mx-1 min-h-7 min-w-0 gap-1.5 px-1 py-0.5"
        >
          {bare ? null : <ActivityToolIcon state={state} live={live} />}
          <div
            className="flex min-w-0 flex-1 cursor-pointer"
            onClick={() => setErrorOpen((value) => !value)}
          >
            {summary}
          </div>
          <ToolCallStatusIcon state={state} stopped={isStoppedBlock(block)} />
          {block.tool?.preview?.kind === "write" && !errorDetail ? (
            <span className="shrink-0 text-ui-micro text-(--ui-text-secondary)">
              {t("Changes")}
            </span>
          ) : null}
          {/* Quiet until the row is hovered or focused, open, or failed: the row
              itself also toggles, and keyboard focus always reveals the action. */}
          <InlineAction
            motion="none"
            reveal={errorDetail ? "always" : "interaction"}
            aria-expanded={errorOpen}
            label={t(
              errorOpen
                ? errorDetail
                  ? "Hide error details for {p2}"
                  : "Hide output for {p2}"
                : errorDetail
                  ? "Show error details for {p2}"
                  : inspectionLabel,
              { p2: label },
            )}
            onClick={() => setErrorOpen((value) => !value)}
          >
            <ChevronRight
              className={`icon-sm transition-transform ${errorOpen ? "rotate-90" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
          </InlineAction>
        </ActionHost>
      ) : (
        <div
          aria-label={t("Tool call: {p0}", { p0: label })}
          className="-mx-1 flex min-h-7 min-w-0 items-center gap-1.5 px-1 py-0.5"
        >
          {bare ? null : <ActivityToolIcon state={state} live={live} />}
          {summary}
          {pending ? null : <ToolCallStatusIcon state={state} stopped={isStoppedBlock(block)} />}
        </div>
      )}
      {pending ? <ApprovalControls block={block} onApproval={onApproval} /> : null}
      {errorOpen && hasResult ? (
        <div className={`min-w-0 py-1 ${bare ? "" : "pl-5"}`}>
          <ToolInspectionPanel block={block} />
        </div>
      ) : null}
    </div>
  );
}

function BycodaMark({ className = "size-4" }: { className?: string }) {
  useLocale();
  return <img src={PRODUCT_IDENTITY.logoSrc} alt="" className={`shrink-0 ${className}`} />;
}

/** Bycoda commands keep both successful results and failures available on demand. */
function BycodaCallRow({
  block,
  call,
  onApproval,
}: {
  block: Block;
  call: BycodaToolCall;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const t = useT();
  const state = toolCallState(block);
  const [errorOpen, setErrorOpen] = useRetainedDisclosure<boolean>(
    `BycodaCallRow:${block.id}`,
    false,
  );
  const pendingApproval = needsApproval(block);
  const hasResult = !pendingApproval && hasToolInspection(block);
  const hasError = state === "rejected" && hasResult;
  const command = `${PRODUCT_IDENTITY.displayName} app ${call.action}`;
  const verb = pendingApproval ? "Run" : state === "pending" ? "Running" : "Ran";
  const summary = (
    <>
      <span
        className={`shrink-0 font-sans text-ui-body ${state === "rejected" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
      >
        {verb}
      </span>
      <span
        className={`flex min-w-0 max-w-full items-center gap-1 rounded bg-(--ui-surface-raised) px-1 font-mono text-ui-secondary ${state === "rejected" ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
        title={command}
      >
        <BycodaMark className="size-3.5" />
        <span className="min-w-0 truncate">{command}</span>
      </span>
      <ToolCallStatusIcon state={state} stopped={isStoppedBlock(block)} />
      {hasResult ? (
        <ChevronRight
          className={`icon-sm shrink-0 ${hasError ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"} transition-transform ${errorOpen ? "rotate-90" : ""}`}
          strokeWidth={1.75}
        />
      ) : null}
    </>
  );
  return (
    <div data-bycoda-tool-call={call.action} className="min-w-0">
      {hasResult ? (
        <Button
          motion="none"
          fullWidth
          variant="item"
          type="button"
          aria-expanded={errorOpen}
          aria-label={t(
            hasError
              ? errorOpen
                ? "Hide error details for {p1}: {p2}"
                : "Show error details for {p1}: {p2}"
              : errorOpen
                ? "Hide output for {p1}: {p2}"
                : "Show output for {p1}: {p2}",
            { p1: PRODUCT_IDENTITY.displayName, p2: call.label },
          )}
          onClick={() => setErrorOpen((value) => !value)}
          className="w-full min-w-0 text-left"
        >
          {summary}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-1">{summary}</div>
      )}
      {errorOpen && hasResult ? <ToolInspectionPanel block={block} /> : null}
      {pendingApproval ? (
        <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-all py-1 pl-5 font-mono text-ui-caption leading-5 text-(--ui-text-secondary)">
          {call.command}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ActivityToolIcon({ state, live = false }: { state: ToolCallState; live?: boolean }) {
  useLocale();
  if (state === "pending") {
    return (
      <CircleDashed
        className={`icon-sm shrink-0 text-(--ui-text-secondary) ${live ? "zen-tool-spin" : ""}`}
        strokeWidth={1.75}
      />
    );
  }

  return <Minus className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />;
}

/** Failure stays marked. Running and success do not get a trailing icon. */
function ToolCallStatusIcon({
  state,
  stopped = false,
}: {
  state: ToolCallState;
  stopped?: boolean;
}) {
  const t = useT();
  // A call cut short on purpose settles as accepted, so mark it instead of reading as done.
  if (stopped && state !== "rejected") {
    return (
      <span className="shrink-0 font-sans text-ui-micro text-(--ui-text-secondary)">
        {t("Stopped")}
      </span>
    );
  }
  if (state === "rejected") {
    return <X className="icon-sm shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  return null;
}

export function formatWorkingDuration(
  elapsedMs: number | null,
  modelName?: string,
  done = false,
): string {
  const who = modelName?.trim();
  const elapsed = formatElapsed(elapsedMs);
  const verb = done ? (who ? "worked" : "Worked") : who ? "working" : "Working";
  if (elapsed == null) {
    if (done) return who ? `${who} ${verb}` : verb;
    return who ? `${who} ${verb}…` : `${verb}…`;
  }
  return who ? `${who} ${verb} for ${elapsed}` : `${verb} for ${elapsed}`;
}

export function ToolCall({
  block,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  embedded,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  embedded?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useRetainedDisclosure<boolean>(`ToolCall:${block.id}`, false);
  const preview = block.tool?.preview;
  const label = toolCallLabel(block, cwd);
  const detail = block.tool?.detail?.trim();
  const expanded = detail && detail !== label ? detail : label;
  const state = toolCallState(block);
  const stateLabel =
    state === "accepted" ? "Accepted" : state === "rejected" ? "Rejected" : "Pending";
  const editTool = isEditTool(block.tool?.kind, block.text || block.tool?.title, preview);
  const compact =
    isReadTool(block.tool?.kind, label, preview) || isSearchTool(block.tool?.kind, label, preview);
  const expandable = !compact && !!detail && detail !== label;

  const frame = embedded ? "py-0.5" : "px-4 py-1";

  const appCall = bycodaToolCall(block);
  if (appCall) {
    return (
      <div className={frame}>
        <BycodaCallRow block={block} call={appCall} onApproval={onApproval} />
      </div>
    );
  }

  if (!needsApproval(block)) {
    if (isIncompleteTool(block, label, state)) return null;
    return (
      <div className={frame}>
        <ActivityToolRow block={block} cwd={cwd} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
      </div>
    );
  }

  if (editTool) {
    return (
      <div className={frame}>
        {needsApproval(block) ? (
          <FilePreview
            preview={preview ?? stubFilePreview(block.tool?.kind, label)}
            status={state}
            cwd={cwd}
            onOpenFile={onOpenDiff ?? onOpenFile}
          />
        ) : (
          <div className="flex min-w-0 items-center gap-2 py-1">
            <ToolCallIcon state={state} />
            <ToolCallSummary
              label={label}
              wrap={block.tool?.kind === "shell"}
              preview={preview}
              cwd={cwd}
              failed={state === "rejected"}
              status={state}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          </div>
        )}
        <ApprovalControls block={block} onApproval={onApproval} />
      </div>
    );
  }

  if (isIncompleteTool(block, label, state)) return null;

  return (
    <div className={frame}>
      {expandable ? (
        <Button
          motion="none"
          fullWidth
          variant="item"
          type="button"
          selected={open}
          aria-expanded={open}
          aria-label={t("{p0} tool call: {p1}", { p0: stateLabel, p1: label })}
          onClick={() => setOpen((value) => !value)}
          className="w-full min-w-0 text-left"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            wrap={block.tool?.kind === "shell"}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
          <ChevronRight
            className={`icon-sm shrink-0 text-(--ui-text-secondary) transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.75}
          />
        </Button>
      ) : (
        <div
          aria-label={t("{p0} tool call: {p1}", { p0: stateLabel, p1: label })}
          className="flex w-full min-w-0 items-center gap-2"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            wrap={block.tool?.kind === "shell"}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
      {open && expandable ? (
        <pre className="mt-1.5 min-w-0 whitespace-pre-wrap break-words px-2.5 font-mono text-ui-caption leading-5 text-(--ui-text-secondary)">
          {expanded}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ToolCallSummary({
  label,
  wrap = false,
  preview,
  cwd,
  onOpenFile,
  onOpenDiff,
  interactive = true,
  chip = false,
  failed = false,
  status = "accepted",
}: {
  label: string;
  wrap?: boolean;
  preview?: ToolPreview;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  interactive?: boolean;
  /** Sets the file off in a chip, for rows that lean on a rail for structure. */
  chip?: boolean;
  failed?: boolean;
  status?: ToolCallState;
}) {
  useLocale();
  const { action, target, fileName, filePath, isFile, previewMatchesFile } = useToolCallDisplay(
    label,
    preview,
    cwd,
  );
  if (!action || !target) {
    return (
      <span
        className={`min-w-0 flex-1 ${wrap ? "tool-command-label line-clamp-3" : "truncate"} font-mono text-ui-secondary ${
          failed
            ? "text-(--ui-tone-danger-fg)"
            : chip
              ? "text-(--ui-text-secondary)"
              : "text-(--ui-text-secondary)"
        }`}
        title={label}
      >
        {label}
      </span>
    );
  }
  const openFile =
    action === "Edit" || action === "Write" ? (onOpenDiff ?? onOpenFile) : onOpenFile;
  const canOpen = interactive && !!openFile && !!filePath;
  const canPreview =
    interactive &&
    preview?.kind === "write" &&
    previewMatchesFile &&
    (preview.contentOnly || preview.lines?.some((line) => line.kind !== "context"));
  const actionTone = failed ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)";
  const targetTone = failed
    ? "text-(--ui-tone-danger-fg)"
    : chip
      ? "text-(--ui-text-secondary)"
      : "text-(--ui-text-secondary)";

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ui-secondary">
      <span className={`shrink-0 font-sans text-ui-body ${actionTone}`}>{action}</span>
      {isFile ? (
        canPreview ? (
          <ToolDiffPreview
            preview={preview}
            label={target}
            status={status}
            cwd={cwd}
            onOpen={openFile && filePath ? () => openFile(filePath) : undefined}
            onOpenFile={onOpenFile}
            className={`-my-0.5 flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left hover:text-(--ui-tone-info-fg) ${
              chip ? `max-w-full bg-(--ui-surface-raised) ${targetTone}` : `flex-1 ${targetTone}`
            }`}
          >
            <FileTypeIcon name={fileName} isDir={false} />
            <span className="min-w-0 truncate">{target}</span>
          </ToolDiffPreview>
        ) : canOpen ? (
          <Button
            motion="none"
            className="-my-0.5 min-w-0 text-left max-w-full flex-1"
            fullWidth
            variant="item"
            type="button"

            tooltip={target}
            onClick={(event) => {
              event.stopPropagation();
              openFile?.(filePath);
            }}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{target}</span>
          </Button>
        ) : (
          <span
            className={`flex min-w-0 items-center gap-1 rounded px-1 ${
              chip ? `max-w-full bg-(--ui-surface-raised) ${targetTone}` : `flex-1 ${targetTone}`
            }`}
            title={target}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{target}</span>
          </span>
        )
      ) : (
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 pl-1 ${targetTone}`}
          title={target}
        >
          <span className="min-w-0 truncate">{target}</span>
        </span>
      )}
    </span>
  );
}

function ToolCallIcon({ state }: { state: ToolCallState }) {
  useLocale();
  if (state === "rejected") {
    return <X className="icon-sm shrink-0 text-(--ui-tone-danger-fg)" strokeWidth={2} />;
  }
  if (state === "pending") {
    return (
      <CircleDashed className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
    );
  }
  return null;
}

function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const context = useApprovalDecisionContext();
  const approval = block.approval;
  if (!approval || approval.decided || !onApproval) return null;
  if (!context) return <ApprovalContextUnavailable />;
  return <ConnectedApprovalControls block={block} context={context} />;
}

function ApprovalContextUnavailable() {
  const t = useT();
  return (
    <span className="text-ui-caption text-(--ui-text-secondary)">
      {t("Open this request in its conversation to respond.")}
    </span>
  );
}

function ConnectedApprovalControls({
  block,
  context,
}: {
  block: Block;
  context: NonNullable<ReturnType<typeof useApprovalDecisionContext>>;
}) {
  const t = useT();
  const decision = useApprovalDecisionControl(
    context.session,
    block.approval!.requestId,
    context.dispatch,
    block,
  );
  return (
    <div>
      <div className="mt-1.5 flex gap-2">
        <Button
          motion="none"
          variant="primary"
          type="button"

          loading={decision.pending && decision.decision === "allow"}
          disabled={decision.blocked}
          onClick={() => void decision.decide("allow")}
        >
          {t("Allow")}
        </Button>
        <Button
          motion="none"
          variant="ghost"
          tone="danger"
          type="button"

          loading={decision.pending && decision.decision === "deny"}
          disabled={decision.blocked}
          onClick={() => void decision.decide("deny")}
        >
          {t("Deny")}
        </Button>
      </div>
      {decision.feedback ? (
        decision.danger ? (
          <Alert tone="danger" inline>
            {decision.feedback}
          </Alert>
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="mt-1.5 text-ui-caption text-(--ui-text-secondary)"
          >
            {decision.feedback}
          </div>
        )
      ) : null}
    </div>
  );
}

export function HandoffDivider({ block }: { block: Block }) {
  const t = useT();
  const meta = block.handoff;
  const phase = useSyncExternalStore(
    subscribeHandoffPhase,
    () => (meta ? handoffPhaseOf(meta.from) : undefined),
    () => undefined,
  );
  if (!meta) return null;

  const preparing = meta.status === "preparing";
  const failed = meta.status === "failed";
  const cancelled = meta.status === "cancelled";
  const terminal = failed || cancelled;
  const label = preparing
    ? phase === "summarizing"
      ? t("Asking {p0} for a summary…", { p0: HARNESS_TITLE[meta.from] })
      : phase === "stopping"
        ? t("Stopping {p0}…", { p0: HARNESS_TITLE[meta.from] })
        : t("Preparing a handoff")
    : terminal
      ? `${HARNESS_TITLE[meta.to]} · ${t(failed ? "Failed" : "Cancelled")}`
      : HARNESS_TITLE[meta.to];

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
        <div
          role={terminal ? "status" : "separator"}
          aria-live={terminal ? "polite" : undefined}
          aria-label={
            preparing
              ? t("Preparing a handoff to {p0}", { p0: HARNESS_TITLE[meta.to] })
              : terminal
                ? `${t("Handoff")} · ${label}`
                : t("Continued with {p0}", { p0: label })
          }
          className={`flex max-w-[min(100%,20rem)] items-center gap-1.5 px-1.5 font-sans text-ui-caption ${failed ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"}`}
        >
          {preparing ? (
            <>
              <Spinner size="xs" className="shrink-0" />
              <Shimmer duration={1.4}>{label}</Shimmer>
            </>
          ) : terminal ? (
            <>
              <X aria-hidden="true" className="icon-sm shrink-0" />
              <span>{label}</span>
            </>
          ) : (
            <>
              <HarnessIcon harness={meta.to} className="size-3.5 shrink-0" />
            </>
          )}
        </div>
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
      </div>
    </div>
  );
}

/** The label and severity chrome an interjection wears, wherever it sits. */
function interjectionChrome(meta: InterjectionMeta): {
  label: string;
  severityText?: string;
  severityClass: string;
} {
  const label =
    meta.customType === "advisor"
      ? "Advisor"
      : meta.customType === "custom"
        ? "Notice"
        : meta.customType;
  const severityText =
    meta.severity === "blocker"
      ? "Blocker"
      : meta.severity === "concern"
        ? "Concern"
        : meta.severity === "nit"
          ? "Nit"
          : undefined;
  const severityClass =
    meta.severity === "blocker"
      ? "text-(--ui-tone-danger-fg)"
      : meta.severity === "concern"
        ? "text-(--ui-tone-warning-fg)"
        : "text-(--ui-text-secondary)";
  return { label, severityText, severityClass };
}

/** The advisory body under an interjection, wherever the note is surfaced. */
const INTERJECTION_BODY =
  "min-w-0 whitespace-pre-wrap break-words font-sans text-ui-secondary leading-5 text-(--ui-text-secondary)";

/** A mid-turn interjection, e.g. OMP advisor notes: a labeled boundary with
 * a collapsible advisory body below it. */
export function InterjectionDivider({ block }: { block: Block }) {
  const t = useT();
  const [expanded, setExpanded] = useRetainedDisclosure<boolean>(`interjection:${block.id}`, false);
  const textRef = useRef<HTMLPreElement>(null);
  const overflows = useClampOverflow(textRef, Boolean(block.text), expanded, block.text);

  const meta = block.interjection;
  if (!meta) return null;
  const { label, severityText, severityClass } = interjectionChrome(meta);
  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
        <div
          role="separator"
          aria-label={t("Interjection: {p0}", { p0: label })}
          className="flex items-center gap-2 px-1.5 font-sans text-ui-caption text-(--ui-text-secondary)"
        >
          <span>{label}</span>
          {severityText ? (
            <span className={`text-ui-micro ${severityClass}`}>{severityText}</span>
          ) : null}
        </div>
        <div className="h-px min-w-4 flex-1 bg-(--color-stroke)" />
      </div>
      {block.text ? (
        <div className="mt-2 px-2">
          <pre ref={textRef} className={`${INTERJECTION_BODY} ${expanded ? "" : "line-clamp-2"}`}>
            {block.text}
          </pre>
          {overflows ? (
            <Button
              motion="none"
              variant="ghost"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="mt-1"
            >
              {expanded ? t("Show less") : t("Show more")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
