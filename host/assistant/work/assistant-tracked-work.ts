import type {
  AssistantNotification,
  AssistantProfile,
} from "../../../src/shared/model/host-contracts/assistant";
import type { RecordValue } from "../repository";
import { assistantJobNotificationBody } from "./assistant-job-holds";
import { nudgeStalledJobSessions, type JobsStallDeps } from "./assistant-jobs-stall";
import {
  storeTrackedWorkReader,
  type TrackedKind,
  type TrackedWork,
  type TrackedWorkReader,
} from "./assistant-tracked-work-reader";

export type { TrackedKind, TrackedWork } from "./assistant-tracked-work-reader";
export const MAX_TRACKED_WORK = 200;
export const TRACKED_TERMINAL_MS = 7 * 24 * 60 * 60 * 1000;
const GONE_GRACE_MS = 5 * 60 * 1000;
const LABEL: Record<TrackedKind, string> = { goal: "Goal", task: "Task", crew: "Crew" };
const NOTIFIED = new Set(["done", "failed", "waiting", "stalled"]);
const TERMINAL = new Set(["done", "failed", "cancelled", "gone"]);
const prefix = "tracked:";
const keyOf = (kind: TrackedKind, id: string) => `${prefix}${kind}:${id}`;
type Row = RecordValue & { value: TrackedWork };
export type TrackedWorkInput = Pick<
  TrackedWork,
  "kind" | "id" | "projectId" | "title" | "threadId"
>;
export type TrackedWorkNotification = Omit<AssistantNotification, "eligible" | "deferredReason">;

export interface TrackedWorkDeps extends JobsStallDeps {
  notify(value: TrackedWorkNotification): Promise<void>;
  read?: TrackedWorkReader;
}

/**
 * Work the Room/voice model started directly (goals, top-level tasks, crew runs).
 * Records are observation-only: tracking grants the assistant no authority over the work.
 */
export class AssistantTrackedWork {
  private readonly read: TrackedWorkReader;
  constructor(private readonly deps: TrackedWorkDeps) {
    this.read = deps.read ?? storeTrackedWorkReader(deps.repository.store);
  }
  /** Jobs mode only: one fixed follow-up per stall of the job's own workers. */
  nudgeStalled(
    job: { id: string },
    sessionIds: readonly string[],
    profile: Pick<AssistantProfile, "autonomy" | "stallMinutes">,
  ) {
    return nudgeStalledJobSessions(this.deps, job, sessionIds, profile);
  }
  private get store() {
    return this.deps.repository.store;
  }
  async track(input: TrackedWorkInput): Promise<void> {
    const id = keyOf(input.kind, input.id);
    await this.store.transaction(async () => {
      if (await this.deps.repository.get<Row>("runtime", id)) return;
      const now = this.deps.now();
      await this.deps.repository.put<Row>("runtime", {
        id,
        version: 0,
        createdAt: now,
        updatedAt: now,
        value: {
          ...input,
          title: input.title.slice(0, 200),
          createdAt: now,
          state: "tracked",
          stateAt: now,
        },
      });
      // Terminal items go first, then the oldest; a full table never blocks new work.
      const rows = await this.store.db
        .prepare(
          "SELECT id FROM assistant_runtime WHERE id LIKE 'tracked:%' AND deleted_at IS NULL ORDER BY json_extract(value,'$.value.terminalAt') IS NULL,updated_at,id",
        )
        .all();
      for (const row of rows.slice(0, Math.max(0, rows.length - MAX_TRACKED_WORK)))
        await this.store.db.prepare("DELETE FROM assistant_runtime WHERE id=?").run(row.id);
    }, "critical");
  }
  /** Polls canonical status and queues one notification per item per notable state. */
  async tick(profile: Pick<AssistantProfile, "stallMinutes">): Promise<void> {
    const rows = await this.store.db
      .prepare(
        "SELECT value FROM assistant_runtime WHERE id LIKE 'tracked:%' AND deleted_at IS NULL ORDER BY updated_at,id LIMIT ?",
      )
      .all(MAX_TRACKED_WORK * 2);
    for (const raw of rows) {
      const row = JSON.parse(String(raw.value)) as Row,
        item = row.value,
        now = this.deps.now();
      try {
        if (item.terminalAt !== undefined && now - item.terminalAt > TRACKED_TERMINAL_MS) {
          await this.store.db.prepare("DELETE FROM assistant_runtime WHERE id=?").run(row.id);
          continue;
        }
        const seen = await this.read(item, { now, stallMs: profile.stallMinutes * 60000 });
        const next = seen ?? {
          state: now - item.createdAt > GONE_GRACE_MS ? ("gone" as const) : ("active" as const),
        };
        if (next.state === item.state) continue;
        const label = `${LABEL[item.kind]}: ${item.title}`;
        await this.store.transaction(async () => {
          const { terminalAt: _, ...rest } = item;
          await this.deps.repository.put<Row>(
            "runtime",
            {
              ...row,
              updatedAt: now,
              value: {
                ...rest,
                state: next.state,
                stateAt: now,
                ...(TERMINAL.has(next.state) ? { terminalAt: now } : {}),
              },
            },
            row.version,
          );
          if (!NOTIFIED.has(next.state)) return;
          const body =
            next.state === "done"
              ? [`${LABEL[item.kind]} is done.`, next.verification].filter(Boolean).join(" ")
              : assistantJobNotificationBody(
                  next.state,
                  next.summary ?? (next.state === "failed" ? `${LABEL[item.kind]} failed.` : ""),
                  next.waitingReason,
                  profile.stallMinutes,
                );
          await this.deps.notify({
            id: `${row.id}:${next.state}`,
            kind: `job.${next.state}` as TrackedWorkNotification["kind"],
            title: label,
            body,
            createdAt: now,
            projectId: item.projectId,
            projectIds: [item.projectId],
          });
        }, "critical");
      } catch (error) {
        this.deps.onError?.(error);
      }
    }
  }
}
