/** Read-only source inventory. This report is not a build graph or an unused-code gate. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const slash = (value) => value.replaceAll("\\", "/");
const inside = (value) => value !== ".." && !value.startsWith("../") && !path.isAbsolute(value);
const production = (file) =>
  /\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec|e2e|stories|bench)\.[cm]?[jt]sx?$/.test(file);
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (
        entry.isSymbolicLink() ||
        (entry.isDirectory() && ["node_modules", ".git", "dist"].includes(entry.name))
      )
        return [];
      return entry.isDirectory() ? files(file) : [file];
    })
    .sort();
}
export function owner(file) {
  for (const [prefix, label] of [
    ["apps/desktop/src/", "desktop-bootstrap"],
    ["apps/", "application"],
    ["packages/core/src/", "portable-package"],
    ["packages/", "workspace-package"],
    ["src/shared/model/host-contracts/", "contracts"],
    ["src/shared/lib/host-runtime/", "portable-runtime"],
    ["host/domains/", "host-domain"],
    ["host/transport/", "host-transport"],
    ["host/storage/", "host-storage"],
    ["host/", "host-composition"],
    ["src/platform/", "platform-adapter"],
    ["src/integrations/", "provider-integration"],
    ["src/features/", "feature"],
    ["src/shared/", "shared"],
    ["src/app/", "desktop-composition"],
    ["src-tauri/", "native"],
  ])
    if (file.startsWith(prefix)) return label;
  return "entry-or-configuration";
}
export function inventoryRepository(root = defaultRoot) {
  root = fs.realpathSync(root);
  const options = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    resolveJsonModule: true,
    allowJs: true,
    baseUrl: root,
    paths: { "@/*": ["src/*"] },
  };
  const config = path.join(root, "tsconfig.json");
  if (fs.existsSync(config)) {
    const parsed = ts.readConfigFile(config, ts.sys.readFile);
    if (parsed.error)
      throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, " "));
    const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions ?? {}, root);
    if (converted.errors.length)
      throw new Error(ts.flattenDiagnosticMessageText(converted.errors[0].messageText, " "));
    Object.assign(options, converted.options);
  }
  const names = ["src", "host", "apps", "packages"]
    .flatMap((name) => files(path.join(root, name)))
    .filter(production);
  const workspaces = new Map();
  for (const family of ["apps", "packages"]) {
    const directory = path.join(root, family);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const manifestPath = path.join(directory, entry.name, "package.json");
      if (!entry.isDirectory() || !fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      workspaces.set(manifest.name, { manifest, directory: path.dirname(manifestPath) });
    }
  }
  const edges = [];
  const unresolved = [];
  const packages = new Set();
  const moduleCache = ts.createModuleResolutionCache(
    root,
    (file) => (ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    options,
  );
  for (const file of names) {
    const from = slash(path.relative(root, file));
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const record = (node, specifier, kind) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!specifier) {
        unresolved.push({ from, line, kind, reason: "computed module loading" });
        return;
      }
      const workspace = [...workspaces].find(
        ([name]) => specifier === name || specifier.startsWith(`${name}/`),
      );
      const local =
        specifier.startsWith(".") ||
        specifier.startsWith("@/") ||
        path.isAbsolute(specifier) ||
        workspace;
      if (!local) {
        packages.add(
          specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0],
        );
        return;
      }
      let resolved = ts.resolveModuleName(
        specifier,
        file,
        options,
        ts.sys,
        moduleCache,
      ).resolvedModule;
      // Inventory also works before workspace links are bootstrapped. Only explicit
      // public export targets are eligible; private subpaths are not guessed.
      if (!resolved && workspace) {
        const [name, item] = workspace;
        const key = specifier === name ? "." : `.${specifier.slice(name.length)}`;
        const exports = item.manifest.exports;
        const declaration =
          typeof exports === "string" ? (key === "." ? exports : undefined) : exports?.[key];
        const targets = (value) =>
          typeof value === "string"
            ? [value]
            : value && typeof value === "object"
              ? Object.values(value).flatMap(targets)
              : [];
        const target = targets(declaration)
          .map((value) => path.resolve(item.directory, value))
          .find(
            (file) => inside(slash(path.relative(item.directory, file))) && fs.existsSync(file),
          );
        if (target) resolved = { resolvedFileName: target };
      }
      if (!resolved) {
        unresolved.push({ from, line, specifier, kind, reason: "unresolved local import" });
        return;
      }
      const to = slash(path.relative(root, fs.realpathSync(resolved.resolvedFileName)));
      if (!inside(to)) {
        unresolved.push({ from, line, specifier, kind, reason: "outside repository" });
        return;
      }
      edges.push({ from, to, line, kind, fromOwner: owner(from), toOwner: owner(to) });
    };
    const literal = (node) =>
      node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        ? node.text
        : undefined;
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        record(node, literal(node.moduleSpecifier), "module");
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        record(node, literal(node.argument.literal), "type");
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      )
        record(node, literal(node.arguments[0]), "dynamic-or-require");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const nativeEmbeds = [];
  for (const file of files(path.join(root, "src-tauri")).filter((file) => file.endsWith(".rs"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /include_(?:str|bytes)!\s*\(\s*(?:"([^"\r\n]+)"|(concat!))/g,
    )) {
      const to = match[1]
        ? slash(path.relative(root, path.resolve(path.dirname(file), match[1])))
        : null;
      nativeEmbeds.push({
        from: slash(path.relative(root, file)),
        line: text.slice(0, match.index).split("\n").length,
        to,
        state:
          to === null
            ? "generated-or-computed"
            : !inside(to)
              ? "outside-repository"
              : fs.existsSync(path.join(root, to))
                ? "present"
                : "missing",
      });
    }
  }
  const boundaries = {};
  for (const edge of edges) {
    const key = `${edge.fromOwner} -> ${edge.toOwner}`;
    boundaries[key] = (boundaries[key] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    scope:
      "Static production src/host/apps/packages imports and literal Rust embeds; separate mobile repo excluded. Dynamic resources, runtime registration and generated code need owner review.",
    workspacePackages: [...workspaces.keys()].sort(),
    nodes: names.map((file) => ({
      path: slash(path.relative(root, file)),
      owner: owner(slash(path.relative(root, file))),
    })),
    edges,
    boundaries,
    hostSourceImports: edges.filter(
      (edge) => edge.from.startsWith("host/") && edge.to.startsWith("src/"),
    ),
    nativeEmbeds,
    externalPackages: [...packages].sort(),
    unresolved,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = inventoryRepository();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `${report.nodes.length} production modules; ${report.edges.length} local edges; ${report.hostSourceImports.length} Host -> src edges; ${report.nativeEmbeds.length} Rust embeds.`,
    );
    for (const [edge, count] of Object.entries(report.boundaries).sort())
      console.log(`${count}\t${edge}`);
    console.log(
      `${report.unresolved.length} unresolved/computed imports require review. This report does not declare files unused.`,
    );
  }
}
