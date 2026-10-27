import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
try {
  const database = new DatabaseSync(workerData.path, { readOnly: !workerData.finalize });
  try {
    // Only the newly captured copy is finalized; the live source is never opened here.
    if (workerData.finalize) database.exec("PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE");
    const rows = database.prepare("PRAGMA quick_check").all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
      throw new Error("Snapshot integrity verification failed.");
    const schema = database
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
    parentPort.postMessage({ schema });
  } finally {
    database.close();
  }
} catch {
  parentPort.postMessage({ error: "Snapshot integrity verification failed." });
}
