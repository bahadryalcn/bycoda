import fs from "node:fs";
import path from "node:path";
import ts from "@typescript/typescript6";

const sourcePath = "src/shared/theme/palette.ts";
const cssPath = "src/styles/palette.css";
const source = fs.readFileSync(sourcePath, "utf8");
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
let palette;
function readPalette(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "themePalette") {
    const initializer = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
    if (!ts.isObjectLiteralExpression(initializer)) throw new Error("Palette must be a static object");
    palette = Object.fromEntries(initializer.properties.map(property => {
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) {
        throw new Error("Palette entries must be static color strings");
      }
      return [property.name.text, property.initializer.text];
    }));
  }
  ts.forEachChild(node, readPalette);
}
readPalette(ast);
if (!palette) throw new Error("Cannot read the shared theme palette");
const roles = {
  danger: "danger", warning: "warning", success: "success", info: "info",
  feature: "feature", orchestration: "orchestration",
};
const lines = [
  "/* Generated from src/shared/theme/palette.ts. Do not edit directly.",
  " * Run node scripts/checks/check-theme-colors.mjs --write after palette edits. */",
  ":root {",
  ...Object.entries(palette).map(([name, value]) => `  --palette-${name}: ${value};`),
  "}",
  "",
  "@theme {",
  ...Object.keys(roles).map(name => `  --color-${name}: var(--palette-${name}Dark);`),
  "  --color-error: var(--color-danger);",
  "  --color-on-solid: var(--palette-solidInk);",
  "  --color-scrim: var(--palette-scrim);",
  "  --color-search: var(--palette-search);",
  "  --color-conflict-ours: var(--color-success);",
  "  --color-conflict-theirs: var(--color-info);",
  "}",
  "",
  "html.theme-light {",
  ...Object.keys(roles).map(name => `  --color-${name}: var(--palette-${name}Light);`),
  "}",
  "",
];
const expected = lines.join("\n");
if (process.argv.includes("--write")) {
  fs.writeFileSync(cssPath, expected);
  console.log(`Generated ${cssPath} (${Object.keys(palette).length} palette entries)`);
} else if (!fs.existsSync(cssPath) || fs.readFileSync(cssPath, "utf8") !== expected) {
  throw new Error("Theme CSS is stale. Run node scripts/checks/check-theme-colors.mjs --write");
}

// Product controls use semantic roles; literal values belong in the palette.
// Masks, color calculations and externally supplied colors have no fixed literals.
const violations = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    const normalized = file.replaceAll("\\", "/");
    if (/\.test\.|\/i18n\//.test(normalized) || normalized === sourcePath || normalized === cssPath) continue;
    if (/\.tsx?$/.test(file)) {
      const source = fs.readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && !ts.isLiteralTypeNode(node.parent)) {
          if (/#[\da-f]{3,8}\b|^(?:rgba?|hsla?|oklch|oklab)\(\s*[\d.]|^(?:white|black)$/i.test(node.text) ||
            /\b(?:bg|text|border|ring|outline|fill|stroke|decoration)-(?:red|amber|yellow|orange|green|emerald|blue|sky|cyan|teal|purple|violet|pink|fuchsia|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/.test(node.text)) {
            const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
            violations.push(`${file}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      continue;
    }
    if (!file.endsWith(".css")) continue;
    const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab)\(\s*[\d.]|(?<![-\w/])(?:white|black)(?![-\w.])/i.test(text)) violations.push(file);
  }
}
scan("src");
if (violations.length) throw new Error(`Colors outside shared palette or semantic roles:\n${violations.join("\n")}`);
console.log("Shared theme CSS is current; CSS and TypeScript color literals are centralized");
