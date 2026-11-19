import { join } from "node:path";
import { z } from "zod";
import {
  LiveStreamLiveStatusSchema,
  liveStreamOrientation,
  type LiveStreamLiveAccount,
  type LiveStreamLiveDestination,
  type LiveStreamLiveStartParams,
  type LiveStreamLiveStatus,
} from "../../src/shared/model/host-contracts/live-stream";
import {
  SocialLiveBroadcastSchema,
  SocialLiveError,
  type SocialLiveBroadcast,
  type SocialLiveService,
} from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import {
  LiveStreamObsActionError,
  type LiveStreamObs,
  type SocialCanvases,
  type SocialOutput,
  type SocialPlan,
} from "./obs";
import {
  LiveStreamRelayError,
  processRelays,
  type LiveStreamRelay,
  type LiveStreamRelays,
} from "./relay";

type Authority = () => Promise<boolean>;
type Reason = NonNullable<LiveStreamLiveStatus["reason"]>;
type Canvas = keyof SocialCanvases;
export type ApprovedLiveTarget = LiveStreamLiveAccount & { binding: SocialLiveBroadcast };
const OWNER: SocialPrincipal = { kind: "owner", actorId: "desktop", provider: "owner" };
const journalSchema = z.strictObject({
  status: LiveStreamLiveStatusSchema,
  managedDestination: z.boolean(),
  canvases: z.strictObject({ horizontal: z.boolean(), vertical: z.boolean() }),
  obsStarting: z.boolean(),
  /** Accounts whose provider create may have succeeded without a receipt. */
  pending: z.array(z.string()),
  /** Provider broadcasts to end on stop, by account ID. */
  broadcasts: z.record(z.string(), SocialLiveBroadcastSchema),
});
type Journal = z.infer<typeof journalSchema>;
const idle: LiveStreamLiveStatus = { state: "idle", canStop: false, destinations: [] };
const CANVASES: readonly Canvas[] = ["horizontal", "vertical"];

class BroadcastInterrupted extends Error {}
class BroadcastUnauthorized extends Error {}

function failure(error: unknown, phase: "obs" | "platform"): Reason {
  if (error instanceof BroadcastInterrupted) return "CANCELED";
  if (error instanceof BroadcastUnauthorized) return "AUTHORITY_DENIED";
  if (error instanceof LiveStreamRelayError) return "RELAY_UNAVAILABLE";
  if (error instanceof SocialLiveError) {
    switch (error.code) {
      case "LIVE_ACCOUNT_UNAVAILABLE":
        return "ACCOUNT_UNAVAILABLE";
      case "LIVE_AUTONOMY_DENIED":
      case "LIVE_SOCIAL_STOPPED":
        return "AUTHORITY_DENIED";
      case "LIVE_MISSING_CREDENTIALS":
        return "LIVE_CREDENTIALS_MISSING";
      case "LIVE_OWNER_REQUIRED":
        return "OWNER_STEP_REQUIRED";
      case "LIVE_PLATFORM_UNCERTAIN":
        return "START_UNCERTAIN";
      case "LIVE_PLATFORM_REJECTED":
        return "PLATFORM_FAILED";
    }
  }
  if (error instanceof LiveStreamObsActionError) {
    switch (error.message) {
      case "OBS_NOT_CONFIGURED":
      case "OBS_ALREADY_STREAMING":
      case "SCENE_NOT_FOUND":
      case "VERTICAL_CANVAS_UNAVAILABLE":
        return error.message;
    }
  }
  return phase === "obs" ? "OBS_UNAVAILABLE" : "PLATFORM_FAILED";
}

const canvasesOf = (destinations: readonly LiveStreamLiveDestination[]): SocialCanvases => ({
  horizontal: destinations.some((entry) => entry.orientation === "horizontal"),
  vertical: destinations.some((entry) => entry.orientation === "vertical"),
});

/** Host-wide lifecycle, serialized with every other OBS mutation by LiveStreamService. */
export class LiveStreamSocialBroadcast {
  private readonly file: string;
  private initialized?: Promise<void>;
  private starting?: { controller: AbortController; accountIds: string[] };
  /** ffmpeg relays of this Host run only; a restart ends them and the journal turns uncertain. */
  private readonly relays = new Map<Canvas, LiveStreamRelay>();
  private journal: Journal = {
    status: idle,
    managedDestination: false,
    canvases: { horizontal: false, vertical: false },
    obsStarting: false,
    pending: [],
    broadcasts: {},
  };

  constructor(
    directory: string,
    private readonly obs: Pick<
      LiveStreamObs,
      | "socialPreflight"
      | "startSocial"
      | "socialStreamStatus"
      | "stopSocial"
      | "restoreDestination"
      | "clearVertical"
    >,
    private readonly social?: () => SocialLiveService,
    private readonly relayFactory: LiveStreamRelays = processRelays,
  ) {
    this.file = join(directory, "live-broadcast.json");
  }

  private api() {
    if (!this.social) throw new SocialLiveError("LIVE_ACCOUNT_UNAVAILABLE");
    return this.social();
  }

  private ready() {
    this.initialized ??= this.load();
    return this.initialized;
  }

  private async load() {
    const saved = await readStateFile(this.file, (raw) => journalSchema.parse(JSON.parse(raw)), {
      quarantine: false,
    });
    if (saved.status === "corrupt")
      throw new Error("Live broadcast state is damaged. Restore it before changing OBS streams.");
    if (!saved.value) return;
    this.journal = saved.value;
    const { status, broadcasts, pending, obsStarting } = this.journal;
    if (status.state === "starting" || status.state === "stopping") {
      const canStop = Boolean(Object.keys(broadcasts).length || pending.length || obsStarting);
      this.journal.status = {
        ...status,
        state: canStop ? "uncertain" : "failed",
        canStop,
        reason: status.state === "starting" ? "START_UNCERTAIN" : "STOP_UNCERTAIN",
      };
    }
  }

  private async update(patch: Partial<Journal>) {
    const next = { ...this.journal, ...patch };
    await writeFileAtomic(this.file, JSON.stringify(next));
    this.journal = next;
  }

  private async access(
    principal: SocialPrincipal,
    accountIds: readonly string[],
    permission: "read" | "publish",
  ) {
    if (principal.kind === "owner") return;
    for (const accountId of accountIds)
      await this.api().assertAccess(principal, accountId, permission);
  }

  async accounts(principal = OWNER) {
    return { accounts: this.social ? await this.api().listAccounts(principal) : [] };
  }

  account(accountId: string, principal = OWNER) {
    return this.api().getAccount(principal, accountId);
  }

  async approvalTarget(accountId: string, principal = OWNER): Promise<ApprovedLiveTarget> {
    const binding = await this.api().getAccountBinding(principal, accountId);
    const account = await this.account(accountId, principal);
    return { ...account, binding };
  }

  /** Every requested account as the owner will approve it, in request order. */
  async approvalTargets(accountIds: readonly string[], principal = OWNER) {
    const targets: ApprovedLiveTarget[] = [];
    for (const accountId of accountIds)
      targets.push(await this.approvalTarget(accountId, principal));
    return targets;
  }

  /** Marks destinations the relay lost; the journal never records these, they are observed live. */
  private withRelayState(destinations: LiveStreamLiveDestination[]) {
    const lost = new Map<string, string>();
    for (const relay of this.relays.values())
      for (const { accountId, detail } of relay.failures()) lost.set(accountId, detail);
    return destinations.map((entry) => {
      const detail = lost.get(entry.accountId);
      return detail === undefined || entry.state === "ended"
        ? entry
        : { ...entry, state: "failed" as const, reason: "RELAY_FAILED" as const, detail };
    });
  }

  async status(principal = OWNER): Promise<LiveStreamLiveStatus> {
    await this.ready();
    const { status } = this.journal;
    const visibleStatus =
      principal.kind === "owner" && this.journal.managedDestination
        ? { ...status, managedDestination: true }
        : status;
    const accountIds = status.destinations.map((entry) => entry.accountId);
    try {
      await this.access(principal, accountIds, "read");
    } catch {
      return idle;
    }
    if (!status.canStop || status.state === "starting" || status.state === "stopping")
      return visibleStatus;
    const wanted = this.journal.canvases;
    const observed = await this.obs.socialStreamStatus(wanted).catch(() => undefined);
    if (this.journal.status !== status) return this.status(principal);
    try {
      await this.access(principal, accountIds, "read");
    } catch {
      return idle;
    }
    if (this.journal.status !== status) return this.status(principal);
    const obsStreaming = observed
      ? CANVASES.every((canvas) => !wanted[canvas] || observed[canvas] === true)
      : undefined;
    if (status.state !== "streaming") return { ...visibleStatus, obsStreaming };
    if (obsStreaming !== true)
      return {
        ...visibleStatus,
        state: "uncertain",
        reason: obsStreaming === false ? "STOP_UNCERTAIN" : "OBS_UNAVAILABLE",
        obsStreaming,
      };
    const destinations = this.withRelayState(status.destinations);
    if (destinations.every((entry) => entry.state === "failed"))
      return {
        ...visibleStatus,
        state: "uncertain",
        reason: "RELAY_FAILED",
        destinations,
        obsStreaming,
      };
    return { ...visibleStatus, destinations, obsStreaming };
  }

  private async stopRelays() {
    const running = [...this.relays.values()];
    this.relays.clear();
    await Promise.all(running.map((relay) => relay.stop().catch(() => {})));
  }

  /** Ends this Host's ffmpeg relays; OBS and the platforms are left to Stop. */
  close() {
    return this.stopRelays();
  }

  /** Puts the owner's previous OBS settings back once no managed stream uses them. */
  private async restoreDestination() {
    if (!this.journal.managedDestination) return;
    const mainRestored = await this.obs.restoreDestination();
    const verticalCleared = this.journal.canvases.vertical ? await this.obs.clearVertical() : true;
    if (mainRestored && verticalCleared) await this.update({ managedDestination: false });
  }

  async assertManual(action: "start" | "stop" | "credentials" | "setup") {
    await this.ready();
    if (this.journal.status.canStop || (action === "start" && this.journal.managedDestination))
      throw new Error("Use the Social stream controls or set a manual OBS destination first.");
  }

  async manualDestinationSaved() {
    if (this.journal.managedDestination) await this.update({ managedDestination: false });
  }

  async cancel(principal = OWNER, authorize?: Authority) {
    await this.ready();
    const starting = this.starting;
    if (!starting) return;
    await this.access(principal, starting.accountIds, "publish");
    if (authorize && !(await authorize())) throw new BroadcastUnauthorized();
    starting.controller.abort();
  }

  /** Ends every provider broadcast made so far; those it cannot end stay recorded for Stop. */
  private async rollback(principal: SocialPrincipal, guard: () => Promise<void>) {
    for (const [accountId, broadcast] of Object.entries(this.journal.broadcasts)) {
      try {
        await this.api().end(principal, broadcast, guard);
      } catch {
        continue;
      }
      const { [accountId]: _ended, ...rest } = this.journal.broadcasts;
      await this.update({ broadcasts: rest }).catch(() => {});
    }
  }

  async start(
    { accountIds, scene }: LiveStreamLiveStartParams & { scene: string },
    principal = OWNER,
    authorize: Authority,
    approved?: readonly ApprovedLiveTarget[],
  ): Promise<LiveStreamLiveStatus> {
    await this.ready();
    if (this.journal.status.canStop) {
      await this.access(
        principal,
        this.journal.status.destinations.map((entry) => entry.accountId),
        "read",
      );
      return this.status(principal);
    }
    const controller = new AbortController();
    this.starting = { controller, accountIds };
    let destinations: LiveStreamLiveDestination[] = [];
    let status: LiveStreamLiveStatus = { state: "starting", scene, canStop: false, destinations };
    let phase: "obs" | "platform" = "platform";
    let startDispatched = false;
    let current: string | undefined;
    const bindings = new Map(approved?.map((entry) => [entry.accountId, entry.binding]));
    let interruption: "CANCELED" | "AUTHORITY_DENIED" | undefined;
    let policyError: SocialLiveError | undefined;
    const checkCancellation = () => {
      if (!controller.signal.aborted) return;
      interruption = "CANCELED";
      throw new BroadcastInterrupted();
    };
    const check = async () => {
      checkCancellation();
      if (!(await authorize().catch(() => false))) {
        interruption = "AUTHORITY_DENIED";
        throw new BroadcastUnauthorized();
      }
      checkCancellation();
    };
    const recheck = async (accountId: string) => {
      await check();
      try {
        await this.api().assertStart(
          principal,
          accountId,
          this.journal.broadcasts[accountId] ?? bindings.get(accountId),
        );
      } catch (error) {
        if (error instanceof SocialLiveError) policyError = error;
        throw error;
      }
      await check();
    };
    const recheckAll = async () => {
      for (const entry of destinations) await recheck(entry.accountId);
    };
    try {
      await check();
      const targets = await this.approvalTargets(accountIds, principal);
      for (const target of targets)
        if (!bindings.has(target.accountId)) bindings.set(target.accountId, target.binding);
      if (
        principal.kind !== "owner" &&
        (approved?.length !== targets.length ||
          targets.some((target) => {
            const match = approved.find((entry) => entry.accountId === target.accountId);
            return !match || match.platform !== target.platform || match.label !== target.label;
          }))
      )
        throw new BroadcastUnauthorized();
      destinations = targets.map(({ accountId, platform, label }) => ({
        accountId,
        platform,
        label,
        orientation: liveStreamOrientation(platform),
        state: "starting",
      }));
      const canvases = canvasesOf(destinations);
      status = { ...status, destinations };
      await this.update({ status, canvases, broadcasts: {}, pending: [], obsStarting: false });
      phase = "obs";
      await this.obs.socialPreflight(scene, canvases);
      const needsRelay = CANVASES.some(
        (canvas) => destinations.filter((entry) => entry.orientation === canvas).length > 1,
      );
      if (needsRelay && !(await this.relayFactory.available()))
        throw new LiveStreamRelayError("ffmpeg was not found on PATH.");
      phase = "platform";
      await recheckAll();
      const ingests = new Map<string, SocialOutput>();
      for (const { accountId } of destinations) {
        current = accountId;
        await recheck(accountId);
        const ingest = await this.api().prepare(
          principal,
          accountId,
          scene,
          async () => {
            await recheck(accountId);
            if (!this.journal.pending.includes(accountId))
              await this.update({ pending: [...this.journal.pending, accountId] });
            await check();
          },
          bindings.get(accountId),
        );
        await this.update({
          broadcasts: { ...this.journal.broadcasts, [accountId]: ingest.broadcast },
          pending: this.journal.pending.filter((id) => id !== accountId),
        });
        ingests.set(accountId, { server: ingest.server, key: ingest.key });
        current = undefined;
      }
      phase = "obs";
      const plan: SocialPlan = { scene };
      for (const canvas of CANVASES) {
        const group = destinations.filter((entry) => entry.orientation === canvas);
        if (!group.length) continue;
        const outputs = group.map(({ accountId }) => ({
          accountId,
          ...ingests.get(accountId)!,
        }));
        if (outputs.length === 1) {
          const { server, key } = outputs[0]!;
          plan[canvas] = { server, key };
          continue;
        }
        const relay = await this.relayFactory.start(outputs);
        this.relays.set(canvas, relay);
        plan[canvas] = { server: relay.server, key: relay.key };
      }
      const active = await this.obs.startSocial(
        plan,
        async () => {
          await recheckAll();
          await this.update({ managedDestination: true });
          await check();
        },
        async () => {
          await recheckAll();
          await this.update({ obsStarting: true });
          await check();
          startDispatched = true;
        },
      );
      if (!CANVASES.every((canvas) => !canvases[canvas] || active[canvas]))
        throw new Error("OBS start was not confirmed.");
      phase = "platform";
      let ownerStep = false;
      let firstError: unknown;
      const results: LiveStreamLiveDestination[] = [];
      for (const entry of destinations) {
        const broadcast = this.journal.broadcasts[entry.accountId]!;
        try {
          const result = await this.api().start(principal, broadcast, () =>
            recheck(entry.accountId),
          );
          ownerStep ||= result === "owner_required";
          results.push({
            ...entry,
            state: "streaming",
            ...(result === "owner_required" ? { reason: "OWNER_STEP_REQUIRED" as const } : {}),
          });
        } catch (error) {
          if (error instanceof BroadcastInterrupted || error instanceof BroadcastUnauthorized)
            throw error;
          firstError ??= error;
          if (error instanceof SocialLiveError && error.broadcast?.broadcastId)
            await this.update({
              broadcasts: { ...this.journal.broadcasts, [entry.accountId]: error.broadcast },
            });
          results.push({
            ...entry,
            state: "failed",
            reason: failure(policyError ?? error, "platform"),
          });
        }
      }
      if (results.every((entry) => entry.state === "failed")) throw firstError;
      destinations = results;
      status = {
        ...status,
        state: ownerStep ? "owner_step" : "streaming",
        canStop: true,
        obsStreaming: true,
        destinations,
        ...(ownerStep ? { reason: "OWNER_STEP_REQUIRED" as const } : {}),
      };
      await this.update({ status });
    } catch (error) {
      const observedReason = failure(policyError ?? error, phase);
      const reason = interruption ?? observedReason;
      const known = { ...this.journal.broadcasts };
      const pending = new Set(this.journal.pending);
      if (current && error instanceof SocialLiveError && error.broadcast?.broadcastId)
        known[current] = error.broadcast;
      if (current && !known[current]?.broadcastId) {
        if (
          observedReason === "START_UNCERTAIN" ||
          (pending.has(current) && !(error instanceof SocialLiveError))
        )
          pending.add(current);
        else pending.delete(current);
      }
      await this.update({ broadcasts: known, pending: [...pending] }).catch(() => {});
      // OBS never started for this attempt: undo what exists. Otherwise Stop owns the cleanup.
      if (!startDispatched) {
        await this.rollback(principal, check).catch(() => {});
        await this.stopRelays();
        await this.restoreDestination().catch(() => {});
      }
      const surviving = this.journal.broadcasts;
      const stillPending = new Set(this.journal.pending);
      const canStop = Boolean(
        startDispatched || Object.keys(surviving).length || stillPending.size,
      );
      const finalReason =
        startDispatched && reason === "OBS_UNAVAILABLE" ? "START_UNCERTAIN" : reason;
      status = {
        ...status,
        state:
          startDispatched || stillPending.size || reason === "START_UNCERTAIN"
            ? "uncertain"
            : reason === "OWNER_STEP_REQUIRED"
              ? "owner_step"
              : "failed",
        canStop,
        reason: finalReason,
        destinations: destinations.map((entry) => {
          const alive =
            startDispatched || entry.accountId in surviving || stillPending.has(entry.accountId);
          if (entry.accountId === current || alive || !current)
            return { ...entry, state: "failed" as const, reason: finalReason };
          return { ...entry, state: "ended" as const };
        }),
      };
      await this.update({ status });
    } finally {
      this.starting = undefined;
    }
    return status;
  }

  async stop(
    principal = OWNER,
    authorize?: Authority,
    platformEnded = false,
  ): Promise<LiveStreamLiveStatus> {
    await this.ready();
    const { status, pending } = this.journal;
    if (!status.canStop) return this.status(principal);
    const accountIds = status.destinations.map((entry) => entry.accountId);
    const check = async () => {
      if (authorize && !(await authorize())) throw new BroadcastUnauthorized();
      await this.access(principal, accountIds, "publish");
    };
    await check();
    if (platformEnded) {
      if (
        principal.kind !== "owner" ||
        !status.needsPlatformConfirmation ||
        this.journal.obsStarting
      )
        throw new BroadcastUnauthorized();
      const next = { ...idle, obsStreaming: status.obsStreaming };
      await this.update({ status: next, broadcasts: {}, pending: [] });
      await this.stopRelays();
      return next;
    }
    await this.update({ status: { ...status, state: "stopping", reason: undefined } });
    let obsStreaming: boolean | undefined;
    try {
      if (this.journal.obsStarting) {
        if (!(await this.obs.stopSocial(this.journal.canvases, check)))
          throw new Error("OBS stop was not confirmed.");
        obsStreaming = false;
        await this.update({ obsStarting: false });
      }
      await this.stopRelays();
      await this.restoreDestination();
      let ownerStep = false;
      const ended = new Set<string>();
      for (const [accountId, broadcast] of Object.entries(this.journal.broadcasts)) {
        await check();
        const result = await this.api().end(principal, broadcast, check);
        ownerStep ||= result === "owner_required";
        ended.add(accountId);
        const { [accountId]: _done, ...rest } = this.journal.broadcasts;
        await this.update({ broadcasts: rest });
      }
      const destinations = status.destinations.map((entry) =>
        ended.has(entry.accountId) ? { ...entry, state: "ended" as const } : entry,
      );
      if (pending.length) {
        const next = {
          ...status,
          state: "uncertain",
          obsStreaming,
          reason: "STOP_UNCERTAIN",
          needsPlatformConfirmation: true,
          destinations,
        } as const;
        await this.update({ status: next });
        return next;
      }
      const next = ownerStep
        ? ({
            ...status,
            state: "owner_step",
            canStop: false,
            reason: "OWNER_STEP_REQUIRED",
            obsStreaming,
            destinations,
          } as const)
        : { ...idle, obsStreaming };
      await this.update({ status: next });
      return next;
    } catch (error) {
      const reason = this.journal.obsStarting ? "STOP_UNCERTAIN" : failure(error, "platform");
      const next = {
        ...status,
        state: "uncertain",
        reason: reason === "START_UNCERTAIN" ? "STOP_UNCERTAIN" : reason,
        obsStreaming,
        needsPlatformConfirmation: !this.journal.obsStarting,
      } as const;
      await this.update({ status: next });
      return next;
    }
  }
}
