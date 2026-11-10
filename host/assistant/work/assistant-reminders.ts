import { randomUUID } from "node:crypto";
import {
  ASSISTANT_REMINDER_MAX_AHEAD_MS,
  type AssistantReminder,
  type AssistantReminderRequest,
  type AssistantRemindersResponse,
} from "../../../src/shared/model/assistantReminders";
import type { AssistantNotification } from "../../../src/shared/model/host-contracts/assistant";
import type { AssistantRepository, RecordValue } from "../repository";

const PREFIX = "reminder:";
const MAX_PENDING = 100;
type Stored = RecordValue & {
  value: { text: string; at: number; status: "pending" | "fired"; firedAt?: number };
};
type Deps = {
  repository: Pick<AssistantRepository, "get" | "put" | "byKey" | "trash" | "store">;
  now: () => number;
};
type FireDeps = Deps & {
  queueNotification(
    value: Omit<AssistantNotification, "eligible" | "deferredReason">,
  ): Promise<unknown>;
};

const view = (row: Stored): AssistantReminder => ({
  id: row.id.slice(PREFIX.length),
  version: row.version,
  text: row.value.text,
  at: row.value.at,
  status: row.value.status,
  createdAt: row.createdAt,
  ...(row.value.firedAt === undefined ? {} : { firedAt: row.value.firedAt }),
});

async function pending(repository: Deps["repository"], limit = MAX_PENDING): Promise<Stored[]> {
  const rows = await repository.store.db
    .prepare(
      "SELECT value FROM assistant_runtime WHERE id LIKE 'reminder:%' AND deleted_at IS NULL AND json_extract(value,'$.value.status')='pending' ORDER BY json_extract(value,'$.value.at'),id LIMIT ?",
    )
    .all(limit);
  return rows.map((row) => JSON.parse(String(row.value)) as Stored);
}

/** `reminders.create`, `reminders.list` and `reminders.cancel`; the owner's own timed notes, never jobs. */
export async function assistantReminderOp(
  input: AssistantReminderRequest,
  principal: string,
  deps: Deps,
): Promise<{ reminders: AssistantRemindersResponse }> {
  if (principal !== "owner") throw new Error("This action requires the owner's direct authority.");
  const { repository } = deps;
  if (input.op === "reminders.list")
    return { reminders: { items: (await pending(repository)).map(view) } };
  if (input.op === "reminders.cancel") {
    await repository.store.transaction(
      () => repository.trash("runtime", PREFIX + input.id, input.expectedVersion, deps.now()),
      "critical",
    );
    return { reminders: { items: (await pending(repository)).map(view) } };
  }
  const now = deps.now();
  const created = await repository.store.transaction(async () => {
    const key = `${PREFIX}${input.requestId}`;
    const old = await repository.byKey<Stored>("runtime", key);
    if (old) {
      if (old.value.text !== input.text || old.value.at !== input.at)
        throw new Error("A reminder retry must preserve the original request.");
      return old;
    }
    if (input.at <= now) throw new Error("A reminder must be set for a time in the future.");
    if (input.at > now + ASSISTANT_REMINDER_MAX_AHEAD_MS)
      throw new Error("A reminder can be at most one year ahead.");
    if ((await pending(repository, MAX_PENDING)).length >= MAX_PENDING)
      throw new Error("There are already 100 pending reminders. Cancel one first.");
    return repository.put<Stored>(
      "runtime",
      {
        id: PREFIX + randomUUID(),
        version: 0,
        createdAt: now,
        updatedAt: now,
        value: { text: input.text, at: input.at, status: "pending" },
      },
      0,
      key,
    );
  }, "critical");
  return { reminders: { items: (await pending(repository)).map(view), reminder: view(created) } };
}

/** Job tick: each due reminder queues one notification and is marked fired in the same commit. */
export async function fireDueReminders(deps: FireDeps) {
  const now = deps.now();
  const due = (await pending(deps.repository)).filter((row) => row.value.at <= now);
  for (const row of due)
    await deps.repository.store.transaction(async () => {
      await deps.repository.put<Stored>(
        "runtime",
        { ...row, updatedAt: now, value: { ...row.value, status: "fired", firedAt: now } },
        row.version,
      );
      await deps.queueNotification({
        id: `reminder:${row.id.slice(PREFIX.length)}`,
        kind: "reminder",
        title: "Reminder",
        body: row.value.text,
        createdAt: now,
      });
    }, "critical");
}
