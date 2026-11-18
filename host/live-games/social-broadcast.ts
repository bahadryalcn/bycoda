import { join } from "node:path";
import { z } from "zod";
import {
  LIVE_GAMES_DEFAULT_SCENE,
  LiveGamesLiveStatusSchema,
  type LiveGamesLiveAccount,
  type LiveGamesLiveStartParams,
  type LiveGamesLiveStatus,
} from "../../src/shared/model/host-contracts/live-games";
import {
  SocialLiveBroadcastSchema,
  SocialLiveError,
  type SocialLiveBroadcast,
  type SocialLiveService,
} from "../social/core/social-live";
import type { SocialPrincipal } from "../social/social";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import { LiveGamesObsActionError, type LiveGamesObs } from "./obs";

type Authority = () => Promise<boolean>;
type Reason = NonNullable<LiveGamesLiveStatus["reason"]>;
export type ApprovedLiveTarget = LiveGamesLiveAccount & { binding: SocialLiveBroadcast };
const OWNER: SocialPrincipal = { kind: "owner", actorId: "desktop", provider: "owner" };
const journalSchema = z.strictObject({
  status: LiveGamesLiveStatusSchema,
  managedDestination: z.boolean(),
  obsStarting: z.boolean(),
  providerPending: z.boolean(),
  broadcast: SocialLiveBroadcastSchema.optional(),
});
type Journal = z.infer<typeof journalSchema>;
const idle: LiveGamesLiveStatus = { state: "idle", canStop: false };

class BroadcastInterrupted extends Error {}
class BroadcastUnauthorized extends Error {}

function failure(error: unknown, phase: "obs" | "platform"): Reason {
  if (error instanceof BroadcastInterrupted) return "CANCELED";
  if (error instanceof BroadcastUnauthorized) return "AUTHORITY_DENIED";
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
  if (error instanceof LiveGamesObsActionError) {
    switch (error.message) {
      case "OBS_NOT_CONFIGURED":
      case "OBS_ALREADY_STREAMING":
      case "SCENE_NOT_FOUND":
        return error.message;
    }
  }
  return phase === "obs" ? "OBS_UNAVAILABLE" : "PLATFORM_FAILED";
}

/** Host-wide lifecycle, serialized with every other OBS mutation by LiveGamesService. */
export class LiveGamesSocialBroadcast {
  private readonly file: string;
  private initialized?: Promise<void>;
  private starting?: { controller: AbortController; accountId: string };
  private journal: Journal = {
    status: idle,
    managedDestination: false,
    obsStarting: false,
    providerPending: false,
  };

  constructor(
    directory: string,
    private readonly obs: Pick<
      LiveGamesObs,
      "socialPreflight" | "startSocial" | "socialStreamStatus" | "stopSocial"
    >,
    private readonly social?: () => SocialLiveService,
  ) {
    this.file = join(directory, "social-broadcast.json");
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
    const { status, broadcast, providerPending, obsStarting } = this.journal;
    if (status.state === "starting" || status.state === "stopping") {
      const canStop = Boolean(broadcast?.broadcastId || providerPending || obsStarting);
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
    accountId: string | undefined,
    permission: "read" | "publish",
  ) {
    if (principal.kind !== "owner" && accountId)
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

  async status(principal = OWNER): Promise<LiveGamesLiveStatus> {
    await this.ready();
    const { status } = this.journal;
    const visibleStatus =
      principal.kind === "owner" && this.journal.managedDestination
        ? { ...status, managedDestination: true }
        : status;
    try {
      await this.access(principal, status.accountId, "read");
    } catch {
      return idle;
    }
    if (!status.canStop || status.state === "starting" || status.state === "stopping")
      return visibleStatus;
    const obsStreaming = await this.obs.socialStreamStatus().catch(() => undefined);
    if (this.journal.status !== status) return this.status(principal);
    try {
      await this.access(principal, status.accountId, "read");
    } catch {
      return idle;
    }
    if (this.journal.status !== status) return this.status(principal);
    if (status.state === "streaming" && obsStreaming !== true)
      return {
        ...visibleStatus,
        state: "uncertain",
        reason: obsStreaming === false ? "STOP_UNCERTAIN" : "OBS_UNAVAILABLE",
        obsStreaming,
      };
    return { ...visibleStatus, obsStreaming };
  }

  async assertManual(action: "start" | "stop" | "credentials" | "setup" | "scene") {
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
    await this.access(principal, starting.accountId, "publish");
    if (authorize && !(await authorize())) throw new BroadcastUnauthorized();
    starting.controller.abort();
  }

  async start(
    { accountId, scene = LIVE_GAMES_DEFAULT_SCENE }: LiveGamesLiveStartParams,
    principal = OWNER,
    authorize: Authority,
    approvedAccount?: ApprovedLiveTarget,
  ): Promise<LiveGamesLiveStatus> {
    await this.ready();
    if (this.journal.status.canStop) {
      await this.access(principal, this.journal.status.accountId, "read");
      return this.status(principal);
    }
    const controller = new AbortController();
    this.starting = { controller, accountId };
    let status: LiveGamesLiveStatus = { state: "starting", accountId, scene, canStop: false };
    let phase: "obs" | "platform" = "platform";
    let startDispatched = false;
    let expectedBinding = approvedAccount?.binding;
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
    const recheck = async () => {
      await check();
      try {
        await this.api().assertStart(
          principal,
          accountId,
          this.journal.broadcast ?? expectedBinding,
        );
      } catch (error) {
        if (error instanceof SocialLiveError) policyError = error;
        throw error;
      }
      await check();
    };
    try {
      await check();
      const account = await this.approvalTarget(accountId, principal);
      expectedBinding ??= account.binding;
      if (
        principal.kind !== "owner" &&
        (!approvedAccount ||
          account.accountId !== approvedAccount.accountId ||
          account.platform !== approvedAccount.platform ||
          account.label !== approvedAccount.label)
      )
        throw new BroadcastUnauthorized();
      status = { ...status, platform: account.platform };
      await this.update({
        status,
        broadcast: undefined,
        providerPending: false,
        obsStarting: false,
      });
      phase = "obs";
      await this.obs.socialPreflight(scene);
      phase = "platform";
      await recheck();
      const ingest = await this.api().prepare(
        principal,
        accountId,
        scene,
        async () => {
          await recheck();
          if (!this.journal.providerPending) await this.update({ providerPending: true });
          await check();
        },
        expectedBinding,
      );
      await this.update({ broadcast: ingest.broadcast, providerPending: false });
      phase = "obs";
      const streaming = await this.obs.startSocial(
        ingest.server,
        ingest.key,
        scene,
        async () => {
          await recheck();
          await this.update({ managedDestination: true });
          await check();
        },
        async () => {
          await recheck();
          await this.update({ obsStarting: true });
          await check();
          startDispatched = true;
        },
      );
      if (!streaming) throw new Error("OBS start was not confirmed.");
      phase = "platform";
      const result = await this.api().start(principal, ingest.broadcast, recheck);
      status = {
        ...status,
        state: result === "owner_required" ? "owner_step" : "streaming",
        canStop: true,
        obsStreaming: true,
        ...(result === "owner_required" ? { reason: "OWNER_STEP_REQUIRED" } : {}),
      };
      await this.update({ status });
    } catch (error) {
      const observedReason = failure(policyError ?? error, phase);
      const reason = interruption ?? observedReason;
      const broadcast =
        error instanceof SocialLiveError
          ? (error.broadcast ?? this.journal.broadcast)
          : this.journal.broadcast;
      const providerPending =
        !broadcast?.broadcastId &&
        (observedReason === "START_UNCERTAIN" ||
          (this.journal.providerPending && !(error instanceof SocialLiveError)));
      const canStop = Boolean(startDispatched || broadcast?.broadcastId || providerPending);
      status = {
        ...status,
        state:
          startDispatched || providerPending || reason === "START_UNCERTAIN"
            ? "uncertain"
            : reason === "OWNER_STEP_REQUIRED"
              ? "owner_step"
              : "failed",
        canStop,
        reason: startDispatched && reason === "OBS_UNAVAILABLE" ? "START_UNCERTAIN" : reason,
      };
      await this.update({ status, broadcast: canStop ? broadcast : undefined, providerPending });
    } finally {
      this.starting = undefined;
    }
    return status;
  }

  async stop(
    principal = OWNER,
    authorize?: Authority,
    platformEnded = false,
  ): Promise<LiveGamesLiveStatus> {
    await this.ready();
    const { status, broadcast, providerPending } = this.journal;
    if (!status.canStop) return this.status(principal);
    const check = async () => {
      if (authorize && !(await authorize())) throw new BroadcastUnauthorized();
      await this.access(principal, status.accountId, "publish");
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
      await this.update({ status: next, broadcast: undefined, providerPending: false });
      return next;
    }
    await this.update({ status: { ...status, state: "stopping", reason: undefined } });
    let obsStreaming: boolean | undefined;
    try {
      if (this.journal.obsStarting) {
        if (!(await this.obs.stopSocial(check))) throw new Error("OBS stop was not confirmed.");
        obsStreaming = false;
        await this.update({ obsStarting: false });
      }
      if (providerPending) {
        const next = {
          ...status,
          state: "uncertain",
          obsStreaming,
          reason: "STOP_UNCERTAIN",
          needsPlatformConfirmation: true,
        } as const;
        await this.update({ status: next });
        return next;
      }
      await check();
      const result = broadcast ? await this.api().end(principal, broadcast, check) : "confirmed";
      const next =
        result === "owner_required"
          ? ({
              ...status,
              state: "owner_step",
              canStop: false,
              reason: "OWNER_STEP_REQUIRED",
              obsStreaming,
            } as const)
          : { ...idle, obsStreaming };
      await this.update({ status: next, broadcast: undefined });
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
