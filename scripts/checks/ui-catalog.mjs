import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

export const UI_CATALOG_DOC = "docs/reference/ui-components.md";
export const UI_CATALOG_GROUPS = [
  "actions",
  "fields",
  "choice",
  "overlay",
  "layout",
  "feedback",
  "data",
  "text",
  "media",
  "navigation",
];
const EXCLUDED_FILE = /(?:\.test\.|Specimen|^ControlBehaviorMatrix\.tsx$|^icons\.tsx$)/;
const isComponentName = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
const isComponentInit = (init) =>
  Boolean(init) &&
  (ts.isArrowFunction(init) ||
    ts.isFunctionExpression(init) ||
    (ts.isIdentifier(init) && isComponentName(init.text)) ||
    ts.isCallExpression(init) ||
    ((ts.isParenthesizedExpression(init) || ts.isAsExpression(init)) &&
      isComponentInit(init.expression)));
const text = (comment) => (comment ? (ts.getTextOfJSDocComment(comment) ?? "") : "").trim();
const oneLine = (value) => value.replace(/\s+/g, " ").trim();

function readJsDoc(node) {
  const block = node.jsDoc?.at(-1);
  const meta = { summary: "", tags: {} };
  if (!block) return meta;
  meta.summary = oneLine(text(block.comment));
  for (const tag of block.tags ?? []) meta.tags[tag.tagName.text] = oneLine(text(tag.comment));
  return meta;
}

function entryFrom(name, file, node) {
  const { summary, tags } = readJsDoc(node);
  return {
    name,
    file,
    group: tags.group ?? "",
    use: tags.use ?? "",
    avoid: tags.avoid ?? "",
    replaces: (tags.replaces ?? "").split(/\s+/).filter(Boolean),
    instead: tags.instead ?? "",
    status: tags.status || "stable",
    arc: tags.arc ?? "",
    summary,
  };
}

export function readUiCatalogSource(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const exported = (node) =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const entries = [];
  for (const statement of ast.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const name = ts.isIdentifier(statement.expression)
        ? statement.expression.text
        : path.posix.basename(file, ".tsx");
      if (isComponentName(name) && isComponentInit(statement.expression)) {
        const local = ast.statements.find(
          (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
        );
        if (!entries.some((entry) => entry.name === name))
          entries.push(
            entryFrom(name, file, statement.jsDoc?.length ? statement : (local ?? statement)),
          );
      }
      continue;
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const item of statement.exportClause.elements) {
        if (item.isTypeOnly || !isComponentName(item.name.text)) continue;
        const original = (item.propertyName ?? item.name).text;
        const local = ast.statements.find(
          (node) =>
            (ts.isFunctionDeclaration(node) && node.name?.text === original) ||
            (ts.isVariableStatement(node) &&
              node.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) &&
                  declaration.name.text === original &&
                  isComponentInit(declaration.initializer),
              )),
        );
        const typeOnly = ast.statements.some(
          (node) =>
            ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
              node.name.text === original) ||
            (ts.isImportDeclaration(node) &&
              node.importClause?.isTypeOnly &&
              node.importClause.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings) &&
              node.importClause.namedBindings.elements.some(
                (binding) => binding.name.text === original,
              )),
        );
        if (!typeOnly)
          entries.push(
            entryFrom(
              item.name.text,
              file,
              statement.jsDoc?.length ? statement : (local ?? statement),
            ),
          );
      }
      continue;
    }
    if (!exported(statement)) continue;
    if (
      ts.isFunctionDeclaration(statement) &&
      (!statement.name || isComponentName(statement.name.text))
    )
      entries.push(
        entryFrom(statement.name?.text ?? path.posix.basename(file, ".tsx"), file, statement),
      );
    else if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          isComponentName(declaration.name.text) &&
          isComponentInit(declaration.initializer)
        )
          entries.push(entryFrom(declaration.name.text, file, statement));
  }
  return entries;
}

export function readUiCatalog(root = process.cwd()) {
  const directory = path.join(root, "src/shared/ui");
  const entries = [];
  for (const name of fs.readdirSync(directory).sort()) {
    if (!name.endsWith(".tsx") || EXCLUDED_FILE.test(name)) continue;
    const file = `src/shared/ui/${name}`;
    entries.push(...readUiCatalogSource(file, fs.readFileSync(path.join(directory, name), "utf8")));
  }
  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export function validateUiCatalog(entries) {
  const problems = [];
  const names = new Set(entries.map((entry) => entry.name));
  const claimed = new Map();
  for (const entry of entries) {
    const problem = (message) =>
      problems.push({ file: entry.file, name: entry.name, problem: message });
    if (!entry.summary) problem("missing summary (leading JSDoc text)");
    if (!["stable", "deprecated", "internal"].includes(entry.status))
      problem(`unknown @status "${entry.status}"`);
    if (!entry.group) problem("missing @group");
    if (!entry.use) problem("missing @use");
    if (entry.status !== "internal") {
      if (!entry.avoid) problem("missing @avoid");
    }
    const siblings = entries.filter(
      (other) => other.name !== entry.name && other.group === entry.group,
    );
    if (
      entry.group &&
      siblings.length &&
      !siblings.some((other) =>
        new RegExp(`\\b${other.name}\\b`).test(`${entry.avoid} ${entry.replaces.join(" ")}`),
      )
    )
      problems.push({
        file: entry.file,
        name: entry.name,
        rule: "component-family-choice",
        problem: `@avoid or @replaces must name a sibling in @group ${entry.group}; choose between ${siblings.map((other) => other.name).join(", ")}`,
      });
    if (entry.group && !UI_CATALOG_GROUPS.includes(entry.group))
      problem(`unknown @group "${entry.group}"`);
    if (entry.status === "deprecated" && !entry.instead) problem("deprecated without @instead");
    if (entry.instead && !names.has(entry.instead))
      problem(`@instead names unknown component "${entry.instead}"`);
    for (const token of entry.replaces) {
      if (
        !/^[a-z][a-z0-9]*$/.test(token) &&
        !/^role=[a-z]+$/.test(token) &&
        !/^input\[type=(?:date|time|datetime-local)\]$/.test(token) &&
        !names.has(token)
      )
        problem(`invalid @replaces token "${token}"`);
      if (names.has(token)) continue;
      const owner = claimed.get(token);
      if (owner && owner !== entry.name)
        problem(`@replaces "${token}" is also claimed by ${owner}`);
      else claimed.set(token, entry.name);
    }
  }
  return problems;
}

/** Runtime entry points with no static consumer. Every exception must explain its owner. */
export const orphanAllowlist = {};

/** Static module edges, including aliases, namespaces, re-exports and lazy imports. */
export function findOrphanComponents(entries, sources, allowlist = orphanAllowlist) {
  const used = new Set();
  for (const [file, source] of sources) {
    if (
      /(?:^|\/)(?:__tests__|__fixtures__|fixtures|test-support)\/|\.(?:test|spec|stories|fixture|test-support)\.|Specimen|ControlBehaviorMatrix/.test(
        file,
      )
    )
      continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      let specifier;
      let names = null;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        if (node.isTypeOnly || (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly))
          return;
        specifier = node.moduleSpecifier.text;
        const bindings = ts.isImportDeclaration(node)
          ? node.importClause?.namedBindings
          : node.exportClause;
        if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)))
          names = bindings.elements
            .filter((item) => !item.isTypeOnly)
            .map((item) => (item.propertyName ?? item.name).text);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        specifier = node.arguments[0].text;
      if (specifier) {
        const target = (
          specifier.startsWith(".")
            ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
            : specifier.replace(/^@\//, "src/")
        ).replace(/\.(?:[cm]?[jt]sx?)$/, "");
        for (const entry of entries)
          if (
            entry.file !== file &&
            entry.file.replace(/\.tsx$/, "") === target &&
            (!names || names.includes(entry.name))
          )
            used.add(`${entry.file}#${entry.name}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return entries
    .filter((entry) => {
      const key = `${entry.file}#${entry.name}`;
      if (key in allowlist && !allowlist[key]?.trim())
        throw new Error(`Orphan exception ${key} needs a reason`);
      return !used.has(key) && !allowlist[key];
    })
    .map((entry) => ({
      file: entry.file,
      name: entry.name,
      rule: "component-orphan",
      problem: `No product importer for ${entry.name}; remove it, use the owning shared component, or add a reason to orphanAllowlist for a runtime entry point`,
    }));
}

/** Catalog debt shares the UI drift ratchet; new metadata and orphan regressions fail both checks. */
export function catalogFindings(entries, sources) {
  return [
    ...validateUiCatalog(entries).map((problem) => ({
      ...problem,
      rule: problem.rule ?? "component-metadata",
    })),
    ...findOrphanComponents(entries, sources),
  ].map((problem) => ({ ...problem, line: 1, text: `${problem.name}: ${problem.problem}` }));
}

const cell = (value) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const title = (group) => group[0].toUpperCase() + group.slice(1);
const link = (entry) => `[${entry.name}](../../${entry.file})`;

export function renderUiCatalog(entries) {
  const lines = [
    "# UI components",
    "",
    "Generated by `pnpm check:ui-catalog --write` from the JSDoc in `src/shared/ui`; do not edit by hand.",
    "",
    "## How to use",
    "",
    "1. Find the need in the group tables below.",
    "2. Open the component and read its JSDoc for props and behavior.",
    "3. Raw tags in the Replaces column are banned outside `src/shared/ui` by `pnpm check:ui-drift`.",
    "",
  ];
  const groups = [...new Set(entries.map((entry) => entry.group || "ungrouped"))].sort(
    (a, b) => (UI_CATALOG_GROUPS.indexOf(a) + 1 || 99) - (UI_CATALOG_GROUPS.indexOf(b) + 1 || 99),
  );
  for (const group of groups) {
    const inGroup = entries.filter((entry) => (entry.group || "ungrouped") === group);
    const rows = inGroup.filter((entry) => entry.status === "stable");
    const parts = inGroup.filter((entry) => entry.status === "internal");
    if (!rows.length && !parts.length) continue;
    lines.push(`## ${title(group)}`, "");
    if (rows.length) {
      lines.push("| Component | Use for | Not for | Replaces |", "| --- | --- | --- | --- |");
      for (const entry of rows)
        lines.push(
          `| ${link(entry)} | ${cell(entry.use)} | ${cell(entry.avoid)} | ${cell(entry.replaces.map((token) => `\`${token}\``).join(" "))} |`,
        );
      lines.push("");
    }
    if (parts.length) lines.push(`Parts: ${parts.map((entry) => entry.name).join(", ")}`, "");
  }
  const deprecated = entries.filter((entry) => entry.status === "deprecated");
  if (deprecated.length) {
    lines.push("## Deprecated", "", "| Component | Use instead |", "| --- | --- |");
    for (const entry of deprecated) lines.push(`| ${link(entry)} | ${cell(entry.instead)} |`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function runUiCatalog({ root = process.cwd(), write = false } = {}) {
  const entries = readUiCatalog(root);
  const sources = new Map();
  const walk = (directory) => {
    if (!fs.existsSync(path.join(root, directory))) return;
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${item.name}`;
      if (item.isDirectory() && item.name !== "node_modules") walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(item.name))
        sources.set(file, fs.readFileSync(path.join(root, file), "utf8"));
    }
  };
  walk("src");
  const allProblems = catalogFindings(entries, sources);
  const baselinePath = path.join(root, "scripts/checks/ui-drift-baseline.json");
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8")).counts
    : {};
  const seen = new Map();
  const problems = allProblems.filter((problem) => {
    const key = `${problem.file}#${problem.rule}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    // Existing structural metadata errors remain hard failures; only family migration debt ratchets.
    if (
      problem.rule === "component-metadata" &&
      !/^missing @(?:group|use|avoid)$/.test(problem.problem)
    )
      return true;
    return count > (baseline[problem.file]?.[problem.rule] ?? 0);
  });
  const rendered = renderUiCatalog(entries);
  const docFile = path.join(root, UI_CATALOG_DOC);
  const current = fs.existsSync(docFile)
    ? fs.readFileSync(docFile, "utf8").replace(/\r\n/g, "\n")
    : "";
  const stale = current !== rendered;
  if (write && stale) {
    fs.mkdirSync(path.dirname(docFile), { recursive: true });
    fs.writeFileSync(docFile, rendered);
  }
  return { entries, problems, allProblems, stale };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const write = process.argv.includes("--write");
  const { problems, stale } = runUiCatalog({ write });
  for (const { file, name, problem } of problems) console.error(`${file} ${name}: ${problem}`);
  if (problems.length) console.error(`${problems.length} UI catalog problem(s).`);
  if (stale && !write)
    console.error(`${UI_CATALOG_DOC} is stale; run \`pnpm check:ui-catalog --write\`.`);
  if (write && stale) console.log(`Wrote ${UI_CATALOG_DOC}.`);
  if (problems.length || (stale && !write)) process.exitCode = 1;
}
