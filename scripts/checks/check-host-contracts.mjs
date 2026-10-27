import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import { format } from "oxfmt";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = resolve(root, "src/shared/model/host-contracts/generated/manifest.json");
const write = process.argv.includes("--write");
if (process.argv.slice(2).some((argument) => argument !== "--write"))
  throw new Error("Usage: node scripts/checks/check-host-contracts.mjs [--write]");

// Bundle only the pure schema source in memory: no app/Host outputs are changed.
const built = await build({
  absWorkingDir: root,
  entryPoints: ["src/shared/model/host-contracts/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "silent",
});
const source = Buffer.from(built.outputFiles[0].contents).toString("base64");
let manifest;
try {
  const { exportHostContractManifest } = await import(`data:text/javascript;base64,${source}`);
  manifest = exportHostContractManifest();
} catch (error) {
  // An uncaught data-URL stack prints the entire bundled source for each frame.
  console.error(
    `Host contract export failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exit(1);
}
const schemaHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const { printWidth, tabWidth, endOfLine } = JSON.parse(
  await readFile(resolve(root, ".oxfmtrc.json"), "utf8"),
);
const formatted = await format(target, JSON.stringify({ ...manifest, schemaHash }), {
  printWidth,
  tabWidth,
  endOfLine,
});
if (formatted.errors.length) throw new Error("Host schema manifest could not be formatted.");
const expected = formatted.code;

if (write) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, expected);
  console.log(`Generated Host schema manifest ${schemaHash.slice(0, 12)}.`);
} else {
  let actual;
  try {
    actual = await readFile(target, "utf8");
  } catch {
    throw new Error("Host schema manifest is missing. Run check:host-contracts:write.");
  }
  if (actual !== expected)
    throw new Error("Host schema manifest is stale. Regenerate it and review the contract diff.");
  console.log(`Host schema manifest is current (${schemaHash.slice(0, 12)}).`);
}
