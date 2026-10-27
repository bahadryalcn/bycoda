import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/i;
const testFile = /(?:^|[./])(?:[^/]+\.)?(?:test|spec|bench|stories)\.[cm]?[jt]sx?$/i;
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const slash = (value) => value.split(path.sep).join("/");
const inside = (file, directory) => {
  const relative = path.relative(directory, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};
const within = (file, directory) => file === directory || file.startsWith(`${directory}/`);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(file);
      return sourceExtensions.test(entry.name) && !testFile.test(entry.name) ? [file] : [];
    })
    .sort();
}

function compilerOptions(root) {
  const config = path.join(root, "tsconfig.json");
  const fallback = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    baseUrl: root,
    paths: { "@/*": ["src/*"] },
  };
  if (!fs.existsSync(config)) return fallback;
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
      },
    },
  );
  if (!parsed) throw new Error("Could not read repository TypeScript configuration");
  const error = parsed.errors.find(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 18003,
  );
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, " "));
  return { ...fallback, ...parsed.options };
}

function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function dependencies(source) {
  const edges = [];
  let checker;
  const locallyBoundRequire = (node) => {
    if (!checker) {
      const options = { noLib: true, noResolve: true, types: [], allowJs: true };
      const host = ts.createCompilerHost(options);
      host.getSourceFile = (name) => (name === source.fileName ? source : undefined);
      checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
    }
    return (
      checker
        .getSymbolAtLocation(node)
        ?.declarations?.some(
          (declaration) =>
            declaration.getSourceFile() === source &&
            !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient),
        ) ?? false
    );
  };
  const add = (node, value, kind) =>
    edges.push({
      specifier: value,
      kind,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier)
        add(
          node,
          literal(node.moduleSpecifier),
          ts.isImportDeclaration(node) ? "import" : "export",
        );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, literal(node.moduleReference.expression), "import-equals");
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node, literal(node.argument.literal), "import-type");
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require" &&
          !locallyBoundRequire(node.expression)))
    ) {
      add(
        node,
        literal(node.arguments[0]),
        node.expression.kind === ts.SyntaxKind.ImportKeyword ? "dynamic-import" : "require",
      );
    } else if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      add(node, "implicit-jsx-runtime", "jsx");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const reference of source.typeReferenceDirectives)
    edges.push({
      specifier: reference.fileName,
      kind: "type-reference",
      line: source.getLineAndCharacterOfPosition(reference.pos).line + 1,
    });
  for (const reference of source.referencedFiles)
    edges.push({
      specifier: reference.fileName.startsWith(".")
        ? reference.fileName
        : `./${reference.fileName}`,
      kind: "file-reference",
      line: source.getLineAndCharacterOfPosition(reference.pos).line + 1,
    });
  for (const reference of source.libReferenceDirectives)
    if (!/^es\d+(?:\.[a-z0-9.]+)?$/i.test(reference.fileName))
      edges.push({
        specifier: `typescript-lib:${reference.fileName}`,
        kind: "lib-reference",
        line: source.getLineAndCharacterOfPosition(reference.pos).line + 1,
      });
  return edges;
}

function localAlias(specifier, options) {
  return Object.keys(options.paths ?? {}).some((pattern) => {
    const index = pattern.indexOf("*");
    return index < 0
      ? pattern === specifier
      : specifier.startsWith(pattern.slice(0, index)) &&
          specifier.endsWith(pattern.slice(index + 1));
  });
}

function localReason(file, mode) {
  if (testFile.test(file)) return "Production code cannot depend on a test/fixture module";
  if (/(?:^|\/)node_modules\//.test(file))
    return "Local traversal into node_modules bypasses the package allowlist";
  if (/\.node\.[cm]?[jt]sx?$/i.test(file))
    return "Node-specific implementation cannot enter portable/domain code";
  if (
    within(file, "src/shared/ui") ||
    within(file, "src/shared/hooks") ||
    within(file, "src/shared/theme") ||
    within(file, "src/shared/i18n")
  )
    return "UI, hooks, theme and localization belong outside neutral/domain code";
  if (within(file, "src/shared")) return undefined;
  if (mode === "domain" && within(file, "host/domains")) return undefined;
  return mode === "neutral"
    ? "Neutral code may traverse only portable src/shared modules and JSON"
    : "Host domains may depend only on domain/port modules and portable shared code";
}

/**
 * Check the full local dependency closure, including type-only and dynamic edges.
 * Dependencies of the explicitly allowed portable zod package are not project-owned
 * source; package suitability/version audits remain dependency-owner responsibility.
 */
export function checkHostRuntimeBoundaries({
  root = defaultRoot,
  neutralRoots = ["src/shared/model/host-contracts", "src/shared/lib/host-runtime"],
  domainRoots = ["host/domains"],
} = {}) {
  root = fs.realpathSync(root);
  const options = compilerOptions(root);
  const findings = [];
  const checked = new Set();
  const seen = new Set();
  const sourceCache = new Map();
  const moduleCache = ts.createModuleResolutionCache(
    root,
    (file) => (ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    options,
  );
  const report = (file, edge, chain, message, kind = "forbidden-import") => {
    findings.push({
      file: slash(path.relative(root, file)),
      line: edge.line,
      specifier: edge.specifier ?? "<computed>",
      kind,
      message,
      chain,
    });
  };
  const load = (file) => {
    if (!sourceCache.has(file))
      sourceCache.set(
        file,
        ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
      );
    return sourceCache.get(file);
  };
  const visit = (file, mode, chain) => {
    file = fs.realpathSync(file);
    const relative = slash(path.relative(root, file));
    const key = `${mode}:${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    checked.add(relative);
    if (file.endsWith(".json")) {
      try {
        JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        report(
          file,
          { line: 1, specifier: relative },
          chain,
          "Invalid imported JSON",
          "parse-error",
        );
      }
      return;
    }
    const source = load(file);
    for (const diagnostic of source.parseDiagnostics)
      report(
        file,
        {
          line: source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1,
          specifier: relative,
        },
        chain,
        ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
        "parse-error",
      );
    for (const edge of dependencies(source)) {
      const specifier = edge.specifier;
      if (edge.kind === "jsx") {
        report(file, edge, chain, "JSX rendering belongs outside portable/domain code");
        continue;
      }
      if (specifier === undefined) {
        report(
          file,
          edge,
          chain,
          "Computed module loading cannot be proven portable",
          "computed-import",
        );
        continue;
      }
      if (
        specifier.startsWith("node:") ||
        builtins.has(specifier) ||
        specifier.startsWith("typescript-lib:")
      ) {
        report(
          file,
          edge,
          chain,
          "Platform/builtin dependencies belong behind an injected adapter",
        );
        continue;
      }
      const likelyLocal =
        specifier.startsWith(".") || path.isAbsolute(specifier) || localAlias(specifier, options);
      if (!likelyLocal) {
        if (specifier === "zod" || specifier.startsWith("zod/")) continue;
        report(
          file,
          edge,
          chain,
          "Only the portable zod package is allowed here; inject platform/domain ports",
        );
        continue;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        file,
        options,
        ts.sys,
        moduleCache,
      ).resolvedModule;
      if (!resolved || !fs.existsSync(resolved.resolvedFileName)) {
        report(file, edge, chain, "Unresolved local dependency", "unresolved-import");
        continue;
      }
      const target = fs.realpathSync(resolved.resolvedFileName);
      if (!inside(target, root)) {
        report(file, edge, chain, "Dependency escapes the repository boundary", "outside-root");
        continue;
      }
      const targetName = slash(path.relative(root, target));
      const reason = localReason(targetName, mode);
      if (reason) {
        report(file, edge, [...chain, targetName], reason);
        continue;
      }
      if (!sourceExtensions.test(target) && !target.endsWith(".json")) {
        report(file, edge, chain, "Only source modules and JSON belong in this graph");
        continue;
      }
      visit(target, mode, [...chain, targetName]);
    }
  };
  for (const [mode, directories] of [
    ["neutral", neutralRoots],
    ["domain", domainRoots],
  ])
    for (const directory of directories)
      for (const file of walk(path.resolve(root, directory)))
        visit(file, mode, [slash(path.relative(root, file))]);
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.specifier.localeCompare(b.specifier),
  );
  return { ok: findings.length === 0, findings, checkedFiles: [...checked].sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkHostRuntimeBoundaries();
    for (const finding of result.findings)
      console.error(
        `${finding.file}:${finding.line} ${finding.kind}: ${finding.specifier} — ${finding.message}\n  ${finding.chain.join(" -> ")}`,
      );
    console.log(
      `Host runtime boundaries: ${result.checkedFiles.length} files, ${result.findings.length} findings`,
    );
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Host runtime boundary check failed");
    process.exitCode = 1;
  }
}
