import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const hostTestRoot = fileURLToPath(new URL("../../", import.meta.url));
const reviewed = JSON.parse(
  readFileSync(new URL("./host-portable-tests.json", import.meta.url), "utf8"),
);

export function portableHostTests(root = hostTestRoot, manifest = reviewed) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tests))
    throw new Error("Invalid reviewed Host test manifest");
  const portable = [];
  const seen = new Set();
  for (const entry of manifest.tests) {
    if (
      !/^host\/.+\.test\.ts$/.test(entry.file) ||
      seen.has(entry.file) ||
      !entry.sources?.[entry.file]
    )
      throw new Error(`Invalid or duplicate reviewed Host test: ${entry.file}`);
    seen.add(entry.file);
    const unchanged = Object.entries(entry.sources).every(([file, expected]) => {
      const source = resolve(root, file);
      const local = relative(root, source);
      if (
        isAbsolute(local) ||
        local === ".." ||
        local.startsWith("../") ||
        local.startsWith("..\\")
      )
        throw new Error(`Reviewed Host input escapes repository: ${file}`);
      try {
        // Git checkouts may use CRLF. Line endings do not change this review.
        const text = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
        return createHash("sha256").update(text).digest("hex") === expected;
      } catch {
        return false;
      }
    });
    if (unchanged) portable.push(entry.file);
  }
  return portable.sort();
}

export function hostTestSelection(scope = "all", root = hostTestRoot, manifest = reviewed) {
  if (!["all", "portable", "integration"].includes(scope))
    throw new Error(`Unknown BYCODA_HOST_TEST_SCOPE: ${scope}`);
  if (scope === "all") return { include: ["host/**/*.test.ts"], exclude: [] };
  const portable = portableHostTests(root, manifest);
  return scope === "portable"
    ? {
        include: portable.length ? portable : ["host/__no_reviewed_portable_tests__.test.ts"],
        exclude: [],
      }
    : { include: ["host/**/*.test.ts"], exclude: portable };
}
