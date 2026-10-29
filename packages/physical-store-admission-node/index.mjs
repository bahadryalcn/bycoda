import { createRequire } from "node:module";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, extname } from "node:path";

const require = createRequire(import.meta.url);
/** Private trusted-artifact loader. No discovery, GUI/profile lookup or fallback. */
export function loadPhysicalStoreAdmission(explicitArtifact) {
  if (
    typeof explicitArtifact !== "string" ||
    !isAbsolute(explicitArtifact) ||
    extname(explicitArtifact) !== ".node"
  )
    throw new TypeError("An explicit absolute .node artifact path is required");
  const canonical = realpathSync(explicitArtifact);
  if (extname(canonical) !== ".node")
    throw new TypeError("The resolved physical admission artifact must have a .node extension");
  if (!statSync(canonical).isFile())
    throw new TypeError("Physical admission artifact must be a regular file");
  const native = require(canonical);
  if (native.mechanicalAbiVersion?.() !== 1 || typeof native.openRegistry !== "function")
    throw new Error("Unsupported physical admission mechanical ABI");
  return Object.freeze({
    mechanicalAbiVersion: native.mechanicalAbiVersion,
    openRegistry: native.openRegistry,
  });
}
