import type { Block, Session } from "./session";
import { deriveActivityDock, type DockAgent } from "./activityDock";
import { groupTurns, toolCallState } from "./transcriptActivity";
import type { CrewRole } from "../ui/crewMotion";
import { contextRatio } from "./contextUsage";

/** One crew member: the array index is the seat id. `context` is the fraction of its own
 * context window in use (0-1); zero for unused seats after the session starts,
 * absent for the untouched welcome crew. Assigned names override the role label. */
export type CrewSeat = { role: CrewRole; working: boolean; context?: number; name?: string };

export const LEAD_SEAT = 2;
export const ADVISOR_SEAT = 3;
/** Subagent #1-#4 sit here; further subagents take seats 6+ and only exist while working. */
const SUBAGENT_SEATS = [0, 1, 4, 5];
const MIN_SEATS = 6;

/** Claude's advisor is a server tool named "advisor"; the harness keeps the name as the tool kind. */
export function isAdvisorBlock(block: Block): boolean {
  return block.role === "tool" && (block.tool?.kind ?? "").toLowerCase() === "advisor";
}

function advisorWorking(session: Session): boolean {
  if (!session.busy) return false;
  const turns = groupTurns(session.blocks);
  const turn = turns[turns.length - 1] ?? [];
  return turn.some((block) => isAdvisorBlock(block) && toolCallState(block) === "pending");
}

/** Seats of one session's crew. Only that session and its own worker sessions are considered. */
export function crewSeats(sessionId: string | undefined, sessions: readonly Session[]): CrewSeat[] {
  const session =
    sessionId === undefined ? undefined : sessions.find((item) => item.id === sessionId);
  let leadWorking = false,
    advisor = false,
    subagents = 0;
  let leadContext: number | undefined;
  let advisorContext: number | undefined;
  let started = false;
  let helpers: { context: number | undefined; name?: string }[] = [];
  if (session) {
    const active = !!session.busy || !!session.continuingElsewhere;
    const workerSessions = sessions.filter(
      (worker) =>
        worker.orchestrationLeadId === session.id && (worker.busy || worker.continuingElsewhere),
    );
    started =
      active ||
      workerSessions.length > 0 ||
      (session.context?.used ?? 0) > 0 ||
      session.blocks.some(
        (block) => !block.draft && ["user", "assistant", "tool"].includes(block.role),
      );
    const dock = deriveActivityDock({
      blocks: session.blocks,
      busy: !!session.busy,
      pendingQuestion: !!session.pendingQuestion,
      backgroundTasks: session.backgroundTasks,
      backgroundAgents: session.backgroundAgents,
      unseenDone: false,
    });
    // Persistent background commands are idle: the lead only stands for real work.
    leadWorking = active && dock.state !== "background";
    advisor = advisorWorking(session);
    leadContext = started ? (contextRatio(session.context) ?? 0) : undefined;
    // An unused advisor has no conversation of its own yet.
    advisorContext = session.blocks.some(isAdvisorBlock) ? leadContext : started ? 0 : undefined;
    const window = session.context?.window;
    // Each subagent's own context reading, against the session's window. Running ones come
    // first (they hold the working seats); finished ones of the latest turn keep their age.
    const runs = new Map<string, DockAgent>();
    for (const agent of dock.agents)
      if (agent.kind === "agent") runs.set(agent.callId ?? agent.blockId, agent);
    const ordered = [...runs.values()].sort(
      (a, b) => Number(b.status === "running") - Number(a.status === "running"),
    );
    const children = ordered.filter((agent) => agent.status === "running").length;
    const childrenWithContext = ordered.map((agent) => {
      const used = session.blocks.find((block) => block.id === agent.blockId)?.tool?.agentContext
        ?.used;
      // No reading yet (or a provider that never sends one): the subagent shares the lead's age.
      return {
        name: agent.name === "Subagent" ? undefined : agent.name,
        context: used !== undefined && window ? Math.min(1, used / window) : leadContext,
      };
    });
    const workers = workerSessions.length;
    // Worker sessions and transcript rows can describe the same delegated work.
    subagents = Math.max(children, active ? (session.backgroundAgents ?? 0) : 0, workers);
    helpers =
      workers > children
        ? workerSessions.map((worker) => ({
            name: worker.title?.trim() || undefined,
            context: contextRatio(worker.context) ?? leadContext,
          }))
        : childrenWithContext;
    while (helpers.length < subagents) helpers.push({ context: leadContext ?? 0 });
  }
  const seats: CrewSeat[] = Array.from(
    { length: Math.max(MIN_SEATS, MIN_SEATS + subagents - SUBAGENT_SEATS.length) },
    () => ({ role: "subagent", working: false, ...(started ? { context: 0 } : {}) }),
  );
  const withContext = (seat: CrewSeat, context: number | undefined): CrewSeat =>
    context === undefined ? seat : { ...seat, context };
  // A called advisor reads the lead's whole conversation and shares its age.
  seats[LEAD_SEAT] = withContext({ role: "lead", working: leadWorking }, leadContext);
  seats[ADVISOR_SEAT] = withContext({ role: "advisor", working: advisor }, advisorContext);
  const seatOf = (n: number) =>
    n < SUBAGENT_SEATS.length ? SUBAGENT_SEATS[n] : MIN_SEATS + n - SUBAGENT_SEATS.length;
  for (let n = 0; n < subagents; n++) seats[seatOf(n)].working = true;
  helpers.slice(0, Math.max(subagents, SUBAGENT_SEATS.length)).forEach((helper, n) => {
    const id = seatOf(n);
    if (seats[id]) seats[id] = withContext({ ...seats[id], name: helper.name }, helper.context);
  });
  return seats;
}

/** Preview/test crew: `count` working seats, filled lead, advisor, then subagents. */
export function previewCrewSeats(count: number): CrewSeat[] {
  const n = Math.max(0, Math.floor(count));
  const seats = crewSeats(undefined, []);
  while (seats.length < n) seats.push({ role: "subagent", working: false });
  const order = [
    LEAD_SEAT,
    ADVISOR_SEAT,
    ...SUBAGENT_SEATS,
    ...seats.map((_, id) => id).filter((id) => id >= MIN_SEATS),
  ];
  order.slice(0, n).forEach((id) => {
    seats[id].working = true;
  });
  return seats;
}

/** Context fill (percent of the window) at which a crew member becomes a child, an adult,
 * then an uncle. The uncle stretch starts well before providers auto-compact (~80-90%),
 * so a long conversation spends real time as an uncle before compaction makes it young again. */
export const CREW_AGE_THRESHOLDS = [15, 40, 65] as const;

/** Stage (0 baby, 1 child, 2 adult, 3 uncle) and 0-1 growth inside it. Unknown context = uncle. */
export function crewAge(context: number | undefined): { stage: number; growth: number } {
  if (context === undefined || !Number.isFinite(context))
    return { stage: CREW_AGE_THRESHOLDS.length, growth: 1 };
  const percent = Math.max(0, Math.min(1, context)) * 100;
  let stage = 0;
  while (stage < CREW_AGE_THRESHOLDS.length && percent >= CREW_AGE_THRESHOLDS[stage]) stage++;
  const from = stage ? CREW_AGE_THRESHOLDS[stage - 1] : 0;
  const to = stage < CREW_AGE_THRESHOLDS.length ? CREW_AGE_THRESHOLDS[stage] : 100;
  return { stage, growth: Math.max(0, Math.min(1, (percent - from) / (to - from))) };
}
