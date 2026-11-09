import { createInterface } from "node:readline";
import { loadPhysicalStoreAdmission } from "../../index.mjs";
const [artifact, root, file] = process.argv.slice(2);
const native = loadPhysicalStoreAdmission(artifact),
  registry = native.openRegistry(root),
  binding = registry.bindFile(file);
const held = binding.tryWriter();
if (!held) throw new Error("fixture writer unavailable");
console.log(JSON.stringify({ acquired: true, identity: binding.identity().nativeFormat }));
createInterface({ input: process.stdin }).once("line", () => process.exit(0));
