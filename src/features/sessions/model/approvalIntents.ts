import { useSyncExternalStore } from "react";
import {
  getHarness,
  respondHarnessApproval,
  type ApprovalDecision,
  type HarnessEvent,
} from "../../../integrations/harness";
import {
  captureRemoteSessionActions,
  type CapturedRemoteSessionActions,
} from "../../connections/model/remoteSessionActions";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import type { HostSession } from "../../connections/model/protocol";
import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { registerParentInput, type ParentAdmission } from "../data/parentInputClosure";
import {
  copyNativeCaptureData,
  createNativeCaptureSnapshotEncoder,
  stringifyNativeCaptureJson,
} from "../../../shared/lib/native-capture-json";
import type { Block, Session } from "./session";
import { isApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";

export const APPROVAL_INTENT_LIMITS = Object.freeze({ records: 64, bytes: 4 * 1024 * 1024 });
export const APPROVAL_INTENT_MESSAGES = Object.freeze({
  closed: "Preparing checkpoint. This approval was not sent.",
  capacity: "Approval decision storage is full. Original decisions are retained.",
  changed: "This approval request or its connection changed. This decision was not sent.",
  unavailable: "Approval connection is unavailable. This decision was not sent.",
  occurrence:
    "This Host cannot verify which request you are answering. Update the Host before responding.",
  unconfirmed: "Waiting for confirmation",
});

export type ApprovalIntentView = Readonly<{
  id: number;
  decision: ApprovalDecision;
  phase: "pending" | "unconfirmed" | "rejected" | "uncertain";
  callback: "not-started" | "pending" | "void" | "fulfilled" | "rejected" | "threw";
  providerAck: "unproved";
  repeatBlocked: boolean;
  error: string | null;
}>;
declare const tokenBrand: unique symbol;
/** Private render-time occurrence identity. Never data, RPC input or permission. */
export type ApprovalRequestToken = { readonly [tokenBrand]: true };
type Owner = ReturnType<typeof registerParentInput>;
type Route = {
  data: Record<string, unknown>;
  remote?: CapturedRemoteSessionActions;
  adapter?: ReturnType<typeof getHarness>;
  method?: NonNullable<ReturnType<typeof getHarness>>["respondApproval"];
  remoteMethod?: CapturedRemoteSessionActions["actions"]["approve"];
  source?: CapturedRemoteSessionActions["actions"]["approvalSource"];
  sourceValue?: { session: Session; snapshot: HostSession };
  sourceHeader?: ReturnType<typeof hostData>;
  sourceIdentity?: object;
  unavailable: boolean;
  occurrenceSupported?: boolean;
};
type Captured = {
  sessionId: string;
  requestId: number;
  block: Block;
  blockId: string;
  approval: NonNullable<Block["approval"]>;
  occurrenceId?: string;
  original: Record<string, unknown>;
  fingerprint: string;
  sourceOriginal?: Record<string, unknown>;
  sourceFingerprint?: string;
  started: boolean;
  route: Route;
  refusal?: string;
};
type Entry = {
  block: Block;
  approval: NonNullable<Block["approval"]>;
  occurrenceId?: string;
  sessionId: string;
  requestId: number;
  fingerprint: string;
  sourceFingerprint?: string;
  view: ApprovalIntentView;
  data: Record<string, unknown>;
  pending: boolean;
  represented: boolean;
  route: Route;
  hostCursor?: object;
  blockId: string;
};
type State = {
  version: 1;
  nextId: number;
  records: Entry[];
  listeners: Set<() => void>;
  owner?: Owner;
  read: () => Record<string, unknown>;
  unavailable: boolean;
};
// Reserve the largest escaped bounded diagnostic and outcome metadata BEFORE effect.
const OUTCOME_RESERVE = 4096;
const bytes = new TextEncoder();
const MODULE = Symbol.for("bycoda.approval-intents.module.v1");
const KEEPER = Symbol.for("bycoda.approval-intents.data.v1");
const HOST_SOURCES = Symbol.for("bycoda.approval-intents.host-identities.v1");
const globals = globalThis as Record<PropertyKey, unknown>;
const hostSources = (globals[HOST_SOURCES] ??= new WeakMap<HostSession, object>()) as WeakMap<
  HostSession,
  object
>;
function hostIdentity(snapshot: HostSession) {
  let identity = hostSources.get(snapshot);
  if (!identity) {
    identity = Object.freeze({});
    hostSources.set(snapshot, identity);
  }
  return identity;
}
const moduleOwner = {};
globals[MODULE] = moduleOwner;
const currentModule = () => globals[MODULE] === moduleOwner;

function wire(value: Record<string, unknown>): string {
  return stringifyNativeCaptureJson(createNativeCaptureSnapshotEncoder()(value));
}
function request(session: Session, id: number): Block | undefined {
  if (session.worktreeRemoved || !Number.isSafeInteger(id)) return;
  const matches = session.blocks.filter(
    (block) => block.approval?.requestId === id && !block.approval.decided,
  );
  if (matches.length !== 1) return;
  return matches[0];
}
function routeFor(session: Session): Route {
  const binding = hostSessionBinding(session);
  const project = remoteProjectFor(session.cwd);
  const isRemote =
    !!binding || !!project || session.cwd.replace(/\\/g, "/").startsWith("remote://");
  if (isRemote) {
    const remote = captureRemoteSessionActions(session.id);
    const source = remote?.actions.approvalSource;
    const sourceValue = source?.();
    const occurrenceSupported = remote?.actions.approvalOccurrenceSupported === true;
    return {
      data: {
        kind: "host",
        binding,
        project,
        source: sourceValue ? hostData(sourceValue.snapshot) : undefined,
      },
      remote,
      remoteMethod: remote?.actions.approve,
      source,
      sourceValue,
      sourceHeader: sourceValue ? hostData(sourceValue.snapshot) : undefined,
      sourceIdentity: sourceValue ? hostIdentity(sourceValue.snapshot) : undefined,
      occurrenceSupported,
      unavailable:
        !remote ||
        typeof remote.actions.approve !== "function" ||
        (!binding && !project) ||
        (!!source && !sourceValue),
    };
  }
  const adapter = getHarness(session.harness);
  return {
    data: { kind: "native", harness: session.harness },
    adapter,
    method: adapter?.respondApproval,
    unavailable: !adapter || typeof adapter.respondApproval !== "function",
  };
}
function sameRoute(captured: Route, current: Route): boolean {
  if (captured.remote)
    return (
      captured.remote.current() &&
      current.remote?.actions === captured.remote.actions &&
      current.remoteMethod === captured.remoteMethod &&
      current.occurrenceSupported === captured.occurrenceSupported &&
      current.source === captured.source &&
      (!captured.source ||
        (!!captured.sourceHeader &&
          !!current.sourceHeader &&
          sameHostHeader(captured.sourceHeader, current.sourceHeader)))
    );
  return (
    current.adapter === captured.adapter && current.method === captured.method && !current.remote
  );
}
function hostData(snapshot: HostSession) {
  return {
    sessionId: snapshot.session.id,
    projectId: snapshot.projectId,
    runId: snapshot.runId,
    authorityGeneration: snapshot.authorityGeneration,
    revision: snapshot.revision,
  };
}
function sameHostOwner(before: HostSession, after: HostSession) {
  return sameHostHeader(hostData(before), hostData(after));
}
function sameHostHeader(before: ReturnType<typeof hostData>, after: ReturnType<typeof hostData>) {
  return (
    before.sessionId === after.sessionId &&
    before.projectId === after.projectId &&
    before.runId === after.runId &&
    before.authorityGeneration === after.authorityGeneration &&
    Number.isSafeInteger(before.revision) &&
    before.revision >= 0 &&
    Number.isSafeInteger(after.revision) &&
    after.revision >= before.revision
  );
}
function fingerprint(data: Record<string, unknown>) {
  const route = data.route as Record<string, unknown>;
  const source = route.source as Record<string, unknown> | undefined;
  // Revision advances only through the private accepted-source chain. It is retained
  // exactly in raw data, but is not itself a new request or execution owner.
  return wire(source ? { ...data, route: { ...route, source: { ...source, revision: 0 } } } : data);
}
function original(session: Session, block: Block, route: Route): Record<string, unknown> {
  return copyNativeCaptureData({
    session: {
      id: session.id,
      harness: session.harness,
      cwd: session.cwd,
      runtimeMode: session.runtimeMode,
      model: session.model,
      modelSettings: session.modelSettings,
      providerSessionId: session.providerSessionId,
      providerAccountId: session.providerAccountId,
      orchestrationLeadId: session.orchestrationLeadId,
      workspaceId: session.workspaceId,
      workspaceRevision: session.workspaceRevision,
      workspaceMode: session.workspaceMode,
      worktreeCwd: session.worktreeCwd,
      runningModelTarget: session.runningModelTarget,
      pendingSwitch: session.pendingSwitch,
    },
    request: block,
    route: route.data,
  });
}
function actualSourceData(session: Session, block: Block, route: Route) {
  // A private Host registration supplies this source. Its exact context is
  // separate from shadow/pane presentation; cwd supplies no authority.
  return original(session, block, {
    ...route,
    data: {
      kind: "host",
      binding: hostSessionBinding(session),
      project: remoteProjectFor(session.cwd),
      source: route.data.source,
    },
  });
}
function diagnostic(error: unknown): string {
  let text = "Approval callback outcome is unverified";
  try {
    if (typeof error === "string") text = error;
    else if (error && typeof error === "object") {
      const field = Object.getOwnPropertyDescriptor(error, "message");
      if (field && "value" in field && typeof field.value === "string") text = field.value;
    }
  } catch {
    /* Do not run foreign error accessors. */
  }
  let result = "",
    size = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    const safe = code >= 0xd800 && code <= 0xdfff ? "\ufffd" : character;
    const length = bytes.encode(safe).byteLength;
    if (size + length > 512) break;
    result += safe;
    size += length;
  }
  return result;
}
function newState(): State {
  return {
    version: 1,
    nextId: 0,
    records: [],
    listeners: new Set(),
    read: () => ({}),
    unavailable: false,
  };
}

/** Isolated factory for actual Parent-registry tests; no clear/evict/replay API. */
export function createApprovalIntentRegistry(
  options: {
    register?: typeof registerParentInput;
    limits?: Partial<{ records: number; bytes: number }>;
  } = {},
  retained?: State,
) {
  const state = retained ?? newState();
  const limits = { ...APPROVAL_INTENT_LIMITS, ...options.limits };
  for (const key of ["records", "bytes"] as const)
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > APPROVAL_INTENT_LIMITS[key]
    )
      throw new Error("Invalid approval intent conservation budget");
  if (state.version !== 1 || !Array.isArray(state.records) || !(state.listeners instanceof Set))
    throw new Error("Approval intent conservation is unavailable");
  const tokens = new WeakMap<ApprovalRequestToken, Captured>();
  const snapshot = (records = state.records) => ({
    version: 1,
    qualified: false,
    rosterComplete: false,
    origin: "local-native",
    surface: "approval-decisions",
    scope: "physical-profile-shared",
    providerAck: "unproved",
    observation: state.unavailable ? "unavailable" : "observed",
    records: records.map((entry) => entry.data),
  });
  state.read = () => {
    if (state.unavailable) throw new Error("Approval intent observation is unavailable");
    return snapshot();
  };
  if (!state.owner) {
    state.owner = (options.register ?? registerParentInput)({
      kind: "approval-decision",
      scope: "profile",
      // Session/lead/route are exact DATA; this actor grants no session authority.
      snapshot: () => state.read(),
      missingCoverage: [
        "approval-provider-consumption-unproved",
        "approval-request-scope-unproved",
        "approval-input-conservation-unproved",
      ],
    });
  }
  const notify = () => {
    state.owner!.changed();
    for (const listener of [...state.listeners]) {
      try {
        listener();
      } catch {
        /* UI observers cannot replace the original transport outcome. */
      }
    }
  };
  const capture = (
    session: Session,
    id: number,
    expectedBlock?: Block,
  ): ApprovalRequestToken | undefined => {
    if (!currentModule()) return;
    try {
      const block = request(session, id);
      if (!block?.approval || (expectedBlock !== undefined && expectedBlock !== block)) return;
      const route = routeFor(session);
      const data = original(session, block, route);
      const source = route.sourceValue?.session;
      if (route.source && (!source || source.id !== session.id || request(source, id) !== block))
        return;
      const sourceOriginal = source ? actualSourceData(source, block, route) : undefined;
      const exact = wire({ original: data, sourceOriginal });
      if (bytes.encode(exact).byteLength + OUTCOME_RESERVE > limits.bytes) return;
      const token = Object.freeze({
        [Symbol("approval-request")]: true,
      }) as unknown as ApprovalRequestToken;
      tokens.set(token, {
        sessionId: session.id,
        requestId: id,
        block,
        blockId: block.id,
        approval: block.approval,
        occurrenceId: block.approval.occurrenceId,
        original: data,
        fingerprint: fingerprint(data),
        sourceOriginal,
        sourceFingerprint: sourceOriginal ? fingerprint(sourceOriginal) : undefined,
        started: false,
        // Keep an opaque weak-key identity plus bounded header, not whole historical
        // Host sessions/transcripts, in the conserved intent's private lifetime.
        route: { ...route, sourceValue: undefined },
      });
      return token;
    } catch {
      return;
    }
  };
  const matches = (session: Session, id: number, captured: Captured): boolean => {
    if (
      !currentModule() ||
      session.id !== captured.sessionId ||
      request(session, id) !== captured.block ||
      captured.block.approval !== captured.approval
    )
      return false;
    if (captured.approval.occurrenceId !== captured.occurrenceId) return false;
    try {
      const route = routeFor(session);
      if (fingerprint(original(session, captured.block, route)) !== captured.fingerprint)
        return false;
      if (!sameRoute(captured.route, route)) return false;
      if (captured.route.source) {
        const actual = route.sourceValue?.session;
        if (
          !actual ||
          actual.id !== captured.sessionId ||
          request(actual, id) !== captured.block ||
          fingerprint(actualSourceData(actual, captured.block, route)) !==
            captured.sourceFingerprint
        )
          return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const read = (session: Session, id: number): ApprovalIntentView | undefined => {
    const block = request(session, id);
    if (!block?.approval) return;
    const candidates = [...state.records]
      .reverse()
      .filter((entry) => entry.sessionId === session.id && entry.requestId === id);
    try {
      const route = routeFor(session);
      const currentFingerprint = fingerprint(original(session, block, route));
      const source = route.sourceValue?.session;
      const sourceRequest = source ? request(source, id) : undefined;
      const sourceFingerprint =
        source && sourceRequest === block
          ? fingerprint(actualSourceData(source, block, route))
          : undefined;
      const current = candidates.find(
        (entry) =>
          (entry.approval === block.approval ||
            (entry.hostCursor === route.sourceIdentity &&
              entry.hostCursor !== undefined &&
              entry.blockId === block.id &&
              sameRoute(entry.route, route))) &&
          (entry.sourceFingerprint !== undefined
            ? entry.sourceFingerprint === sourceFingerprint && sameRoute(entry.route, route)
            : entry.fingerprint === currentFingerprint),
      );
      if (current) return current.view;
    } catch {
      /* A detached/unavailable source does not erase the original conserved view. */
    }
    return candidates.find((entry) => {
      if (entry.block !== block || entry.approval !== block.approval) return false;
      try {
        if (fingerprint(original(session, block, entry.route)) === entry.fingerprint) return true;
        const sourceOriginal = entry.data.sourceOriginal as Record<string, unknown> | undefined;
        return (
          entry.sourceFingerprint !== undefined &&
          sourceOriginal !== undefined &&
          fingerprint(
            original(session, block, {
              ...entry.route,
              data: sourceOriginal.route as Record<string, unknown>,
            }),
          ) === entry.sourceFingerprint
        );
      } catch {
        return false;
      }
    })?.view;
  };
  const update = (entry: Entry, patch: Partial<ApprovalIntentView>) => {
    entry.view = Object.freeze({ ...entry.view, ...patch });
    entry.data = Object.freeze({ ...entry.data, ...entry.view });
    notify();
  };
  const settled = (entry: Entry, patch: Partial<ApprovalIntentView>) => {
    entry.pending = false;
    if (entry.represented) {
      state.records = state.records.filter((current) => current !== entry);
      notify();
    } else update(entry, patch);
  };
  /** Called at the actual applied source-event boundary, never from an approval
   * callback's return. The resolved original in Session represents the decision;
   * provider consumption/durability remain unproved. Replacement/absence is not it. */
  const observeResolutions = (before: Session, after: Session, events: readonly HarnessEvent[]) => {
    if (!currentModule() || before.id !== after.id) return;
    for (const entry of [...state.records]) {
      if (entry.sessionId !== before.id || entry.represented) continue;
      if (entry.sourceFingerprint !== undefined) continue;
      const block = request(before, entry.requestId);
      if (block?.approval !== entry.approval) continue;
      const resolved = after.blocks.filter((candidate) => candidate.id === block.id);
      if (resolved.length !== 1) continue;
      const result = resolved[0];
      const decision = result.approval?.decided;
      if (
        !decision ||
        block.approval?.occurrenceId !== entry.occurrenceId ||
        result.approval?.occurrenceId !== entry.occurrenceId ||
        result.approval?.requestId !== entry.requestId ||
        !events.some(
          (event) =>
            event.type === "approval.resolved" &&
            event.requestId === entry.requestId &&
            (event.occurrenceId === undefined ||
              (isApprovalOccurrenceId(event.occurrenceId) &&
                event.occurrenceId === entry.occurrenceId)) &&
            event.decision === decision,
        )
      )
        continue;
      try {
        const beforeRoute = routeFor(before),
          afterRoute = routeFor(after);
        if (
          !sameRoute(entry.route, beforeRoute) ||
          !sameRoute(entry.route, afterRoute) ||
          fingerprint(original(before, block, beforeRoute)) !== entry.fingerprint ||
          fingerprint(original(after, { ...result, approval: block.approval }, afterRoute)) !==
            entry.fingerprint
        )
          continue;
      } catch {
        continue;
      }
      entry.represented = true;
      if (entry.pending) {
        entry.data = Object.freeze({
          ...entry.data,
          sourceResolution: {
            decision,
            representation: "resolved-original",
            providerAck: "unproved",
          },
        });
      } else state.records = state.records.filter((current) => current !== entry);
      // This is fresh external source application, not a borrowed async permit.
      notify();
    }
  };
  const observeRemoteResolutions = (shellId: string, before: HostSession, after: HostSession) => {
    if (!currentModule()) return;
    if (!sameHostOwner(before, after)) {
      for (const entry of state.records)
        if (entry.sessionId === shellId && entry.hostCursor === hostIdentity(before))
          entry.hostCursor = undefined;
      return;
    }
    for (const entry of [...state.records]) {
      if (
        entry.sessionId !== shellId ||
        entry.represented ||
        entry.hostCursor !== hostIdentity(before) ||
        !entry.route.remote?.current() ||
        entry.route.remote.actions.approve !== entry.route.remoteMethod ||
        entry.route.remote.actions.approvalSource !== entry.route.source
      )
        continue;
      const originalRequest = (entry.data.original as { request: Block }).request;
      const oldBlocks = before.session.blocks.filter((block) => block.id === entry.blockId);
      const newBlocks = after.session.blocks.filter((block) => block.id === entry.blockId);
      const old = oldBlocks[0],
        next = newBlocks[0];
      let valid =
        isApprovalOccurrenceId(entry.occurrenceId) &&
        oldBlocks.length === 1 &&
        newBlocks.length === 1 &&
        !old.remoteContent &&
        !next.remoteContent &&
        !old.approval?.decided &&
        old.approval?.requestId === entry.requestId &&
        next.approval?.requestId === entry.requestId &&
        old.approval?.occurrenceId === entry.occurrenceId &&
        next.approval?.occurrenceId === entry.occurrenceId;
      try {
        valid &&=
          wire({ request: old }) === wire({ request: originalRequest }) &&
          wire({ request: { ...next, approval: old.approval } }) ===
            wire({ request: originalRequest });
      } catch {
        valid = false;
      }
      if (!valid) {
        // An absence/replacement interrupts the exact chain; a later equal body
        // cannot revive it or acknowledge the old dispatched decision.
        entry.hostCursor = undefined;
        continue;
      }
      entry.hostCursor = hostIdentity(after);
      const decision = next.approval?.decided;
      if (!decision) continue;
      if (after.revision <= before.revision) {
        entry.hostCursor = undefined;
        continue;
      }
      entry.represented = true;
      if (entry.pending)
        entry.data = Object.freeze({
          ...entry.data,
          sourceResolution: {
            decision,
            representation: "resolved-original",
            providerAck: "unproved",
          },
        });
      else state.records = state.records.filter((current) => current !== entry);
      notify();
    }
  };
  /** A guarded same-version history/preview/full-block expansion is data-only.
   * It can carry the existing original's cursor, never resolve it or grant work. */
  const observeRemoteExpansion = (shellId: string, before: HostSession, after: HostSession) => {
    if (!currentModule()) return;
    for (const entry of state.records) {
      if (
        entry.sessionId !== shellId ||
        entry.represented ||
        entry.hostCursor !== hostIdentity(before)
      )
        continue;
      const oldBlocks = before.session.blocks.filter((block) => block.id === entry.blockId);
      const nextBlocks = after.session.blocks.filter((block) => block.id === entry.blockId);
      const originalRequest = (entry.data.original as { request: Block }).request;
      let valid =
        sameHostOwner(before, after) &&
        before.revision === after.revision &&
        !!entry.route.remote?.current() &&
        entry.route.remote.actions.approve === entry.route.remoteMethod &&
        entry.route.remote.actions.approvalSource === entry.route.source &&
        oldBlocks.length === 1 &&
        nextBlocks.length === 1;
      try {
        valid &&=
          wire({ request: oldBlocks[0] }) === wire({ request: originalRequest }) &&
          wire({ request: nextBlocks[0] }) === wire({ request: originalRequest });
      } catch {
        valid = false;
      }
      // Even a decided flip at the same revision is NOT acknowledgement. A lost
      // chain cannot be reconstructed from a later equal ID/body.
      entry.hostCursor = valid ? hostIdentity(after) : undefined;
    }
  };
  const submit = (
    session: Session | undefined,
    id: number,
    decision: ApprovalDecision,
    expected?: ApprovalRequestToken,
    currentSession: () => Session | undefined = () => session,
  ): boolean | Promise<boolean> => {
    const captured = expected && tokens.get(expected);
    const refuse = (message: string) => {
      if (captured) captured.refusal = message;
      return false;
    };
    if (
      !captured ||
      !currentModule() ||
      captured.requestId !== id ||
      (decision !== "allow" && decision !== "deny")
    )
      return refuse(APPROVAL_INTENT_MESSAGES.changed);
    captured.refusal = undefined;
    if (state.unavailable) return refuse(APPROVAL_INTENT_MESSAGES.unavailable);
    if (captured.route.remote && !captured.route.occurrenceSupported)
      return refuse(APPROVAL_INTENT_MESSAGES.occurrence);
    if (!isApprovalOccurrenceId(captured.occurrenceId))
      return refuse(APPROVAL_INTENT_MESSAGES.changed);
    if (!state.owner!.recorded) return refuse(APPROVAL_INTENT_MESSAGES.capacity);
    // Unknown dispatch is never repeated, even if a later view reuses the numeric ID.
    if (
      state.records.some(
        (entry) =>
          entry.sessionId === captured.sessionId &&
          entry.requestId === id &&
          entry.view.repeatBlocked,
      )
    )
      return refuse(APPROVAL_INTENT_MESSAGES.unconfirmed);
    if (state.records.length >= limits.records || state.nextId >= Number.MAX_SAFE_INTEGER)
      return refuse(APPROVAL_INTENT_MESSAGES.capacity);
    const view: ApprovalIntentView = Object.freeze({
      id: state.nextId + 1,
      decision,
      phase: "pending",
      callback: "not-started",
      providerAck: "unproved",
      repeatBlocked: false,
      error: null,
    });
    const entry: Entry = {
      block: captured.block,
      sessionId: captured.sessionId,
      requestId: id,
      approval: captured.approval,
      occurrenceId: captured.occurrenceId,
      fingerprint: captured.fingerprint,
      sourceFingerprint: captured.sourceFingerprint,
      view,
      data: Object.freeze({
        ...view,
        original: captured.original,
        ...(captured.sourceOriginal ? { sourceOriginal: captured.sourceOriginal } : {}),
      }),
      pending: true,
      represented: false,
      route: captured.route,
      hostCursor: captured.route.sourceIdentity,
      blockId: captured.blockId,
    };
    try {
      const aggregate = bytes.encode(wire(snapshot([...state.records, entry]))).byteLength;
      if (aggregate > limits.bytes - (state.records.length + 1) * OUTCOME_RESERVE)
        return refuse(APPROVAL_INTENT_MESSAGES.capacity);
    } catch {
      return refuse(APPROVAL_INTENT_MESSAGES.capacity);
    }
    const work = state.owner!.admit();
    if (!work) return refuse(APPROVAL_INTENT_MESSAGES.closed);
    let returned: unknown;
    try {
      work.apply(() => {
        state.nextId++;
        state.records.push(entry);
        notify();
        let current: Session | undefined;
        try {
          current = currentSession();
        } catch {
          /* Changed/unavailable source is refused. */
        }
        if (!current || !matches(current, id, captured)) {
          captured.refusal = APPROVAL_INTENT_MESSAGES.changed;
          update(entry, { phase: "rejected", error: APPROVAL_INTENT_MESSAGES.changed });
          return;
        }
        if (captured.route.unavailable) {
          captured.refusal = APPROVAL_INTENT_MESSAGES.unavailable;
          update(entry, { phase: "rejected", error: APPROVAL_INTENT_MESSAGES.unavailable });
          return;
        }
        // Mark BEFORE callback entry: a synchronous throw can still follow an effect.
        update(entry, { callback: "pending", repeatBlocked: true });
        try {
          current = currentSession();
        } catch {
          current = undefined;
        }
        if (!current || !matches(current, id, captured)) {
          captured.refusal = APPROVAL_INTENT_MESSAGES.changed;
          update(entry, {
            phase: "rejected",
            callback: "not-started",
            repeatBlocked: false,
            error: APPROVAL_INTENT_MESSAGES.changed,
          });
          return;
        }
        captured.started = true;
        if (captured.route.remote) {
          returned = Reflect.apply(captured.route.remoteMethod!, captured.route.remote.actions, [
            id,
            decision,
            captured.occurrenceId,
          ]);
        } else {
          // This production wrapper deliberately returns void; no adapter thenable ACK.
          respondHarnessApproval(current.harness, current.id, id, decision, captured.occurrenceId);
        }
      });
    } catch (error) {
      finishOutcome(work, entry, "threw", error);
      return false;
    }
    if (!entry.view.repeatBlocked) {
      entry.pending = false;
      work.finish();
      return false;
    }
    let then: unknown;
    try {
      if (returned && (typeof returned === "object" || typeof returned === "function"))
        then = (returned as { then?: unknown }).then;
    } catch (error) {
      finishOutcome(work, entry, "threw", error);
      return false;
    }
    if (typeof then !== "function") {
      finishOutcome(work, entry, "void");
      return false;
    }
    // Observe the actual returned thenable once. The admitted job outlives its waiter/UI.
    const actual = new Promise<unknown>((resolve, reject) => {
      Reflect.apply(then as (...args: unknown[]) => unknown, returned, [resolve, reject]);
    });
    return work.run(async () => {
      let patch: Partial<ApprovalIntentView>;
      try {
        await actual;
        patch = { phase: "unconfirmed", callback: "fulfilled" };
      } catch (error) {
        patch = { phase: "uncertain", callback: "rejected", error: diagnostic(error) };
      }
      try {
        work.apply(() => settled(entry, patch));
      } catch {
        state.unavailable = true;
      }
      return false;
    });
  };
  function finishOutcome(
    work: ParentAdmission,
    entry: Entry,
    outcome: "void" | "threw",
    error?: unknown,
  ) {
    try {
      work.apply(() =>
        settled(entry, {
          phase: outcome === "void" ? "unconfirmed" : "uncertain",
          callback: outcome,
          repeatBlocked: true,
          error: outcome === "void" ? null : diagnostic(error),
        }),
      );
    } catch {
      state.unavailable = true;
    } finally {
      work.finish();
    }
  }
  return {
    captureApprovalRequest: capture,
    readApprovalIntent: read,
    // The same conservative repeat guard used by submit. This is not a decision
    // view joined to a replacement request or an execution context.
    isApprovalRequestBlocked: (sessionId: string, id: number) =>
      state.records.some(
        (entry) =>
          entry.sessionId === sessionId && entry.requestId === id && entry.view.repeatBlocked,
      ),
    submitApprovalIntent: submit,
    observeApprovalResolutions: observeResolutions,
    observeRemoteApprovalResolutions: observeRemoteResolutions,
    observeRemoteApprovalSourceExpansion: observeRemoteExpansion,
    readApprovalRefusal: (token: ApprovalRequestToken | undefined) =>
      token ? tokens.get(token)?.refusal : APPROVAL_INTENT_MESSAGES.changed,
    // Observation of this actual original callback entry, not a permit or ACK.
    approvalRequestDispatchStarted: (token: ApprovalRequestToken | undefined) =>
      !!token && tokens.get(token)?.started === true,
    subscribe: (listener: () => void) => {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },
  };
}

const existing = globals[KEEPER] as State | undefined;
const retained = existing ?? newState();
if (existing === undefined) globals[KEEPER] = retained;
const registry = createApprovalIntentRegistry({}, retained);
export const captureApprovalRequest = registry.captureApprovalRequest;
export const readApprovalIntent = registry.readApprovalIntent;
export const isApprovalRequestBlocked = registry.isApprovalRequestBlocked;
export const submitApprovalIntent = registry.submitApprovalIntent;
export const observeApprovalResolutions = registry.observeApprovalResolutions;
export const observeRemoteApprovalResolutions = registry.observeRemoteApprovalResolutions;
export const observeRemoteApprovalSourceExpansion = registry.observeRemoteApprovalSourceExpansion;
export const readApprovalRefusal = registry.readApprovalRefusal;
export const approvalRequestDispatchStarted = registry.approvalRequestDispatchStarted;
export function useApprovalIntent(session: Session, requestId: number) {
  return useSyncExternalStore(
    registry.subscribe,
    () => readApprovalIntent(session, requestId),
    () => readApprovalIntent(session, requestId),
  );
}
export function useApprovalRequestBlocked(sessionId: string, requestId: number) {
  return useSyncExternalStore(
    registry.subscribe,
    () => isApprovalRequestBlocked(sessionId, requestId),
    () => isApprovalRequestBlocked(sessionId, requestId),
  );
}
