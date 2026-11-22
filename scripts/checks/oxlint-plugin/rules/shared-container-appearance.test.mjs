import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** A scratch repository whose lint block enables only this rule. */
function lint(t, files) {
  const root = mkdtempSync(join(tmpdir(), "bycoda container-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plugin = join(root, "scripts/checks/oxlint-plugin");
  mkdirSync(join(plugin, "rules"), { recursive: true });
  cpSync(
    join(repoRoot, "scripts/checks/oxlint-plugin/define-rule.mjs"),
    join(plugin, "define-rule.mjs"),
  );
  cpSync(
    join(repoRoot, "scripts/checks/oxlint-plugin/rules/shared-container-appearance.mjs"),
    join(plugin, "rules/shared-container-appearance.mjs"),
  );
  writeFileSync(
    join(plugin, "index.mjs"),
    'import rule from "./rules/shared-container-appearance.mjs";\n' +
      'export default { meta: { name: "bycoda" }, rules: { "shared-container-appearance": rule } };\n',
  );
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  writeFileSync(
    join(root, "vite.config.mjs"),
    "export default { lint: { jsPlugins: [{ name: 'bycoda', specifier: './scripts/checks/oxlint-plugin/index.mjs' }]," +
      " rules: { 'bycoda/shared-container-appearance': 'error' } } };\n",
  );
  symlinkSync(
    join(repoRoot, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules/vite-plus/bin/vp"), "lint", "--format", "json", "src"],
    { cwd: root, encoding: "utf8" },
  );
  const { diagnostics } = JSON.parse(result.stdout);
  return diagnostics
    .filter((d) => d.code.includes("shared-container-appearance"))
    .map((d) => ({
      file: d.filename.replaceAll("\\", "/"),
      line: d.labels[0].span.line,
      message: d.message,
    }));
}

const IMPORTS = [
  'import { Popover } from "../../../shared/ui/Popover";',
  'import { Modal } from "../../../shared/ui/Modal";',
  'import { Surface } from "../../../shared/ui/Surface";',
  'import { useHoverCard } from "../../../shared/ui/HoverCard";',
  'import { cn } from "../../../shared/lib/cn";',
].join("\n");

test("shared-container-appearance flags appearance classes on shared containers only", (t) => {
  const source = [
    IMPORTS,
    "export function A() {",
    '  const card = useHoverCard({ className: "max-w-80 p-3" });',
    '  const ok = useHoverCard({ className: "max-w-80" });',
    "  return (",
    "    <>",
    '      <Popover anchor={a} className="w-64 p-3 rounded-lg" />',
    '      <Popover anchor={a} className="w-64 max-h-40 overflow-auto grid gap-2" />',
    '      <Popover anchor={a} className={cn("flex", open && "hover:bg-hover")} />',
    "      <Surface className={`px-2 ${x}`} />",
    '      <Surface className="text-left" />',
    "      <Modal panelStyle={{ width: 640 }} />",
    "      <Modal panelStyle={{ zIndex: 3 }} />",
    '      <Modal size="lg" scroll="none" />',
    "    </>",
    "  );",
    "}",
    "",
  ].join("\n");
  const found = lint(t, {
    "src/features/demo/ui/A.tsx": source,
    "src/features/demo/ui/A.test.tsx": source,
    "src/shared/ui/B.tsx": source,
  });
  assert.deepEqual(
    found.map(({ file, line }) => [file, line]),
    [7, 11, 13, 14, 16].map((line) => ["src/features/demo/ui/A.tsx", line]),
  );
  assert.match(found.find((f) => f.line === 16).message, /size/);
  assert.match(found.find((f) => f.line === 14).message, /Surface> already offers .*padding/);
});

test("shared-container-appearance ignores local components of the same name", (t) => {
  const found = lint(t, {
    "src/features/demo/ui/C.tsx": [
      'import { Modal } from "./Modal";',
      'import { Popover } from "some-lib";',
      "const Surface = () => null;",
      "export const C = () => (",
      "  <>",
      '    <Modal className="p-4" />',
      '    <Popover className="p-4" />',
      '    <Surface className="p-4" />',
      "  </>",
      ");",
      "",
    ].join("\n"),
  });
  assert.deepEqual(found, []);
});
