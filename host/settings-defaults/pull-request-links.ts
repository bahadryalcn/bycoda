import type { HostStore } from "../store";

async function ready(store: HostStore) {
  await store.ready;
  await store.db.exec(
    "CREATE TABLE IF NOT EXISTS session_archive_pr_links (session_id TEXT NOT NULL, url TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(session_id,url))",
  );
}
/** Retains terminal link evidence after the watch has delivered its final wake and retires. */
export async function recordArchivePullRequest(
  store: HostStore,
  sessionId: string,
  url: string,
  state: string,
): Promise<void> {
  if (!["OPEN", "CLOSED", "MERGED"].includes(state))
    throw new Error("Invalid linked pull request state");
  await store.db.scope(async () => {
    await ready(store);
    await store.db
      .prepare(
        "INSERT INTO session_archive_pr_links VALUES (?,?,?) ON CONFLICT(session_id,url) DO UPDATE SET state=excluded.state",
      )
      .run(sessionId, url, state);
  });
}
/** Explicit unlink/deletion removes evidence; automatic watch retirement must retain it. */
export async function forgetArchivePullRequest(
  store: HostStore,
  sessionId: string,
  url?: string,
): Promise<void> {
  await store.db.scope(async () => {
    await ready(store);
    if (url === undefined)
      await store.db
        .prepare("DELETE FROM session_archive_pr_links WHERE session_id=?")
        .run(sessionId);
    else
      await store.db
        .prepare("DELETE FROM session_archive_pr_links WHERE session_id=? AND url=?")
        .run(sessionId, url);
  });
}
export async function hasMergedArchivePullRequest(
  store: HostStore,
  sessionId: string,
): Promise<boolean> {
  return store.db.scope(async () => {
    await ready(store);
    return !!(await store.db
      .prepare(
        "SELECT 1 FROM session_archive_pr_links WHERE session_id=? AND state='MERGED' LIMIT 1",
      )
      .get(sessionId));
  });
}
