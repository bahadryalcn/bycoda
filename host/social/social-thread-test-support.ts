import type { HostStore } from "../store";
import type { SocialThread } from "../../src/features/social/model/social";

export async function seedThreadCopies(
  store: HostStore,
  source: SocialThread,
  count: number,
  offset = 0,
) {
  const insert = store.db.prepare("INSERT INTO social_records VALUES ('thread',?,?)");
  // Seed history together so the query-count regression does not measure disk flushes.
  await store.transaction(async () => {
    for (let index = offset; index < offset + count; index++) {
      const thread = {
        ...source,
        id: `page-thread-${index}`,
        platformThreadId: `remote-${index}`,
        lastInboundAt: index + 1,
      };
      await insert.run(thread.id, JSON.stringify(thread));
    }
  });
}
