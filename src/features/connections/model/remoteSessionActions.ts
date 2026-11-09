import type { Attachment, ComposerTurnOptions, PlanBuildTarget, Session } from "../../sessions";
import type { HostSession } from "./protocol";
import type { ApprovalDecision, UserQuestionReply } from "../../../integrations/harness";
import type { ProviderAccountProvider } from "../../providers/model/providerAccounts";

type RemoteActions = {
  buildPlan: (blockId: string, target?: PlanBuildTarget) => void;
  submit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => boolean | void;
  saveDraft: (text: string, attachments: Attachment[]) => boolean | void;
  removeDraft?: (draftBlockId: string) => boolean;
  selectAccount?: (provider: ProviderAccountProvider, accountId: string) => boolean;
  stop: () => void;
  rewind: (blockId: string) => Promise<boolean>;
  compact: () => boolean;
  approve: (requestId: number, decision: ApprovalDecision, approvalOccurrenceId?: string) => void;
  /** Observed Host capability, never an execution grant or provider ACK. */
  approvalOccurrenceSupported?: boolean;
  /** Current source owned by this registration; private observation, never authority. */
  approvalSource?: () => { session: Session; snapshot: HostSession } | undefined;
  answer: (requestId: number, reply: UserQuestionReply) => void;
};

type Registration = { actions: RemoteActions; observation: object };
const actions = new Map<string, Registration>();
const absent = Object.freeze({});
const listeners = new Map<string, Set<() => void>>();
function changed(shellId: string) {
  for (const listener of Array.from(listeners.get(shellId) ?? [])) {
    try {
      listener();
    } catch {
      /* A UI observer cannot change registration ownership. */
    }
  }
}
/** Reactive source observation only; this object is never an execution grant. */
export function remoteSessionActionsObservation(shellId: string): object {
  return currentModule() ? (actions.get(shellId)?.observation ?? absent) : absent;
}
export function subscribeRemoteSessionActions(shellId: string, listener: () => void) {
  const set = listeners.get(shellId) ?? new Set<() => void>();
  listeners.set(shellId, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(shellId);
  };
}
export function publishRemoteSessionActionSource(shellId: string, expected: RemoteActions) {
  const registration = currentModule() ? actions.get(shellId) : undefined;
  if (!registration || registration.actions !== expected) return;
  registration.observation = Object.freeze({});
  changed(shellId);
}
// A capture from a replaced module must not validate an abandoned map. This is
// private local registration identity, never a serialized route or permission.
const keeperKey = Symbol.for("bycoda.remote-session-actions.owner.v1");
const keepers = globalThis as typeof globalThis & { [keeperKey]?: object };
const moduleOwner = {};
keepers[keeperKey] = moduleOwner;
const currentModule = () => keepers[keeperKey] === moduleOwner;

export type CapturedRemoteSessionActions = {
  readonly actions: RemoteActions;
  current(): boolean;
};

export function captureRemoteSessionActions(
  shellId: string,
): CapturedRemoteSessionActions | undefined {
  const registration = currentModule() ? actions.get(shellId) : undefined;
  if (!registration) return undefined;
  return Object.freeze({
    actions: registration.actions,
    current: () => currentModule() && actions.get(shellId) === registration,
  });
}

export function registerRemoteSessionActions(shellId: string, value: RemoteActions) {
  const registration = { actions: value, observation: Object.freeze({}) };
  if (currentModule()) {
    actions.set(shellId, registration);
    changed(shellId);
  }
  return () => {
    if (actions.get(shellId) === registration) {
      actions.delete(shellId);
      changed(shellId);
    }
  };
}

export function buildRemotePlan(shellId: string, blockId: string, target?: PlanBuildTarget) {
  remoteSessionActions(shellId)?.buildPlan(blockId, target);
}

export function remoteSessionActions(shellId: string): RemoteActions | undefined {
  return currentModule() ? actions.get(shellId)?.actions : undefined;
}
