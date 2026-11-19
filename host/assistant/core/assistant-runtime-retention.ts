import type { StoreDatabase } from "../../store-db";

/**
 * Per-message runtime keys that only annotate one message. Each is the key prefix; the rest of the
 * key is the message id. `messageScopeVoice:` is excluded: it is the link a voice-context
 * retention sweep needs to find the context a purged message disclosed.
 */
const MESSAGE_KEY_PREFIXES = ["messageScopeSources:", "messageRoomTurn:"] as const;
const BATCH = 1000;

/**
 * Deletes per-message annotation rows whose message row no longer exists (the message was purged,
 * so nothing can render or replay them). Rows of live or restorable messages, the `room-turn:`
 * state they point at, pending work, notifications and receipts are never touched. Returns the
 * number of rows removed (at most one batch per prefix per call).
 */
export async function purgeOrphanedMessageRuntime(
  db: Pick<StoreDatabase, "prepare">,
  olderThan: number,
): Promise<number> {
  let removed = 0;
  for (const prefix of MESSAGE_KEY_PREFIXES) {
    // Keys all end with ':', so ';' (the next code point) closes the prefix range on the PK index.
    const upper = `${prefix.slice(0, -1)};`;
    const result = await db
      .prepare(
        `DELETE FROM assistant_runtime WHERE id IN (
          SELECT r.id FROM assistant_runtime r
          WHERE r.id>=? AND r.id<? AND r.updated_at<=?
            AND NOT EXISTS (SELECT 1 FROM assistant_messages m WHERE m.id=substr(r.id,?))
          ORDER BY r.id LIMIT ${BATCH})`,
      )
      .run(prefix, upper, olderThan, prefix.length + 1);
    removed += Number(result?.changes ?? 0);
  }
  return removed;
}
