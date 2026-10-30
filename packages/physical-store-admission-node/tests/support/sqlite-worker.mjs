import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const database = new DatabaseSync(workerData.file, {
  allowExtension: true,
  readOnly: true,
});
try {
  database.loadExtension(workerData.artifact, workerData.entryPoint);
  database.enableLoadExtension(false);
  parentPort.postMessage(
    JSON.parse(
      database.prepare("SELECT bycoda_connection_identity() AS value").get()
        .value,
    ),
  );
} finally {
  database.close();
  parentPort.close();
}
