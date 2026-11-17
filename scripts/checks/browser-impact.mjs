// Which browser suites a set of changed files can affect, by static import graph: each
// suite's fixture HTML entry and its relative imports, plus the suite's own spec files.
// Only relative specifiers are followed (packages are not product source), so a scan of the
// whole manifest reads each source file once and finishes in well under a second.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx"];
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const SCRIPT_SRC = /<script[^>]+src=["']([^"']+)["']/g;

function resolveImport(root, from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.join(path.posix.dirname(from), specifier.replace(/\?.*$/, ""));
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (/\.[cm]?[jt]sx?$|\.css$/.test(candidate) && existsSync(path.join(root, candidate)))
      return candidate;
  }
  return null;
}

/**
 * All repository files a suite's fixture loads, starting from its HTML entry. `edges` caches
 * each file's resolved imports, so a scan over many suites reads and resolves a file once.
 */
export function fixtureGraph(root, suite, edges = new Map()) {
  const entry = suite.fixture?.path?.replace(/^\//, "");
  const seen = new Set();
  if (!entry || !existsSync(path.join(root, entry))) return seen;
  const importsOf = (file) => {
    if (!edges.has(file)) {
      const text = readFileSync(path.join(root, file), "utf8");
      const pattern = file.endsWith(".html") ? SCRIPT_SRC : IMPORT;
      edges.set(
        file,
        file.endsWith(".css")
          ? []
          : [...text.matchAll(pattern)]
              .map((match) => resolveImport(root, file, match[1] ?? match[2] ?? match[3]))
              .filter(Boolean),
      );
    }
    return edges.get(file);
  };
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) if (!seen.has(next)) pending.push(next);
  }
  return seen;
}

/**
 * Suites touched by `files`, nearest first: a changed spec or fixture-folder file selects its
 * own suite; a changed product file selects suites whose fixture imports it. At most `limit`
 * run; the rest are named so the report says what CI still owns.
 */
export function browserImpact(files, { root, manifest, limit = 3 }) {
  const edges = new Map();
  const scored = [];
  for (const suite of manifest.suites) {
    const folder = path.posix.dirname(suite.config);
    const area = path.posix.basename(folder);
    const specs = new Set(suite.files.map((file) => `${folder}/${file}`));
    let score = 0;
    let graph;
    for (const file of files) {
      if (specs.has(file)) score = Math.max(score, 4);
      else if (file.startsWith(`${folder}/`)) score = Math.max(score, 3);
      else if (/^(?:src|packages)\/.*\.(?:[cm]?[jt]sx?|css)$/.test(file)) {
        graph ??= fixtureGraph(root, suite, edges);
        if (!graph.has(file)) continue;
        // Feature barrels make most fixtures reach most files; the feature's own browser
        // folder is the nearest owner of a change inside that feature.
        const feature = /^src\/features\/([^/]+)\//.exec(file)?.[1];
        score = Math.max(score, feature === area ? 2 : 1);
      }
    }
    // Smaller graphs exercise the change more directly than whole-app fixtures.
    if (score) scored.push({ id: suite.id, score, size: graph?.size ?? 0 });
  }
  scored.sort((a, b) => b.score - a.score || a.size - b.size || a.id.localeCompare(b.id));
  // Owners (the changed spec, its fixture folder, or the feature's own browser folder) run.
  // Suites reached only through shared imports run only when there are few of them; a broad
  // shared change is left to CI instead of a few arbitrary suites.
  const owners = scored.filter((suite) => suite.score >= 2);
  const chosen = owners.length ? owners : scored.length <= limit ? scored : [];
  const run = chosen.slice(0, limit).map((suite) => suite.id);
  return { run, deferred: scored.map((suite) => suite.id).filter((id) => !run.includes(id)) };
}
