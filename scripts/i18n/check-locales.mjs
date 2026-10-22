import fs from "node:fs";
import path from "node:path";
// AST utilities still use the JavaScript API; builds use the native TS 7 compiler.
import ts from "@typescript/typescript6";

const root = "src/shared/i18n/locales";
const source = JSON.parse(fs.readFileSync(`${root}/en.json`, "utf8"));
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
}
const used = new Set();
for (const file of files("src").filter(
  (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
)) {
  const code = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t"
    ) {
      const arg = node.arguments[0];
      function messages(arg) {
        if (arg && ts.isStringLiteral(arg)) used.add(arg.text);
        else if (arg && ts.isParenthesizedExpression(arg)) messages(arg.expression);
        else if (arg && ts.isConditionalExpression(arg)) {
          messages(arg.whenTrue);
          messages(arg.whenFalse);
        }
      }
      messages(arg);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
// Native menu copy shares the same catalog as the React UI.
const native = fs.readFileSync("src-tauri/src/menu.rs", "utf8");
for (const match of native.matchAll(/"([^"\n]+)"/g)) {
  const value = match[1];
  if (/^[A-Z][A-Za-z ]*(?:…|\+ Stack|\+ Row)?$/.test(value) && !value.startsWith("App:"))
    used.add(value);
}
for (const value of [
  "Quit {p0}",
  "Show {p0}",
  "Hide {p0}",
  "About {p0}",
  "Hide Others",
  "Show All",
  "Select All",
  "Undo",
  "Redo",
  "Cut",
  "Copy",
  "Paste",
  "Minimize",
  "Zoom",
])
  used.add(value);
if (process.argv.includes("--extract")) {
  for (const key of used) source[key] = key;
  fs.writeFileSync(`${root}/en.json`, JSON.stringify(source, null, 2) + "\n");
  console.log(`Extracted ${Object.keys(source).length} messages`);
  process.exit(0);
}
const issues = [];
for (const key of used) if (!(key in source)) issues.push(`Missing source: ${key}`);
const slots = (text) => (text.match(/\{p\d+\}/g) ?? []).sort().join(",");
const turkishEditorial = JSON.parse(fs.readFileSync("src/shared/i18n/tr-overrides.json", "utf8"));
for (const locale of ["tr", "de", "fr", "es", "pt", "zh-CN", "ja"]) {
  const catalog = JSON.parse(fs.readFileSync(`${root}/${locale}.json`, "utf8"));
  for (const key of Object.keys(source)) {
    if (typeof catalog[key] !== "string" || !catalog[key].trim())
      issues.push(`${locale}: missing ${key}`);
    else if (slots(key) !== slots(catalog[key])) issues.push(`${locale}: slots changed ${key}`);
  }
  for (const key of Object.keys(catalog))
    if (!(key in source)) issues.push(`${locale}: unknown source ${key}`);
  if (locale === "tr") {
    for (const [key, expected] of Object.entries(turkishEditorial)) {
      // The translation helper also ignores historical entries no longer in use.
      if (key in source && catalog[key] !== expected)
        issues.push(`tr: editorial correction lost ${key}`);
    }
  }
}
if (issues.length) {
  console.error(issues.slice(0, 20).join("\n"));
  console.error(`${issues.length} catalog issues`);
  process.exitCode = 1;
} else
  console.log(
    `8 catalogs verified; ${Object.keys(source).length} messages; placeholders preserved.`,
  );
