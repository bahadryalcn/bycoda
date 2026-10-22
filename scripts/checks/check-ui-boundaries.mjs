import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inventoryUi, uiFingerprint } from "./inventory-ui.mjs";

/** Column names keep review tables readable; repeated explanations live once in reasons. */
export function decodeReviewBaseline(baseline) {
  if (baseline.schemaVersion === 1) return baseline;
  if (baseline.schemaVersion !== 2) throw new Error("Unsupported UI baseline schema");
  if (
    !Array.isArray(baseline.reasons) ||
    baseline.reasons.some((reason) => typeof reason !== "string")
  )
    throw new Error("Invalid UI review reasons");
  const result = { ...baseline, schemaVersion: 1 };
  delete result.reasons;
  for (const kind of ["componentDecisions", "entries"]) {
    const table = baseline[kind];
    if (
      !Array.isArray(table?.columns) ||
      table.columns.some((column) => typeof column !== "string" || column === "reason") ||
      new Set(table.columns).size !== table.columns.length ||
      !table.columns.includes("reasonIndex") ||
      !Array.isArray(table.rows)
    )
      throw new Error(`Invalid UI review table: ${kind}`);
    result[kind] = table.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== table.columns.length)
        throw new Error(`Invalid UI review row: ${kind}`);
      return Object.fromEntries(
        table.columns.flatMap((column, index) => {
          const value = row[index];
          if (column === "reasonIndex") {
            if (!Number.isInteger(value) || value < 0 || value >= baseline.reasons.length)
              throw new Error(`Invalid UI review reason reference: ${kind}`);
            return [["reason", baseline.reasons[value]]];
          }
          return value === null ? [] : [[column, value]];
        }),
      );
    });
  }
  return result;
}

/** Source signals require a reviewed semantic owner, never a raw-tag ban. */
export function collectUiFindings(inventory) {
  const findings = [];
  for (const source of inventory.sources.filter((item) =>
    ["app", "feature"].includes(item.scope),
  )) {
    for (const [field, kind] of [
      ["nativeControls", "native-control"],
      ["interactiveElements", "native-interaction"],
      ["registryImports", "registry-import"],
      ["presentationOverrides", "control-presentation"],
    ])
      for (const item of source[field]) {
        // Icon/text renderers carry content colors and typography, not control skins.
        const imported = source.sharedControls.find(
          (control) => control.line === item.line && control.tag === item.tag,
        );
        if (
          kind === "control-presentation" &&
          imported &&
          /^src\/shared\/ui\/(?:icons|MatchText|TabLabel|ParticleText|Shimmer)$/.test(
            imported.module,
          )
        )
          continue;
        findings.push({
          file: source.file,
          kind,
          fingerprint: item.fingerprint ?? uiFingerprint(item.module),
          line: item.line,
        });
      }
  }
  for (const source of inventory.styles.filter((item) => ["app", "feature"].includes(item.scope)))
    for (const [field, kind] of [
      ["localColorRecipes", "color-recipe"],
      ["controlSelectors", "control-style"],
    ])
      for (const item of source[field])
        findings.push({ file: source.file, kind, fingerprint: item.fingerprint, line: item.line });
  return findings;
}

export function compareUiFindings(findings, baseline) {
  const counts = new Map();
  const key = (item) => `${item.file}|${item.kind}|${item.fingerprint}`;
  for (const entry of baseline.entries ?? []) {
    if (
      !entry.owner?.trim() ||
      !entry.reason?.trim() ||
      !["native-platform-editor-owner", "shared-composition", "content"].includes(entry.decision) ||
      !Number.isInteger(entry.count) ||
      entry.count < 1
    )
      throw new Error(`Invalid UI review entry: ${entry.file}`);
    if (counts.has(key(entry))) throw new Error(`Duplicate UI review entry: ${entry.file}`);
    counts.set(key(entry), entry.count);
  }
  return findings.filter((item) => {
    const remaining = counts.get(key(item)) ?? 0;
    counts.set(key(item), remaining - 1);
    return remaining <= 0;
  });
}

export function validateComponentDecisions(baseline) {
  const decisions = baseline.componentDecisions;
  if (
    !Array.isArray(decisions) ||
    !Number.isInteger(baseline.historicalCandidateCount) ||
    baseline.historicalCandidateCount < 1 ||
    decisions.filter((item) => item.indexed === true).length !== baseline.historicalCandidateCount
  )
    throw new Error("Incomplete historical UI component review");
  const keys = new Set();
  for (const item of decisions) {
    const key = `${item.file}|${item.name}`;
    if (
      keys.has(key) ||
      !item.file ||
      !item.name ||
      !item.owner?.trim() ||
      !item.reason?.trim() ||
      !["migrate", "extract", "native-platform-editor-owner"].includes(item.decision) ||
      !["current", "removed"].includes(item.definition) ||
      (item.definition === "current" && !/^[a-f0-9]{64}$/.test(item.sourceFingerprint ?? ""))
    )
      throw new Error(`Invalid UI component review: ${key}`);
    keys.add(key);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const baselinePath = path.join(root, "scripts/checks/ui-reviewed-baseline.json");
  if (!fs.existsSync(baselinePath)) {
    console.error(
      "UI boundary review baseline is not complete. Review source owners before creating it; inventory counts are not approvals.",
    );
    process.exitCode = 1;
  } else {
    const baseline = decodeReviewBaseline(JSON.parse(fs.readFileSync(baselinePath, "utf8")));
    validateComponentDecisions(baseline);
    const pending = compareUiFindings(collectUiFindings(inventoryUi(root)), baseline);
    for (const item of pending)
      console.error(`${item.file}:${item.line} unreviewed ${item.kind} (${item.fingerprint})`);
    if (pending.length) process.exitCode = 1;
    else
      console.log(
        "UI boundary signals match their reviewed owners. This check does not replace interaction, theme or native acceptance.",
      );
  }
}
