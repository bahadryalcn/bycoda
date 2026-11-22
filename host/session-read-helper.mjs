import { registerHooks } from "node:module";
import { existsSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.once("disconnect", () => process.exit(0));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL);
      if (!/\.[a-z]+$/i.test(candidate.pathname) && candidate.protocol === "file:") {
        const typed = new URL(`${candidate.href}.ts`);
        if (existsSync(fileURLToPath(typed))) return nextResolve(typed.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { DesktopSessions } = await import("./desktop/desktopSessions.ts");
const { createHostNotesDatabaseFactory } = await import("./host-notes-admission.ts");
const { SessionReadError } = await import("./domains/sessions/read-errors.ts");
const { resetProjectPathCache } = await import("./desktop/project-path.ts");
process.on("message", (message) => {
  if (!message || typeof message !== "object" || typeof message.id !== "string") process.exit(1);
  const { id, request, comparison } = message;
  // The helper outlives jobs; a cwd check must never trust an earlier job's junction mapping.
  resetProjectPathCache();
  let value, error, errorKind;
  let desktop, db, factory, retire;
  try {
    factory = createHostNotesDatabaseFactory(comparison);
    if (!request || typeof request.sessionId !== "string")
      throw new Error("Invalid session read identity.");
    if (request.kind === "desktop") {
      if (!Array.isArray(request.paths) || request.paths.some((path) => typeof path !== "string"))
        throw new Error("Invalid desktop read sources.");
      desktop = new DesktopSessions(
        () => request.paths,
        request.platform,
        undefined,
        undefined,
        (path, options) => {
          if (!options.readOnly) throw new Error("Session helper cannot open a writer.");
          const connection = factory.open(path, options);
          try {
            connection.exec("PRAGMA query_only=ON; BEGIN");
          } catch (cause) {
            try {
              connection.close();
            } catch {
              /* the factory reports an unclosed connection and the job retires the helper */
            }
            throw cause;
          }
          const close = connection.close.bind(connection);
          connection.close = () => {
            if (connection.isTransaction) connection.exec("ROLLBACK");
            close();
          };
          return connection;
        },
      );
      if (request.method === "snapshot")
        value = desktop.readSnapshotRecord(
          request.sessionId,
          request.projectId,
          request.expectedProjectCwd,
        );
      // Both reads share this job's read transaction.
      else if (request.method === "snapshotStamp") {
        const record = desktop.readSnapshotRecord(
          request.sessionId,
          request.projectId,
          request.expectedProjectCwd,
        );
        value = { record, rows: record ? desktop.readStampRows(request.sessionId) : [] };
      } else if (request.method === "metadata")
        value = desktop.readMetadataRecord(request.sessionId, true);
      else throw new Error("Unknown readonly desktop operation.");
    } else if (request.kind === "host") {
      const path = realpathSync(request.path);
      const before = statSync(path);
      db = factory.open(path, { readOnly: true });
      db.exec("PRAGMA query_only=ON; BEGIN");
      const row = db.prepare("SELECT snapshot FROM sessions WHERE id=?").get(request.sessionId);
      if (row) {
        value = JSON.parse(String(row.snapshot));
        const journal = db
          .prepare("SELECT * FROM session_journal WHERE session_id=?")
          .get(request.sessionId);
        if (journal && Number(journal.revision) > value.revision) {
          const blocks = new Map(value.session.blocks.map((block) => [block.id, block]));
          const revisions = { ...value.blockRevisions };
          for (const changed of db
            .prepare("SELECT * FROM session_journal_blocks WHERE session_id=?")
            .all(request.sessionId)) {
            blocks.set(String(changed.block_id), JSON.parse(String(changed.payload)));
            revisions[String(changed.block_id)] = Number(changed.revision);
          }
          const metadata = JSON.parse(String(journal.metadata));
          const ids = JSON.parse(String(journal.block_ids));
          value = {
            ...metadata,
            blockRevisions: Object.fromEntries(
              ids.map((blockId) => [blockId, revisions[blockId] ?? value.revision]),
            ),
            session: {
              ...metadata.session,
              blocks: ids.map((blockId) => {
                const block = blocks.get(blockId);
                if (!block) throw new Error("Incomplete session journal");
                return block;
              }),
            },
          };
        }
      }
      db.exec("ROLLBACK");
      db.close();
      db = undefined;
      const after = statSync(path);
      if (
        realpathSync(request.path) !== path ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.birthtimeMs !== after.birthtimeMs
      )
        throw new Error("Host session database physical source changed.");
    } else throw new Error("Unknown readonly session operation.");
    if (Buffer.byteLength(JSON.stringify(value) ?? "null") > 32 * 1024 * 1024)
      throw new SessionReadError("snapshot-budget");
  } catch (cause) {
    value = undefined;
    error = cause instanceof Error ? cause.message : "Session readonly helper failed.";
    if (cause instanceof SessionReadError) errorKind = cause.kind;
  } finally {
    try {
      db?.close();
      desktop?.releaseReadHandles();
    } catch {
      retire = true;
    }
    if (factory && (!factory.connectionsClosed() || factory.closeFault())) retire = true;
  }
  process.send?.(retire ? { id, retire } : { id, value, error, errorKind }, (sendError) => {
    if (sendError) process.exit(1);
  });
});
