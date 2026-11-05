/** Check private workspace exports and every production dependency reachable from them. */
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

const rootDirectory = fileURLToPath(new URL("../../", import.meta.url));
const slash = (name) => name.replaceAll("\\", "/");
const inside = (file, root) => {
  const name = path.relative(root, file);
  return (
    name === "" || (!path.isAbsolute(name) && name !== ".." && !name.startsWith(`..${path.sep}`))
  );
};
const targets = (value) =>
  typeof value === "string"
    ? [value]
    : value && typeof value === "object"
      ? Object.values(value).flatMap(targets)
      : [];
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);

function moduleEdges(source) {
  const edges = [];
  const add = (node, expression) =>
    edges.push({
      specifier: literal(expression),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node, node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      add(node, node.arguments[0]);
      edges.at(-1).loadingKind =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ? "import" : "require";
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
      edges.push({ specifier: "<JSX>", line: 1 });
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const reference of source.typeReferenceDirectives)
    edges.push({ specifier: reference.fileName, line: 1, typeReference: true });
  for (const reference of source.libReferenceDirectives)
    if (!/^es\d+(?:\.[a-z0-9.]+)?$/i.test(reference.fileName))
      edges.push({ specifier: `typescript-lib:${reference.fileName}`, line: 1 });
  for (const reference of source.referencedFiles)
    edges.push({
      specifier: reference.fileName.startsWith(".")
        ? reference.fileName
        : `./${reference.fileName}`,
      line: 1,
    });
  return edges;
}

export function checkPackageBoundaries(root = rootDirectory) {
  root = fs.realpathSync(root);
  const findings = [];
  const checked = new Set();
  const packages = [];
  const report = (file, line, message, chain = []) =>
    findings.push({ file: slash(path.relative(root, file)), line, message, chain });
  for (const family of ["packages", "apps"]) {
    const directory = path.join(root, family);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, family, entry.name);
      const file = path.join(directory, "package.json");
      // Git cannot track an empty directory, so CI never sees one; ignoring it keeps
      // local results equal to CI. A directory with any content still needs a manifest.
      if (!fs.existsSync(file) && fs.readdirSync(directory).length === 0) continue;
      if (!fs.existsSync(file)) {
        report(file, 1, "Workspace directory has no package manifest");
        continue;
      }
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      if (manifest.private !== true)
        report(
          file,
          1,
          "Workspace modules must remain private until separately approved for publication",
        );
      packages.push({ directory: fs.realpathSync(directory), file, manifest, family });
    }
  }
  const byName = new Map(packages.map((item) => [item.manifest.name, item]));
  if (byName.size !== packages.length)
    report(path.join(root, "pnpm-workspace.yaml"), 1, "Duplicate workspace package name");
  const publicTargets = (owner, key) => {
    const declarations = owner.manifest.exports;
    const value =
      typeof declarations === "string"
        ? key === "."
          ? declarations
          : undefined
        : declarations?.[key];
    const result = [];
    for (const name of targets(value)) {
      const file = path.resolve(owner.directory, name);
      if (
        !name.startsWith("./") ||
        name.includes("*") ||
        !inside(file, owner.directory) ||
        !fs.existsSync(file)
      ) {
        report(owner.file, 1, `Invalid or escaping public export: ${key} -> ${name}`);
      } else {
        const real = fs.realpathSync(file);
        if (!inside(real, owner.directory) || !fs.statSync(real).isFile())
          report(owner.file, 1, `Public export escapes through a link: ${key}`);
        else result.push(real);
      }
    }
    if (!result.length) report(owner.file, 1, `Missing concrete public export: ${key}`);
    return result;
  };
  const visited = new Set();
  const isNativeLoader = (owner, file) => {
    const loader = owner.manifest.bycoda?.nativeLoader;
    if (typeof loader !== "string") return false;
    const target = path.resolve(owner.directory, loader);
    return (
      fs.existsSync(target) && inside(target, owner.directory) && fs.realpathSync(target) === file
    );
  };
  function visit(file, owner, chain) {
    if (visited.has(file)) return;
    visited.add(file);
    const name = slash(path.relative(root, file));
    checked.add(name);
    if (file.endsWith(".json")) {
      JSON.parse(fs.readFileSync(file, "utf8"));
      return;
    }
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const error of source.parseDiagnostics)
      report(file, 1, ts.flattenDiagnosticMessageText(error.messageText, " "), chain);
    for (const edge of moduleEdges(source)) {
      const specifier = edge.specifier;
      const nativeNode =
        owner.manifest.bycoda?.layer === "native" && owner.manifest.bycoda?.runtime === "node";
      if (specifier === undefined) {
        if (nativeNode && edge.loadingKind === "require" && isNativeLoader(owner, file)) continue;
        report(
          file,
          edge.line,
          "Computed module loading needs a concrete package boundary or declared native artifact loader",
          chain,
        );
        continue;
      }
      if (specifier.startsWith(".") && !path.isAbsolute(specifier)) {
        const resolved = ts.resolveModuleName(
          specifier,
          file,
          {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
            allowJs: true,
            resolveJsonModule: true,
          },
          ts.sys,
        ).resolvedModule;
        if (!resolved || !fs.existsSync(resolved.resolvedFileName))
          report(file, edge.line, `Unresolved package dependency: ${specifier}`, chain);
        else {
          const target = fs.realpathSync(resolved.resolvedFileName);
          if (!inside(target, owner.directory))
            report(
              file,
              edge.line,
              `Package imports implementation outside its own boundary: ${specifier}`,
              chain,
            );
          else visit(target, owner, [...chain, name]);
        }
      } else {
        if (
          nativeNode &&
          (builtins.has(specifier.replace(/^node:/, "")) ||
            (edge.typeReference && specifier === "node"))
        ) {
          // Factory aliases can conceal later CJS edges. Keep module loading
          // in the one declared artifact loader.
          if (specifier.replace(/^node:/, "") === "module" && !isNativeLoader(owner, file))
            report(
              file,
              edge.line,
              "Node module loading helpers belong to the declared native loader",
              chain,
            );
          continue;
        }
        const dependency = [...byName.values()].find(
          (item) =>
            specifier === item.manifest.name || specifier.startsWith(`${item.manifest.name}/`),
        );
        if (
          specifier.startsWith("node:") ||
          builtins.has(specifier) ||
          !dependency ||
          (dependency.manifest.bycoda?.layer !== "portable" &&
            !(
              nativeNode &&
              dependency.manifest.bycoda?.layer === "native" &&
              dependency.manifest.bycoda?.runtime === "node"
            )) ||
          !owner.manifest.dependencies?.[dependency.manifest.name]
        ) {
          report(
            file,
            edge.line,
            `${nativeNode ? "Native Node" : "Portable"} package cannot import platform/UI/undeclared dependency: ${specifier}`,
            chain,
          );
          continue;
        }
        const key =
          specifier === dependency.manifest.name
            ? "."
            : `.${specifier.slice(dependency.manifest.name.length)}`;
        for (const target of publicTargets(dependency, key))
          visit(target, dependency, [...chain, name]);
      }
    }
  }
  for (const owner of packages) {
    if (owner.family === "apps") {
      for (const [html, bootstrap] of Object.entries(owner.manifest.bycoda?.entrypoints ?? {})) {
        const entry = path.resolve(owner.directory, bootstrap);
        const document = path.resolve(root, html);
        const expected = `/${slash(path.relative(root, entry))}`;
        if (
          !inside(entry, owner.directory) ||
          !inside(document, root) ||
          !fs.existsSync(entry) ||
          !fs.existsSync(document) ||
          !fs.readFileSync(document, "utf8").includes(`src="${expected}"`)
        )
          report(owner.file, 1, `Application bootstrap is not consumed by its HTML entry: ${html}`);
      }
      continue;
    }
    const native = owner.manifest.bycoda?.layer === "native";
    if (native) {
      const runtime = owner.manifest.bycoda?.runtime;
      const declared = owner.manifest.bycoda?.cargo;
      const cargo = path.join(owner.directory, "Cargo.toml");
      if (
        !["rust", "node"].includes(runtime) ||
        declared !== "./Cargo.toml" ||
        !fs.existsSync(cargo) ||
        !fs.statSync(cargo).isFile() ||
        !inside(fs.realpathSync(cargo), owner.directory)
      ) {
        report(
          owner.file,
          1,
          "Native package needs a concrete local Cargo manifest and explicit rust/node runtime",
        );
        continue;
      }
      // Cargo enforces the Rust dependency graph; this check owns JS public edges.
      checked.add(slash(path.relative(root, cargo)));
      if (runtime === "rust") {
        if (owner.manifest.exports || owner.manifest.bycoda?.nativeLoader !== undefined)
          report(owner.file, 1, "Rust-only packages cannot declare JavaScript exports");
        continue;
      }
      const loader = owner.manifest.bycoda?.nativeLoader;
      if (loader !== undefined) {
        const file = typeof loader === "string" ? path.resolve(owner.directory, loader) : null;
        if (
          typeof loader !== "string" ||
          !loader.startsWith("./") ||
          loader.includes("*") ||
          !inside(file, owner.directory) ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile() ||
          !inside(fs.realpathSync(file), owner.directory)
        ) {
          report(
            owner.file,
            1,
            "Native artifact loader must be a concrete file within its package",
          );
          continue;
        }
      }
    } else if (owner.manifest.bycoda?.layer !== "portable") {
      report(owner.file, 1, "Package must declare its enforced layer");
      continue;
    }
    const exports = owner.manifest.exports;
    for (const key of typeof exports === "string" ? ["."] : Object.keys(exports ?? {}))
      for (const file of publicTargets(owner, key)) visit(file, owner, []);
    if (!exports) report(owner.file, 1, "Reusable package has no public exports");
    for (const [legacy, key] of Object.entries(owner.manifest.bycoda?.legacyFacades ?? {})) {
      const file = path.resolve(root, legacy);
      if (!inside(file, root) || !fs.existsSync(file)) {
        report(owner.file, 1, `Missing compatibility facade: ${legacy}`);
        continue;
      }
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const expected = key === "." ? owner.manifest.name : `${owner.manifest.name}/${key.slice(2)}`;
      if (
        !source.statements.length ||
        source.statements.some(
          (node) => !ts.isExportDeclaration(node) || literal(node.moduleSpecifier) !== expected,
        )
      )
        report(file, 1, "Legacy facade must only re-export its canonical workspace module");
    }
  }
  return {
    findings,
    checked: [...checked].sort(),
    packages: packages.map((item) => item.manifest.name),
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = checkPackageBoundaries();
  for (const finding of result.findings)
    console.error(
      `${finding.file}:${finding.line} ${finding.message} [${finding.chain.join(" -> ")}]`,
    );
  console.log(
    `Workspace boundaries: ${result.packages.length} packages/apps, ${result.checked.length} reachable modules, ${result.findings.length} findings.`,
  );
  if (result.findings.length) process.exitCode = 1;
}
