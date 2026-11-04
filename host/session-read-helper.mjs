import { registerHooks } from "node:module";
import { existsSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL) {
    const candidate = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(candidate.pathname) && candidate.protocol === "file:") {
      const typed = new URL(`${candidate.href}.ts`);
      if (existsSync(fileURLToPath(typed))) return nextResolve(typed.href, context);
    }
  }
  return nextResolve(specifier, context);
} });
const { DesktopSessions } = await import("./desktopSessions.ts");
const { createHostNotesDatabaseFactory } = await import("./host-notes-admission.ts");
let admitted = false;
process.on("message", ({ id, request, comparison }) => {
  if (admitted) process.exit(1);
  admitted = true;
  let value, error;
  let desktop, db;
  const factory = createHostNotesDatabaseFactory(comparison);
  try {
    if (typeof id !== "string" || !request || typeof request.sessionId !== "string") throw new Error("Invalid session read identity.");
    if (request.kind === "desktop") {
      if (!Array.isArray(request.paths) || request.paths.some((path) => typeof path !== "string")) throw new Error("Invalid desktop read sources.");
      desktop = new DesktopSessions(() => request.paths, request.platform, undefined, undefined, (path, options) => {
        if (!options.readOnly) throw new Error("Session helper cannot open a writer.");
        const connection = factory.open(path, options);
        connection.exec("PRAGMA query_only=ON; BEGIN");
        const close = connection.close.bind(connection);
        connection.close = () => {
          if (connection.isTransaction) connection.exec("ROLLBACK");
          close();
        };
        return connection;
      });
      if (request.method === "snapshot") value = desktop.readSnapshotRecord(request.sessionId, request.projectId, request.expectedProjectCwd);
      else if (request.method === "stamp") value = desktop.readStampRows(request.sessionId);
      else if (request.method === "metadata") value = desktop.readMetadataRecord(request.sessionId, true);
      else throw new Error("Unknown readonly desktop operation.");
      desktop.releaseReadHandles();
    } else if (request.kind === "host") {
      const path = realpathSync(request.path);
      const before = statSync(path);
      db = factory.open(path, { readOnly: true });
      db.exec("PRAGMA query_only=ON; BEGIN");
      const row = db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(request.sessionId);
      if (row) {
        value = JSON.parse(String(row.snapshot));
        const journal = db.prepare("SELECT * FROM session_journal WHERE session_id=?").get(request.sessionId);
        if (journal && Number(journal.revision) > value.revision) {
          const blocks = new Map(value.session.blocks.map((block) => [block.id, block]));
          const revisions = { ...value.blockRevisions };
          for (const changed of db.prepare("SELECT * FROM session_journal_blocks WHERE session_id=?").all(request.sessionId)) {
            blocks.set(String(changed.block_id), JSON.parse(String(changed.payload)));
            revisions[String(changed.block_id)] = Number(changed.revision);
          }
          const metadata = JSON.parse(String(journal.metadata));
          const ids = JSON.parse(String(journal.block_ids));
          value = { ...metadata, blockRevisions: Object.fromEntries(ids.map((blockId) => [blockId, revisions[blockId] ?? value.revision])), session: { ...metadata.session, blocks: ids.map((blockId) => {
            const block = blocks.get(blockId);
            if (!block) throw new Error("Incomplete session journal");
            return block;
          }) } };
        }
      }
      db.exec("ROLLBACK");
      db.close(); db = undefined;
      const after = statSync(path);
      if (realpathSync(request.path) !== path || before.dev !== after.dev || before.ino !== after.ino || before.birthtimeMs !== after.birthtimeMs)
        throw new Error("Host session database physical source changed.");
    } else throw new Error("Unknown readonly session operation.");
    if (!factory.connectionsClosed() || factory.closeFault()) throw new Error("Session read connection close was not confirmed.");
    if (Buffer.byteLength(JSON.stringify(value) ?? "null") > 32 * 1024 * 1024)
      throw new Error("Session exceeds full snapshot budget; use bounded transcript pages.");
  } catch (cause) {
    value = undefined;
    error = cause instanceof Error ? cause.message : "Session readonly helper failed.";
  } finally {
    try { db?.close(); desktop?.releaseReadHandles(); } catch { error = "Session read close was not confirmed."; }
  }
  process.send?.({ id, value, error }, () => process.exit(error ? 1 : 0));
});
