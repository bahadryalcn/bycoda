import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildIdentityManifest } from "./workspace-service-contracts";
import type { BuildIdentity } from "./workspace-contracts";
import {
  captureBuildIdentity,
  parseBuildIdentity,
  readBuildIdentity,
} from "../scripts/build/build-info.mjs";

export class BuildIdentityService implements BuildIdentityManifest {
  capture = captureBuildIdentity;
  read = readBuildIdentity;
}

/** Only package-adjacent metadata describes this executable. Never infer it from cwd. */
export function readHostBuildIdentity(
  entry = process.argv[1] ?? fileURLToPath(import.meta.url),
): BuildIdentity | null {
  try {
    return parseBuildIdentity(
      JSON.parse(readFileSync(join(dirname(entry), "version.json"), "utf8")).buildIdentity,
    );
  } catch {
    return null;
  }
}
