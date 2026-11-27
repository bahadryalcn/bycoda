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

test("shared-container-appearance covers aliases, namespaces and control slots", (t) => {
  const found = lint(t, {
    "src/features/demo/ui/D.tsx": [
      'import { Button as Action, Badge } from "../../../shared/ui/Button";', // 1
      'import * as UI from "../../../shared/ui/Select";', // 2
      'import { Button } from "./Button";', // 3 local homonym, not shared
      'const framed = "px-3 bg-surface";', // 4
      "export const D = () => (", // 5
      "  <>", // 6
      '    <Action className="px-3" />', // 7 flagged: alias, padding
      '    <Action className="w-full min-w-0 ms-auto" />', // 8 allowed: layout only
      "    <Action className={framed} />", // 9 flagged: resolved local const
      "    <Action className={unknown} />", // 10 allowed: unresolved
      '    <Badge className="font-semibold" />', // 11 flagged: typography
      '    <UI.Select className="rounded-lg" />', // 12 flagged: namespace control
      '    <UI.Select className="grow" />', // 13 allowed
      '    <Action style={{ background: "red" }} />', // 14 flagged: paint key
      "    <Action style={{ marginInlineStart: 8, flex: 1 }} />", // 15 allowed: layout keys
      '    <Button className="p-9" />', // 16 allowed: local Button
      "  </>",
      ");",
      "",
    ].join("\n"),
  });
  assert.deepEqual(
    found.map(({ line }) => line),
    [7, 9, 11, 12, 14],
  );
});

test("shared-container-appearance covers overlay props, glass hooks and paint variables", (t) => {
  const found = lint(t, {
    "src/features/demo/ui/E.tsx": [
      'import { Modal } from "../../../shared/ui/Modal";', // 1
      'import { Sheet } from "../../../shared/ui/Sheet";', // 2
      'import { Popover } from "../../../shared/ui/Popover";', // 3
      'import { useHoverCard } from "../../../shared/ui/HoverCard";', // 4
      "export const E = () => {", // 5
      '  const card = useHoverCard({ className: "glass" });', // 6 flagged: glass hook
      '  const fine = useHoverCard({ className: "max-w-80", width: 320 });', // 7 allowed
      "  return (", // 8
      "    <>", // 9
      '      <Modal panelStyle={{ background: "var(--x)" }} />', // 10 flagged: panel paint
      '      <Modal panelStyle={{ ["--modal-frame"]: "red" }} />', // 11 computed key: skipped
      '      <Modal panelStyle={{ "--modal-frame": "red" }} />', // 12 flagged: paint variable
      '      <Modal style={{ boxShadow: "none" }} />', // 13 flagged: shadow key
      '      <Sheet glassClassName="backdrop-blur-md" />', // 14 flagged: glass slot
      '      <Sheet bodyClassName="flex-1 min-h-0 overflow-auto" overlayClassName="z-50" />', // 15 allowed
      '      <Popover className="border-[color:var(--my-frame)]" />', // 16 flagged: custom frame colour
      '      <Popover className="shadow-lg" />', // 17 flagged: shadow
      '      <Popover className="[--popover-frame:red] w-64" />', // 18 flagged: arbitrary paint variable
      "      <Popover style={{ maxHeight: 240, zIndex: 4 }} />", // 19 allowed: geometry
      "    </>",
      "  );",
      "};",
      "",
    ].join("\n"),
  });
  assert.deepEqual(
    found.map(({ line }) => line),
    [6, 10, 12, 13, 14, 16, 17, 18],
  );
});
