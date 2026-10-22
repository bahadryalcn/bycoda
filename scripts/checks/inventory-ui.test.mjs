import assert from "node:assert/strict";
import test from "node:test";
import { scanSource, scanStyles } from "./inventory-ui.mjs";

test("counts actual JSX, aliases and hidden/native semantics without counting strings or comments", () => {
  const source = `
    import { Button as Action } from "@/shared/ui/Button";
    // <button>comment</button>
    const example = "<input />";
    const view = <><Action variant="primary" /><button role="tab" draggable />
      <input type="file" hidden /><motion.button /><div role="treeitem" /></>;
  `;
  const result = scanSource("src/features/example/ui/View.tsx", source);
  assert.equal(result.nativeControls.length, 3);
  assert.equal(result.nativeControls[0].role, "tab");
  assert.equal(result.nativeControls[0].draggable, true);
  assert.equal(result.nativeControls[1].hidden, true);
  assert.equal(result.sharedControls[0].imported, "Button");
  assert.equal(result.sharedControls[0].variant, "primary");
  assert.equal(result.interactiveElements[0].role, "treeitem");
});

test("resolves direct registry imports and re-exports without marking a shared adapter as a feature", () => {
  const source = `import type { ButtonProps } from "../../../shared/ui/Button";
    import { Input } from "../../../shared/ui/arc/input/input";
    export { Select } from "@/shared/ui/arc/select/select";
    const view = <Input />;`;
  const result = scanSource("src/features/example/ui/View.tsx", source);
  assert.equal(result.registryImports.length, 2);
  assert.equal(result.registryImports[0].module, "src/shared/ui/arc/input/input");
  assert.equal(result.sharedControls.length, 1);
  assert.equal(scanSource("src/shared/ui/TextField.tsx", source).scope, "shared-ui");
  assert.equal(scanSource("src/shared/ui/arc/input/input.tsx", source).registryImports.length, 0);
});

test("separates presentation candidates from layout and dynamic expressions", () => {
  const result = scanSource(
    "src/app/View.tsx",
    `
    import { Button } from "@/shared/ui/Button";
    const view = <><Button className="w-full flex gap-2" />
      <Button className="bg-content rounded-lg px-4" />
      <Button style={{ color: "var(--color-danger)", margin: 4 }} />
      <Button className={classes} /><Button style={style} /></>;
  `,
  );
  assert.equal(result.presentationOverrides.length, 2);
  assert.deepEqual(result.presentationOverrides[1].properties, ["color"]);
  assert.equal(result.sharedControls.length, 5);
});

test("records palette escape and line numbers", () => {
  const result = scanSource(
    "src/features/a/ui/A.tsx",
    '\nimport { themePalette } from "../../../shared/theme/palette";\nconst view = <input />;',
  );
  assert.equal(result.paletteImports[0].line, 2);
  assert.equal(result.nativeControls[0].line, 3);
});

test("does not treat false or dynamic hidden props as a statically hidden input", () => {
  const result = scanSource(
    "src/app/View.tsx",
    `const view = <>
    <input hidden={false} /><input hidden={condition} /><input hidden={true} />
    <input type="hidden" /><input hidden />
  </>;`,
  );
  assert.deepEqual(
    result.nativeControls.map((control) => control.hidden),
    [false, false, true, true, true],
  );
});

test("CSS candidates preserve lines and exclude comments and at-rules", () => {
  const result = scanStyles(
    "src/features/a/ui/A.css",
    `/* color-mix(\n fake button { } */
    @media (width < 400px) {
      .save-button:hover { color: color-mix(in srgb, var(--color-danger) 50%, transparent); }
      .text { color: var(--palette-accent); }
    }`,
  );
  assert.equal(result.localColorRecipes.length, 2);
  assert.equal(result.localColorRecipes[0].line, 4);
  assert.equal(result.controlSelectors.length, 1);
  assert.equal(result.controlSelectors[0].selector, ".save-button:hover");
});
