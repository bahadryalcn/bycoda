import { randomUUID, randomBytes } from "node:crypto";
import { SecretInputAnswerParamsSchema } from "../../src/shared/model/host-contracts/secrets-input";
import { AsyncResource } from "node:async_hooks";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import { isRoomWorkspaceAction } from "../assistant/room/assistant-room-workspace";
import { AwakeClock } from "../../src/shared/lib/time/awakeClock";
import { DESKTOP_TAKE_WAIT_MS } from "../../src/shared/model/host-contracts/native-services";
import { ChangeSignal } from "../changeSignal";

/**
 * How long the desktop may stay silent before the relay counts as offline. A desktop that holds
 * its take open (`DESKTOP_TAKE_WAIT_MS`) beats at least that often; older desktops poll at most every
 * 15 s when idle and back off to 30 s after failures. Either way the window covers the gap plus latency.
 */
export const DESKTOP_RELAY_STALE_MS = 45_000;
const CLAIM_SWEEP_MS = 5_000;

type TakeOptions = {
  /** Hold an empty claim open for up to this long; clamped to `DESKTOP_TAKE_WAIT_MS`. */
  waitMs?: number;
  signal?: AbortSignal;
  /** Rechecked while held, so revoked owner authority ends the wait. */
  authorized?: () => boolean | Promise<boolean>;
};

/** Owner-authenticated desktop relay. Requests expire without replaying mutations. */
export class ConversationDesktopRelay {
  constructor(
    private readonly environmentId?: string,
    private readonly requireAssistantApproval?: (operation: unknown) => Promise<boolean>,
  ) {}
  /** Polls are aged on a clock that skips Host sleep, so waking never reads as a silent desktop. */
  private readonly clock = new AwakeClock();
  private lastSeen = 0;
  /** Last poll per desktop (on `clock`); a claimed request is only as alive as the desktop that claimed it. */
  private readonly ownerSeen = new Map<string, number>();
  private sweeper: ReturnType<typeof setTimeout> | undefined;
  /** Wakes held takes when a request is queued, so delivery does not wait for the next poll. */
  private readonly arrivals = new ChangeSignal();
  private pending = new Map<
    string,
    {
      request: Record<string, unknown>;
      claimed: string | false;
      expectedOwner?: string;
      authorized: () => boolean | Promise<boolean>;
      fullAccess?: () => boolean | Promise<boolean>;
      resolve: (value: unknown, owner: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      secretSignature?: string;
    }
  >();
  call(
    action: string,
    input: Record<string, unknown>,
    cwd: string,
    principal: RuntimeLogSubjectPrincipal,
    authorized: () => boolean | Promise<boolean> = () => true,
    fullAccess?: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    if (
      principal.kind === "assistant-thread" &&
      !["desktop.act.authorize", "management.write.authorize"].includes(action)
    )
      throw new Error("This desktop relay action requires a coding session.");
    return this.enqueue(
      action,
      input,
      {
        cwd,
        ...(principal.kind === "session"
          ? { sessionId: principal.sessionId }
          : { threadId: principal.threadId, projectId: principal.projectId }),
      },
      authorized,
      undefined,
      principal.kind === "session" && action === "servers.ssh.execute" ? fullAccess : undefined,
    );
  }
  callAssistantThread(
    action: string,
    input: Record<string, unknown>,
    source: {
      threadId: string;
      environmentId: string;
      projectId?: string;
      targetProjectCwd?: string;
      targetDeviceHash?: string;
    },
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    if (action === "assistant.background.effect") {
      if (
        source.environmentId !== this.environmentId ||
        !source.threadId ||
        source.projectId ||
        source.targetProjectCwd ||
        source.targetDeviceHash
      )
        throw new Error("Invalid background Room source.");
      return this.enqueue(action, input, { threadId: source.threadId }, authorized);
    }
    if (
      action === "ui.tools.open" ||
      action === "ui.tools.status" ||
      action === "inbox.room.execute"
    ) {
      if (
        source.environmentId !== this.environmentId ||
        !source.threadId ||
        !source.projectId ||
        !source.targetProjectCwd ||
        !source.targetDeviceHash ||
        !/^[a-f0-9]{64}$/.test(source.targetDeviceHash)
      )
        throw new Error("Invalid Room browser panel source or target.");
      return this.enqueue(
        action,
        input,
        {
          threadId: source.threadId,
          projectId: source.projectId,
          targetProjectCwd: source.targetProjectCwd,
        },
        authorized,
        source.targetDeviceHash,
      );
    }
    if (
      action === "observations.native.projectBaseline" ||
      action === "observations.native.projectComplete"
    ) {
      if (
        source.environmentId !== this.environmentId ||
        !source.threadId ||
        !source.projectId ||
        !source.targetProjectCwd ||
        !source.targetDeviceHash ||
        !/^[a-f0-9]{64}$/.test(source.targetDeviceHash)
      )
        throw new Error("Invalid Native session observation source.");
      return this.enqueue(
        action,
        input,
        {
          threadId: source.threadId,
          projectId: source.projectId,
          targetProjectCwd: source.targetProjectCwd,
        },
        authorized,
        source.targetDeviceHash,
      );
    }
    if (
      action === "observations.native.complete" ||
      action === "observations.native.baseline" ||
      action === "privacy.scope.capture" ||
      action === "privacy.account.capture" ||
      action === "voice.generation.retire" ||
      action === "voice.generation.status" ||
      action === "voice.generation.source" ||
      action === "assistant.notification.deliver" ||
      action === "assistant.notification.status" ||
      action === "workspace.operation.status" ||
      action === "workspace.operation.execute"
    ) {
      const workspaceOperation =
        action === "workspace.operation.status" || action === "workspace.operation.execute";
      if (
        source.environmentId !== this.environmentId ||
        !source.threadId ||
        (action === "privacy.scope.capture" &&
          (!source.projectId ||
            !source.targetProjectCwd ||
            (source.targetDeviceHash !== undefined &&
              !/^[a-f0-9]{64}$/.test(source.targetDeviceHash)))) ||
        (action === "privacy.account.capture" &&
          (source.projectId ||
            source.targetProjectCwd ||
            (source.targetDeviceHash !== undefined &&
              !/^[a-f0-9]{64}$/.test(source.targetDeviceHash)))) ||
        (workspaceOperation &&
          (!source.projectId ||
            !source.targetProjectCwd ||
            !source.targetDeviceHash ||
            !/^[a-f0-9]{64}$/.test(source.targetDeviceHash))) ||
        (action !== "privacy.scope.capture" &&
          action !== "privacy.account.capture" &&
          !workspaceOperation &&
          (source.projectId ||
            source.targetProjectCwd ||
            !source.targetDeviceHash ||
            !/^[a-f0-9]{64}$/.test(source.targetDeviceHash)))
      )
        throw new Error("Invalid native Room source or target.");
      return this.enqueue(
        action,
        input,
        {
          threadId: source.threadId,
          ...(source.projectId ? { projectId: source.projectId } : {}),
          ...(source.targetProjectCwd ? { targetProjectCwd: source.targetProjectCwd } : {}),
        },
        authorized,
        source.targetDeviceHash,
      );
    }
    if (
      source.environmentId !== this.environmentId ||
      !source.threadId ||
      !(
        isRoomWorkspaceAction(action) ||
        [
          "delegation.grants",
          "delegation.call",
          "preferences.read",
          "preferences.patch",
          "preferences.status",
          "providerManagement.read",
          "providerManagement.quotaRefresh",
          "providerManagement.status",
          "organization.read",
          "organization.patch",
          "organization.status",
          "servers.list",
          "servers.get",
          "servers.ssh.execute",
          "servers.ssh.status",
          "servers.ssh.cancel",
          "servers.ssh.save",
          "servers.ssh.remove",
          "management.write.authorize",
          "desktop.act.authorize",
        ].includes(action)
      )
    )
      throw new Error("Unsupported global assistant desktop operation.");
    // A project thread's desktop approval names its project folder through `call`.
    if (action === "desktop.act.authorize" && (source.projectId || source.targetProjectCwd))
      throw new Error("Invalid global desktop approval source.");
    if (
      source.targetProjectCwd &&
      (!source.projectId || !(action.startsWith("organization.") || isRoomWorkspaceAction(action)))
    )
      throw new Error("Invalid assistant desktop target.");
    return this.enqueue(
      action,
      input,
      {
        threadId: source.threadId,
        ...(source.projectId ? { projectId: source.projectId } : {}),
        ...(source.targetProjectCwd ? { targetProjectCwd: source.targetProjectCwd } : {}),
      },
      authorized,
      source.targetDeviceHash,
    );
  }
  private enqueue(
    action: string,
    input: Record<string, unknown>,
    source: Record<string, unknown>,
    authorized: () => boolean | Promise<boolean>,
    expectedOwner?: string,
    fullAccess?: () => boolean | Promise<boolean>,
    policyPrepared = false,
  ): Promise<unknown> {
    // A request aimed at one device is only reachable while that device polls; an untargeted one
    // can be claimed by any desktop, so any poll counts.
    const seen = expectedOwner ? (this.ownerSeen.get(expectedOwner) ?? 0) : this.lastSeen;
    if (this.clock.now() - seen > DESKTOP_RELAY_STALE_MS)
      throw new Error(
        "Desktop relay is offline. Open the updated bycoda desktop connected to this host.",
      );
    this.failStaleClaims();
    if (this.pending.size >= 64) throw new Error("Desktop relay is busy.");
    if (
      !policyPrepared &&
      source.threadId &&
      action === "management.write.authorize" &&
      this.requireAssistantApproval
    ) {
      const requireApproval = this.requireAssistantApproval;
      return requireApproval(input.operation).then((required) =>
        this.enqueue(
          action,
          { ...input, requireOwnerApproval: required },
          source,
          async () =>
            (await authorized()) && (required || !(await requireApproval(input.operation))),
          expectedOwner,
          fullAccess,
          true,
        ),
      );
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 240000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Desktop relay timed out. Check the desktop connection; inspect state before retrying mutations.",
          ),
        );
      }, 240000);
      this.pending.set(id, {
        request: {
          id,
          action,
          input,
          ...source,
          environmentId: this.environmentId,
          deadline,
        },
        claimed: false,
        expectedOwner,
        authorized: AsyncResource.bind(authorized),
        fullAccess: fullAccess && AsyncResource.bind(fullAccess),
        resolve: (value, owner) =>
          resolve(
            action === "observations.native.complete" ||
              action === "observations.native.baseline" ||
              action === "observations.native.projectBaseline" ||
              action === "observations.native.projectComplete" ||
              action === "privacy.scope.capture" ||
              action === "privacy.account.capture" ||
              action === "voice.generation.retire" ||
              action === "voice.generation.status" ||
              action === "voice.generation.source" ||
              action === "assistant.notification.deliver" ||
              action === "assistant.notification.status" ||
              action === "workspace.operation.status" ||
              action === "workspace.operation.execute"
              ? {
                  relayId: id,
                  envelope: value,
                  ...(action === "privacy.scope.capture" || action === "privacy.account.capture"
                    ? { deviceHash: owner }
                    : {}),
                }
              : value,
          ),
        reject,
        timer,
        ...(action === "secrets.input.authorize"
          ? { secretSignature: randomBytes(32).toString("hex") }
          : {}),
      });
      this.arrivals.notify();
    });
  }
  /** Metadata only, scoped to the open session. Values never enter this registry. */
  async secretInputs(
    sessionId: string,
    ownerAuthorized: () => boolean | Promise<boolean> = () => true,
  ) {
    const requests = [];
    for (const [id, entry] of this.pending) {
      if (!entry.secretSignature || entry.request.sessionId !== sessionId) continue;
      if (
        !(await entry.authorized()) ||
        this.pending.get(id) !== entry ||
        Number(entry.request.deadline) <= Date.now()
      )
        continue;
      const input = entry.request.input as { name: string; purpose: string };
      requests.push({
        id,
        signature: entry.secretSignature,
        sessionId,
        kind: "secret" as const,
        remote: true as const,
        title: "Secret request",
        message: input.purpose,
        fieldLabel: input.name,
        confirmLabel: "Save secret",
        cancelLabel: "Cancel",
        deadline: Number(entry.request.deadline),
      });
      if (requests.length === 24) break;
    }
    if (!(await ownerAuthorized())) throw new Error("Device authorization was revoked");
    return { requests };
  }

  /** Owner transport admits callers; consume once after rechecking original session authority. */
  async answerSecretInput(
    raw: unknown,
    ownerAuthorized: () => boolean | Promise<boolean> = () => true,
  ) {
    const parsed = SecretInputAnswerParamsSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid secret answer.");
    const answer = parsed.data;
    if ("value" in answer && Buffer.byteLength(answer.value, "utf8") > 8192)
      throw new Error("Invalid secret answer.");
    const entry = this.pending.get(answer.id);
    const current = () =>
      entry &&
      this.pending.get(answer.id) === entry &&
      entry.secretSignature === answer.signature &&
      Number(entry.request.deadline) > Date.now();
    if (
      !current() ||
      !entry ||
      !(await entry.authorized()) ||
      !(await ownerAuthorized()) ||
      !(await entry.authorized()) ||
      !current()
    )
      throw new Error("Secret request expired, unknown or already answered.");
    clearTimeout(entry.timer);
    this.pending.delete(answer.id);
    entry.resolve("value" in answer ? { value: answer.value } : { cancelled: true }, "phone");
    return { accepted: true as const };
  }

  /** A claimed request cannot be re-offered, so one whose desktop went silent fails now, not at its deadline. */
  private failStaleClaims() {
    const now = this.clock.now();
    for (const [id, entry] of this.pending) {
      if (
        !entry.claimed ||
        now - (this.ownerSeen.get(entry.claimed) ?? 0) <= DESKTOP_RELAY_STALE_MS
      )
        continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(
        new Error(
          "Desktop disconnected while handling this request. Check the desktop connection; inspect state before retrying mutations.",
        ),
      );
    }
    if (this.sweeper) clearTimeout(this.sweeper);
    this.sweeper = undefined;
    if ([...this.pending.values()].some((entry) => entry.claimed)) {
      // Nothing else wakes the relay once the desktop is gone, so a claim re-checks itself.
      this.sweeper = setTimeout(() => this.failStaleClaims(), CLAIM_SWEEP_MS);
      this.sweeper.unref();
    }
  }
  /**
   * Claims the requests waiting for `owner`. With `waitMs`, an empty claim is held until a request
   * arrives, the wait ends, the caller aborts or authority is revoked; each hold is also a heartbeat.
   * Without it the claim returns at once, as older desktops expect.
   */
  async take(owner = "desktop", options: TakeOptions = {}) {
    this.clock.start();
    this.lastSeen = this.clock.now();
    this.ownerSeen.set(owner, this.lastSeen);
    const waitMs =
      typeof options.waitMs === "number" && Number.isFinite(options.waitMs)
        ? Math.min(Math.max(0, options.waitMs), DESKTOP_TAKE_WAIT_MS)
        : 0;
    const deadline = Date.now() + waitMs;
    const { signal, authorized } = options;
    const cancelled = async () => signal?.aborted === true || !(await (authorized?.() ?? true));
    for (;;) {
      // Read the version before claiming, so a request queued during the claim still wakes the wait.
      const version = this.arrivals.version;
      const requests = await this.claim(owner);
      if (requests.length || Date.now() >= deadline || (await cancelled())) return requests;
      await this.arrivals.wait(deadline, cancelled, version, signal);
    }
  }
  private async claim(owner: string) {
    this.failStaleClaims();
    const requests: Record<string, unknown>[] = [];
    for (const [id, entry] of this.pending)
      if (
        !entry.claimed &&
        (!entry.expectedOwner || entry.expectedOwner === owner) &&
        requests.length < 8
      ) {
        const authorized = await entry.authorized();
        if (this.pending.get(id) !== entry || entry.claimed) continue;
        if (!authorized) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.reject(new Error("Session authority revoked."));
          continue;
        }
        entry.claimed = owner;
        requests.push(entry.request);
      }
    if (requests.length && !this.sweeper) this.failStaleClaims();
    return requests;
  }
  /** Native owner rechecks after a dialog and immediately before an effect. */
  async authorize(id: string, action: string, owner = "desktop") {
    // Private native policy query; legacy callers retain the one-field reply.
    const sshPermission = action === "servers.ssh.execute.permission";
    const requestedAction = sshPermission ? "servers.ssh.execute" : action;
    const entry = this.pending.get(id);
    if (!entry) return { authorized: false };
    const deadline = entry.request.deadline;
    const current = () =>
      this.pending.get(id) === entry &&
      entry.claimed === owner &&
      (entry.request.action === requestedAction ||
        (entry.request.action === "inbox.room.execute" && action === "inbox.room.scope")) &&
      typeof deadline === "number" &&
      deadline > Date.now();
    if (!current() || !(await entry.authorized()) || !current()) return { authorized: false };
    if (!sshPermission) return { authorized: true };
    const fullAccess = entry.fullAccess ? (await entry.fullAccess()) === true : false;
    if (!current() || !(await entry.authorized()) || !current()) return { authorized: false };
    return { authorized: true, fullAccess };
  }
  async authorizeBackgroundCallback(
    id: string,
    owner: string,
    input: {
      environmentId: string;
      threadId: string;
      operationId: string;
      operationHash: string;
      challenge: string;
    },
  ) {
    const entry = this.pending.get(id);
    const matches = () => {
      if (
        !entry ||
        this.pending.get(id) !== entry ||
        entry.request.threadId !== input.threadId ||
        input.environmentId !== this.environmentId
      )
        return false;
      const payload = entry.request.input as {
        sourceJson?: unknown;
        operationHash?: unknown;
        challenge?: unknown;
      };
      if (
        !payload ||
        typeof payload.sourceJson !== "string" ||
        payload.operationHash !== input.operationHash ||
        payload.challenge !== input.challenge
      )
        return false;
      try {
        const source = JSON.parse(payload.sourceJson) as {
          operationId?: unknown;
          threadId?: unknown;
          environmentId?: unknown;
        };
        return (
          source.operationId === input.operationId &&
          source.threadId === input.threadId &&
          source.environmentId === input.environmentId
        );
      } catch {
        return false;
      }
    };
    return (
      matches() &&
      (await this.authorize(id, "assistant.background.effect", owner)).authorized &&
      matches()
    );
  }
  async finish(id: string, value: unknown, error?: string, owner = "desktop") {
    const entry = this.pending.get(id);
    if (!entry || entry.claimed !== owner)
      throw new Error("Desktop request expired, unknown or owned by another device.");
    const authorized = await entry.authorized();
    if (this.pending.get(id) !== entry || Number(entry.request.deadline) <= Date.now())
      throw new Error("Desktop request expired, unknown or owned by another device.");
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (!authorized) entry.reject(new Error("Session authority revoked."));
    else if (error) entry.reject(new Error(error));
    else entry.resolve(value, owner);
    return { accepted: true };
  }
  close() {
    clearTimeout(this.sweeper);
    this.sweeper = undefined;
    this.clock.stop();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Host stopped."));
    }
    this.pending.clear();
  }
}
