import { HARNESSES, type Block, type HarnessId, type Session } from "./session";

/** One provider, account and model state in a conversation's switch history. */
export type ModelSwitchState = {
  harness: HarnessId;
  /** Account label at switch time; providers without accounts leave it out. */
  account?: string;
  /** Model display name at switch time. */
  model: string;
};

export type ModelSwitchStep = ModelSwitchState & {
  at: number;
  /**
   * `deferred`: picked while a turn ran, applies to the next message.
   * `summary`: the conversation could not move, so a summary goes with the next message.
   */
  note?: "deferred" | "summary";
};

/** `steps[0]` is the state before the first switch; the last step is the current one. */
export type ModelSwitchMeta = { steps: ModelSwitchStep[] };

const MAX_STEPS = 50;
const MAX_LABEL = 200;

export function sameSwitchState(a: ModelSwitchState, b: ModelSwitchState): boolean {
  return a.harness === b.harness && a.account === b.account && a.model === b.model;
}

/**
 * Records a provider, account or model switch as one transcript row. Switches
 * with no message between them fold into the same row; a new row starts once
 * the conversation moves on. `text` stays as the plain-text fallback.
 */
export function withModelSwitch(
  input: Session,
  from: ModelSwitchState,
  to: ModelSwitchState & Pick<ModelSwitchStep, "note">,
  text: string,
  at = Date.now(),
): Session {
  let session = input;
  if (!session.blocks.some((block) => block.role === "user")) return session;
  const step: ModelSwitchStep = { ...stateOf(to), at, ...(to.note ? { note: to.note } : {}) };
  const deferred = lastSwitchIndex(session.blocks);
  const pending = deferred >= 0 ? lastStep(session.blocks[deferred]) : undefined;
  if (pending?.note === "deferred") {
    // A pick that waited for the running turn now applies: settle that step instead of adding one.
    if (step.note !== "deferred" && sameSwitchState(pending, step)) {
      const { note: _deferred, ...settled } = pending;
      return patchSteps(session, deferred, text, (steps) => [
        ...steps.slice(0, -1),
        step.note ? { ...settled, note: step.note } : settled,
      ]);
    }
    // A newer pick replaced the waiting one, or it was withdrawn.
    if (step.note === "deferred" || !session.nextProviderAccountId) {
      session = withoutDeferredSwitch(session);
    }
  }
  if (sameSwitchState(from, to) && !step.note) return session;
  const trailing = trailingSwitchIndex(session.blocks);
  if (trailing >= 0) {
    return patchSteps(session, trailing, text, (steps) => {
      const last = steps[steps.length - 1];
      if (sameSwitchState(last, step) && last.note === step.note) return steps;
      return [...steps, step].slice(-MAX_STEPS);
    });
  }
  return {
    ...session,
    blocks: [
      ...session.blocks,
      {
        id: crypto.randomUUID(),
        role: "system",
        text,
        modelSwitch: { steps: [{ ...stateOf(from), at }, step] },
      },
    ],
  };
}

/** Drops a waiting pick that will not apply: it failed or was withdrawn. */
export function withoutDeferredSwitch(session: Session): Session {
  const index = lastSwitchIndex(session.blocks);
  const steps = index >= 0 ? session.blocks[index].modelSwitch?.steps : undefined;
  if (!steps || steps[steps.length - 1]?.note !== "deferred") return session;
  const kept = steps.slice(0, -1);
  const blocks = session.blocks.slice();
  if (kept.length < 2) blocks.splice(index, 1);
  else blocks[index] = { ...blocks[index], modelSwitch: { steps: kept } };
  return { ...session, blocks };
}

/**
 * A finished handoff divider repeats what the switch row above it already
 * says; failed, cancelled and preparing handoffs still show.
 */
export function isHandoffCoveredBySwitch(blocks: Block[], index: number): boolean {
  const handoff = blocks[index]?.handoff;
  if (!handoff || handoff.status !== "ready") return false;
  for (let at = index - 1; at >= 0; at -= 1) {
    const block = blocks[at];
    if (block.role === "handoff") return false;
    const step = lastStep(block);
    if (step) return step.harness === handoff.to;
  }
  return false;
}

export function sanitizeModelSwitch(value: unknown): ModelSwitchMeta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as { steps?: unknown }).steps;
  if (!Array.isArray(raw)) return undefined;
  const steps = raw.slice(-MAX_STEPS).flatMap((item): ModelSwitchStep[] => {
    if (!item || typeof item !== "object") return [];
    const step = item as Partial<ModelSwitchStep>;
    if (!HARNESSES.includes(step.harness as HarnessId)) return [];
    const model = label(step.model);
    if (!model || typeof step.at !== "number" || !Number.isFinite(step.at)) return [];
    const account = label(step.account);
    return [
      {
        harness: step.harness as HarnessId,
        ...(account ? { account } : {}),
        model,
        at: step.at,
        ...(step.note === "deferred" || step.note === "summary" ? { note: step.note } : {}),
      },
    ];
  });
  return steps.length >= 2 ? { steps } : undefined;
}

function label(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LABEL) : undefined;
}

function stateOf(state: ModelSwitchState): ModelSwitchState {
  return {
    harness: state.harness,
    ...(state.account ? { account: state.account } : {}),
    model: state.model,
  };
}

function lastStep(block: Block): ModelSwitchStep | undefined {
  const steps = block.modelSwitch?.steps;
  return steps?.[steps.length - 1];
}

function lastSwitchIndex(blocks: Block[]): number {
  for (let at = blocks.length - 1; at >= 0; at -= 1) {
    if (blocks[at].modelSwitch) return at;
  }
  return -1;
}

/** The switch row still open for folding: only status rows came after it. */
function trailingSwitchIndex(blocks: Block[]): number {
  for (let at = blocks.length - 1; at >= 0; at -= 1) {
    const block = blocks[at];
    if (block.modelSwitch) return at;
    if (block.role !== "system") return -1;
  }
  return -1;
}

function patchSteps(
  session: Session,
  index: number,
  text: string,
  update: (steps: ModelSwitchStep[]) => ModelSwitchStep[],
): Session {
  const block = session.blocks[index];
  const steps = block.modelSwitch?.steps ?? [];
  const next = update(steps);
  if (next === steps) return session;
  const blocks = session.blocks.slice();
  blocks[index] = { ...block, text, modelSwitch: { steps: next } };
  return { ...session, blocks };
}
