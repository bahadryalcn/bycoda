import { parentPort, workerData } from "node:worker_threads";
import { loadPhysicalStoreAdmission } from "../../index.mjs";
const native = loadPhysicalStoreAdmission(workerData.artifact);
const registry = native.openRegistry(workerData.registry);
const binding = registry.bindFile(workerData.file);
const held = binding.tryWriter();
if (!held) throw new Error("fixture writer was not acquired");
parentPort.postMessage({
  acquired: true,
  identity: binding.identity(),
  stats: registry.statistics(),
});
// Actual environment cleanup follows. No token is serialized or released.
parentPort.close();
