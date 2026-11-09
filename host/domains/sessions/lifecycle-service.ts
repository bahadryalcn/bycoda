import { assertDomainAuthority, type HostDomainContext } from "../context";
import {
  normalizeAutoSettleSettings,
  type AutoSettleSettings,
  type SessionLifecycleRecord,
  type SessionLifecycleStore,
} from "./lifecycle-model";

const DAY_MS = 86_400_000;
/** Saves that land just after a settle are not new activity (the sidebar uses the same grace). */
const SETTLE_ACTIVITY_GRACE_MS = 5000;

export interface SessionRunState {
  exists: boolean;
  running: boolean;
  /** Queued follow-ups not yet sent. */
  queued: number;
}

/** What automatic settling reads about one Host session. */
export interface SessionActivity {
  sessionId: string;
  lastActivityAt: number;
  pinned: boolean;
  archived: boolean;
  running: boolean;
  /** Waiting for an approval or an answer. */
  needsInput: boolean;
}

export interface SessionLifecyclePorts {
  runState(sessionId: string): Promise<SessionRunState>;
  /** Every session on this Host with what automatic settling needs. */
  activity(): Promise<SessionActivity[]>;
  /** Sets the session's archive flag, as the owner's Archive action does. */
  archive(sessionId: string): Promise<void>;
  now(): number;
}

/** A settings change; an omitted archive window keeps the saved one (older clients send none). */
export type AutoSettleChange = Pick<AutoSettleSettings, "afterDays"> &
  Partial<Pick<AutoSettleSettings, "archiveAfterDays">>;

export interface TurnOutcome {
  cancelled?: boolean;
  error?: string;
  interrupted?: boolean;
}

/**
 * Settle and un-settle, modelled on the reference app: settling moves a finished session out of the active
 * list and never locks it. A new message wakes it. Settling a running session applies when the
 * turn ends; a failed turn or a queued follow-up leaves it active. Automatic settling picks idle
 * sessions that are not pinned, archived, running, queued or waiting for input, and never one
 * the owner un-settled since its last message. Pin and tasks are never changed here; archive
 * only by the opt-in automatic archiving of sessions that stayed settled, which is reversible.
 */
export function createSessionLifecycleService(
  store: SessionLifecycleStore,
  ports: SessionLifecyclePorts,
) {
  const settled = (
    current: SessionLifecycleRecord,
    by: "owner" | "auto",
  ): SessionLifecycleRecord => ({
    sessionId: current.sessionId,
    participants: current.participants,
    state: "settled",
    settledAt: ports.now(),
    settledBy: by,
  });
  const active = (
    current: SessionLifecycleRecord,
    keepActive: boolean,
  ): SessionLifecycleRecord => ({
    sessionId: current.sessionId,
    participants: current.participants,
    state: "active",
    ...(keepActive ? { keepActive: true } : {}),
  });
  const write = (
    sessionId: string,
    change: (current: SessionLifecycleRecord) => SessionLifecycleRecord,
  ) =>
    store.update(sessionId, (current) => {
      const next = change(current);
      return { next, result: next };
    });

  const service = {
    get: (sessionId: string) => store.get(sessionId),

    /** Sessions that are settled or waiting to settle; the sidebar files them on their shelf. */
    async list(): Promise<SessionLifecycleRecord[]> {
      return (await store.list()).filter((record) => record.state !== "active");
    },

    async settle(sessionId: string, context: HostDomainContext): Promise<SessionLifecycleRecord> {
      await assertDomainAuthority(context);
      const state = await ports.runState(sessionId);
      if (!state.exists) throw new Error("Session not found");
      return write(sessionId, (current) => {
        if (current.state === "settled") return current;
        if (state.running)
          return {
            sessionId,
            participants: current.participants,
            state: "settling",
            settleRequestedAt: ports.now(),
          };
        return settled(current, "owner");
      });
    },

    /** Back to the active list; automatic settling leaves it alone until the next message. */
    async unsettle(sessionId: string, context: HostDomainContext): Promise<SessionLifecycleRecord> {
      await assertDomainAuthority(context);
      return write(sessionId, (current) => active(current, true));
    },

    /** A new message or queue change: the session is active work again. */
    async wake(sessionId: string): Promise<SessionLifecycleRecord> {
      const current = await store.get(sessionId);
      if (current.state === "active" && !current.keepActive) return current;
      return write(sessionId, (row) => active(row, false));
    },

    /** A turn ended. A pending settle applies unless the turn failed or follow-ups wait. */
    async turnEnded(sessionId: string, outcome: TurnOutcome = {}): Promise<SessionLifecycleRecord> {
      const current = await store.get(sessionId);
      if (current.state !== "settling") return current;
      const state = await ports.runState(sessionId);
      if (!state.exists || state.running) return current;
      const failed = Boolean(outcome.error) && !outcome.cancelled;
      return write(sessionId, (row) => {
        if (row.state !== "settling") return row;
        return failed || state.queued > 0 ? active(row, false) : settled(row, "owner");
      });
    },

    /** Restart recovery: a settle that waited for a turn the Host no longer runs applies now. */
    async recover(): Promise<number> {
      let finished = 0;
      for (const record of await store.list()) {
        if (record.state !== "settling") continue;
        if ((await service.turnEnded(record.sessionId)).state === "settled") finished += 1;
      }
      return finished;
    },

    autoSettleSettings: () => store.autoSettleSettings(),

    async configure(
      settings: AutoSettleChange,
      context: HostDomainContext,
    ): Promise<AutoSettleSettings> {
      await assertDomainAuthority(context);
      const current = await store.autoSettleSettings();
      return store.saveAutoSettleSettings(
        normalizeAutoSettleSettings({
          afterDays: settings.afterDays,
          archiveAfterDays:
            settings.archiveAfterDays === undefined
              ? current.archiveAfterDays
              : settings.archiveAfterDays,
        }),
      );
    },

    /** Settles every idle candidate; returns how many sessions it settled. */
    async autoSettle(): Promise<number> {
      const { afterDays } = await store.autoSettleSettings();
      if (afterDays === null) return 0;
      const cutoff = ports.now() - afterDays * DAY_MS;
      const records = new Map((await store.list()).map((record) => [record.sessionId, record]));
      let count = 0;
      for (const row of await ports.activity()) {
        if (row.pinned || row.archived || row.running || row.needsInput) continue;
        if (row.lastActivityAt >= cutoff) continue;
        const record = records.get(row.sessionId);
        if (record && (record.state !== "active" || record.keepActive)) continue;
        // The queue is read last, only for sessions that pass every cheaper test.
        const state = await ports.runState(row.sessionId);
        if (!state.exists || state.running || state.queued > 0) continue;
        const next = await write(row.sessionId, (current) =>
          current.state === "active" && !current.keepActive ? settled(current, "auto") : current,
        );
        if (next.state === "settled" && next.settledBy === "auto") count += 1;
      }
      return count;
    },

    /**
     * Archives sessions settled for the archive window; returns how many it archived. Pinned,
     * running, queued and waiting sessions stay, as does one that woke since it settled.
     */
    async autoArchive(): Promise<number> {
      const { archiveAfterDays } = await store.autoSettleSettings();
      if (archiveAfterDays === null) return 0;
      const cutoff = ports.now() - archiveAfterDays * DAY_MS;
      const records = new Map((await store.list()).map((record) => [record.sessionId, record]));
      let count = 0;
      for (const row of await ports.activity()) {
        if (row.pinned || row.archived || row.running || row.needsInput) continue;
        const record = records.get(row.sessionId);
        if (record?.state !== "settled" || record.settledAt === undefined) continue;
        if (record.settledAt >= cutoff) continue;
        if (row.lastActivityAt > record.settledAt + SETTLE_ACTIVITY_GRACE_MS) continue;
        const state = await ports.runState(row.sessionId);
        if (!state.exists || state.running || state.queued > 0) continue;
        // A wake between the list read and now keeps the session out of the archive.
        if ((await store.get(row.sessionId)).state !== "settled") continue;
        await ports.archive(row.sessionId);
        count += 1;
      }
      return count;
    },
  };
  return service;
}

export type SessionLifecycleService = ReturnType<typeof createSessionLifecycleService>;
