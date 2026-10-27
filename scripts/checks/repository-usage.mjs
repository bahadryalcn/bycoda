/** Advisory only. Reuses the production import inventory, not a second boundary checker. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inventoryRepository } from "./repository-graph.mjs";
import { reviewQualityPatterns } from "./quality-patterns.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

function qualitySignals(directory, base) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return qualitySignals(file, base);
    return /\.[cm]?[jt]sx?$/.test(file)
      ? reviewQualityPatterns(
          fs.readFileSync(file, "utf8"),
          path.relative(base, file).replaceAll("\\", "/"),
        )
      : [];
  });
}

export function summarizeUsage(inventory, manifest) {
  const incoming = new Set(inventory.edges.map((edge) => edge.to));
  const embedded = new Set(
    inventory.nativeEmbeds.filter((embed) => embed.state === "present").map((embed) => embed.to),
  );
  const external = new Set(inventory.externalPackages);
  return {
    schemaVersion: 1,
    mode: "advisory; no deletion, exit-code gate, dependency installation or manifest mutation",
    scope: inventory.scope,
    limitations: [
      "Zero incoming static production imports does not mean unused. App/tool entrypoints, HTML, Vite, Rust, runtime registration, generated and computed resources require review.",
      "Dependency candidates exclude static production src/host imports only. Build/test/config/CLI/bin/peer/optional/platform consumers and the separate mobile repo are not classified as unused.",
      "No unused-export claim: reexports, public APIs, type-only consumers, reflective access and platform consumers require a symbol-aware owner review.",
      "Do not remove files or dependencies based on this report. Resolve dynamic/platform uncertainty and prove consumer behavior first.",
    ],
    counts: {
      productionModules: inventory.nodes.length,
      localEdges: inventory.edges.length,
      unresolvedImports: inventory.unresolved.length,
      nativeEmbeds: inventory.nativeEmbeds.length,
    },
    modulesWithoutInventoriedIncomingImports: inventory.nodes.filter(
      (node) => !incoming.has(node.path) && !embedded.has(node.path),
    ),
    dependenciesAbsentFromProductionImportInventory: Object.keys(manifest.dependencies ?? {})
      .filter((name) => !external.has(name))
      .sort(),
    unresolved: inventory.unresolved,
    nativeEmbeds: inventory.nativeEmbeds.filter((embed) => embed.state !== "present"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some((arg) => arg !== "--json"))
    throw new Error("Usage: node scripts/checks/repository-usage.mjs [--json]");
  const report = summarizeUsage(
    inventoryRepository(root),
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")),
  );
  report.qualityReviewSignals = ["src", "host"].flatMap((name) =>
    qualitySignals(path.join(root, name), root),
  );
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `${report.counts.productionModules} production modules; ${report.modulesWithoutInventoriedIncomingImports.length} without inventoried incoming imports; ${report.dependenciesAbsentFromProductionImportInventory.length} dependencies absent from production import inventory; ${report.counts.unresolvedImports} unresolved imports.`,
    );
    for (const limitation of report.limitations) console.log(limitation);
    console.log(
      `${report.qualityReviewSignals.length} advisory suppression/timer review signals; --json includes every location. Neither a new lint gate nor a flakiness verdict.`,
    );
    for (const item of report.modulesWithoutInventoriedIncomingImports)
      console.log(`review module\t${item.path}`);
    for (const name of report.dependenciesAbsentFromProductionImportInventory)
      console.log(`review dependency\t${name}`);
  }
}
