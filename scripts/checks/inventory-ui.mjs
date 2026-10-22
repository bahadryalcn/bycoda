import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { createHash } from "node:crypto";

export const uiFingerprint = (text) =>
  createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 20);

const nativeTags = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "option",
  "dialog",
  "table",
  "progress",
]);
const interactiveRoles = new Set([
  "button",
  "tab",
  "treeitem",
  "menuitem",
  "option",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "combobox",
  "listbox",
]);
const visualProperties =
  /^(?:color|background.*|border.*|boxShadow|outline.*|padding.*|font.*|height|minHeight|maxHeight)$/;
const visualUtilities =
  /(?:^|\s)(?:[\w-]+:)*(?:bg-|text-|border-|rounded|shadow|ring-|outline-|p[xytrblse]?-|h-|min-h-|font-)/;
const normalize = (value) => value.replaceAll("\\", "/");

function scopeOf(file) {
  if (file.startsWith("src/shared/ui/arc/")) return "registry";
  if (file.startsWith("src/shared/ui/")) return "shared-ui";
  if (file.startsWith("src/features/")) return "feature";
  if (file.startsWith("src/app/")) return "app";
  if (file.startsWith("src/styles/")) return "theme";
  return "other";
}

function resolveModule(file, module) {
  if (module.startsWith("@/")) return `src/${module.slice(2)}`;
  if (module.startsWith("."))
    return normalize(path.posix.normalize(path.posix.join(path.posix.dirname(file), module)));
  return module;
}

/** Inventory candidates, not violations. Native semantics require human classification. */
export function scanSource(file, source) {
  file = normalize(file);
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const result = {
    file,
    scope: scopeOf(file),
    nativeControls: [],
    interactiveElements: [],
    sharedControls: [],
    registryImports: [],
    paletteImports: [],
    presentationOverrides: [],
  };
  const imports = new Map();
  const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  // Resolve local immutable recipes without executing application code. Scope
  // lookup prevents a same-named field in another component from being approved.
  function classText(expression, seen = new Set()) {
    if (!expression) return "";
    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (ts.isParenthesizedExpression(expression)) return classText(expression.expression, seen);
    if (ts.isConditionalExpression(expression))
      return `${classText(expression.whenTrue, seen)} ${classText(expression.whenFalse, seen)}`;
    if (ts.isTemplateExpression(expression))
      return (
        expression.head.text +
        expression.templateSpans
          .map((span) => `${classText(span.expression, seen)}${span.literal.text}`)
          .join("")
      );
    if (ts.isBinaryExpression(expression))
      return `${classText(expression.left, seen)} ${classText(expression.right, seen)}`;
    if (ts.isIdentifier(expression) && !seen.has(expression)) {
      const next = new Set(seen).add(expression);
      for (let scope = expression.parent; scope; scope = scope.parent) {
        if (
          ts.isFunctionLike(scope) &&
          scope.parameters.some(
            (parameter) =>
              ts.isIdentifier(parameter.name) && parameter.name.text === expression.text,
          )
        )
          return "";
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === expression.text)
              return statement.declarationList.flags & ts.NodeFlags.Const
                ? classText(declaration.initializer, next)
                : "";
          }
        }
      }
    }
    return "";
  }
  for (const node of ast.statements) {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      continue;
    const module = resolveModule(file, node.moduleSpecifier.text);
    if (module.startsWith("src/shared/ui/arc/") && result.scope !== "registry") {
      result.registryImports.push({ line: line(node), module });
    }
    if (module === "src/shared/theme/palette" && result.scope !== "theme") {
      result.paletteImports.push({ line: line(node), module });
    }
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly)
      continue;
    const clause = node.importClause;
    if (clause.name) imports.set(clause.name.text, { module, imported: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly)
          imports.set(binding.name.text, {
            module,
            imported: binding.propertyName?.text ?? binding.name.text,
          });
      }
    }
  }
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const attributes = new Map(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(ast), attribute]),
      );
      const value = (name) => {
        const attribute = attributes.get(name);
        if (!attribute) return undefined;
        if (!attribute.initializer) return true;
        if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
        if (
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression &&
          ts.isStringLiteral(attribute.initializer.expression)
        )
          return attribute.initializer.expression.text;
        if (ts.isJsxExpression(attribute.initializer)) {
          if (attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword) return true;
          if (attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword) return false;
        }
        return "<expression>";
      };
      const role = value("role");
      if (nativeTags.has(tag) || /^(?:motion|m)\.(?:button|input|select|textarea)$/.test(tag)) {
        result.nativeControls.push({
          fingerprint: uiFingerprint(node.getText(ast)),
          line: line(node),
          tag,
          type: value("type"),
          role,
          hidden: value("hidden") === true || value("type") === "hidden",
          draggable: value("draggable"),
          hasSpread: node.attributes.properties.some(ts.isJsxSpreadAttribute),
        });
      }
      if (interactiveRoles.has(role) && !nativeTags.has(tag)) {
        result.interactiveElements.push({
          fingerprint: uiFingerprint(node.getText(ast)),
          line: line(node),
          tag,
          role,
        });
      }
      const imported = imports.get(tag);
      if (
        imported &&
        (imported.module.startsWith("src/shared/ui/") ||
          imported.module === "src/features/settings/ui/settingsControls")
      ) {
        result.sharedControls.push({
          line: line(node),
          tag,
          ...imported,
          variant: value("variant"),
        });
        if (!imported.module.startsWith("src/shared/ui/arc/")) {
          const classAttribute = attributes.get("className")?.initializer;
          const className =
            classAttribute && ts.isJsxExpression(classAttribute)
              ? classText(classAttribute.expression) || "<expression>"
              : value("className");
          const style = attributes.get("style")?.initializer;
          const expression = style && ts.isJsxExpression(style) ? style.expression : undefined;
          const properties =
            expression && ts.isObjectLiteralExpression(expression)
              ? expression.properties
                  .filter(ts.isPropertyAssignment)
                  .map((property) => property.name.getText(ast).replaceAll(/["']/g, ""))
              : [];
          const visual = properties.filter((property) => visualProperties.test(property));
          if (
            (typeof className === "string" &&
              className !== "<expression>" &&
              visualUtilities.test(className)) ||
            visual.length
          ) {
            result.presentationOverrides.push({
              fingerprint: uiFingerprint(`${node.getText(ast)}\nresolved-class:${className ?? ""}`),
              line: line(node),
              tag,
              className,
              properties: visual,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

/** CSS signals are deliberately heuristic; they do not replace a CSS/cascade review. */
export function scanStyles(file, source) {
  file = normalize(file);
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const result = { file, scope: scopeOf(file), localColorRecipes: [], controlSelectors: [] };
  const line = (index) => text.slice(0, index).split("\n").length;
  for (const match of text.matchAll(
    /color-mix\(|(?:linear|radial|conic)-gradient\(|var\(--palette-[\w-]+/g,
  )) {
    result.localColorRecipes.push({
      fingerprint: uiFingerprint(
        text.slice(
          text.lastIndexOf(";", match.index) + 1,
          text.indexOf(";", match.index) + 1 || text.length,
        ),
      ),
      line: line(match.index),
      kind: match[0].startsWith("var(") ? "palette-reference" : match[0].slice(0, -1),
    });
  }
  for (const match of text.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim();
    if (
      !selector.startsWith("@") &&
      /\b(?:button|input|textarea|select)\b|[.\w-]+(?:[Bb]utton|[Ii]nput|[Cc]ontrol|[Tt]rigger)[\w-]*|\[\s*role\s*=\s*["']?(?:alert|status|combobox|listbox|checkbox|switch|radio|menuitem|tab)\b/.test(
        selector,
      )
    ) {
      result.controlSelectors.push({
        line: line(match.index + match[1].search(/\S/)),
        selector,
        fingerprint: uiFingerprint(
          selector + text.slice(match.index + match[0].length, text.indexOf("}", match.index)),
        ),
      });
    }
  }
  return result;
}

function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(file);
      return /\.(?:[cm]?tsx?|css)$/.test(entry.name) &&
        !/\.(?:test|spec)\.|\.d\.ts$/.test(entry.name)
        ? [file]
        : [];
    });
}

export function inventoryUi(root = process.cwd()) {
  const sources = [],
    styles = [];
  for (const absolute of walk(path.join(root, "src"))) {
    const file = normalize(path.relative(root, absolute));
    const content = fs.readFileSync(absolute, "utf8");
    if (file.endsWith(".css")) styles.push(scanStyles(file, content));
    else sources.push(scanSource(file, content));
  }
  const application = sources.filter(
    (file) => file.scope !== "shared-ui" && file.scope !== "registry",
  );
  const count = (files, field) => files.reduce((total, file) => total + file[field].length, 0);
  const features = [
    ...new Set(
      application.map((file) =>
        file.file.startsWith("src/features/") ? file.file.split("/")[2] : file.scope,
      ),
    ),
  ].sort();
  const groups = features.map((feature) => {
    const files = application.filter(
      (file) =>
        (file.file.startsWith("src/features/") ? file.file.split("/")[2] : file.scope) === feature,
    );
    return {
      feature,
      files: files.length,
      nativeControls: count(files, "nativeControls"),
      sharedControls: count(files, "sharedControls"),
      registryImports: count(files, "registryImports"),
      presentationOverrides: count(files, "presentationOverrides"),
    };
  });
  return {
    schemaVersion: 1,
    scope:
      "Desktop src only; tests excluded. Counts are source sites, not rendered controls or confirmed violations.",
    limitations: [
      "Dynamic classes, wrapper aliases, CSS-in-JS and third-party renderers need manual review.",
      "Hidden inputs, tabs, trees, menu items and native window controls may be legitimate semantic internals.",
      "CSS selectors and color recipes are heuristic candidates. No enforcement baseline is implied.",
    ],
    summary: {
      sourceFiles: sources.length,
      cssFiles: styles.length,
      nativeControls: count(application, "nativeControls"),
      sharedControls: count(application, "sharedControls"),
      registryImports: count(application, "registryImports"),
      paletteImports: count(application, "paletteImports"),
      presentationOverrides: count(application, "presentationOverrides"),
      featureColorRecipes: count(
        styles.filter((file) => file.scope === "feature" || file.scope === "app"),
        "localColorRecipes",
      ),
    },
    groups,
    sources,
    styles,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--json" && argument !== "--help")) {
    console.error("Usage: node scripts/checks/inventory-ui.mjs [--json]");
    process.exitCode = 1;
  } else if (args.includes("--help")) {
    console.log(
      "Inventory desktop UI migration candidates. Read-only; no pass/fail migration gate.\nUse --json for the full per-file inventory; redirect only to ignored temp/.",
    );
  } else {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const inventory = inventoryUi(root);
    if (args.includes("--json")) console.log(JSON.stringify(inventory, null, 2));
    else {
      console.log(inventory.scope);
      console.log(JSON.stringify(inventory.summary, null, 2));
      console.table(
        inventory.groups
          .filter((group) => group.nativeControls || group.registryImports)
          .sort((a, b) => b.nativeControls - a.nativeControls),
      );
      console.log(
        "These are review candidates, not failures. Use --json for locations and details.",
      );
    }
  }
}
