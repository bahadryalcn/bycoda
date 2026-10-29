import { Worker } from "node:worker_threads";
import { once } from "node:events";
import assert from "node:assert/strict";
import { loadPhysicalStoreAdmission } from "../../index.mjs";
const [artifact, registryPath, file] = process.argv.slice(2);
// The first and ONLY native-addon environment here is the worker until EXIT.
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  execArgv: [],
  workerData: { artifact, registry: registryPath, file },
});
const exited = once(worker, "exit"),
  [message] = await once(worker, "message");
assert.equal(message.acquired, true);
assert.equal((await exited)[0], 0);
// Now load it in another environment. The original strong registry must survive,
// not merely leak an OS descriptor while resetting its bounded accounting.
const native = loadPhysicalStoreAdmission(artifact),
  registry = native.openRegistry(registryPath);
assert.equal(registry.statistics().processActive, 1);
const binding = registry.bindFile(file),
  closing = binding.tryBeginClose();
assert.ok(closing);
assert.equal(binding.tryUpgrade(closing), null);
binding.releaseClosing(closing);
console.log(
  JSON.stringify({
    workerExited: true,
    originalRegistrySurvived: true,
    active: registry.statistics().processActive,
  }),
);
