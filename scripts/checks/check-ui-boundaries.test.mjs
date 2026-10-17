import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { scanSource, scanStyles } from "./inventory-ui.mjs";
import {
  collectUiFindings,
  compareUiFindings,
  decodeReviewBaseline,
  validateComponentDecisions,
} from "./check-ui-boundaries.mjs";

test("table reviews preserve count limits and reject a changed control fingerprint", () => {
  const baseline = decodeReviewBaseline({
    schemaVersion: 2,
    reasons: ["Native tree keyboard and drag owner."],
    componentDecisions: { columns: ["reasonIndex"], rows: [] },
    entries: {
      columns: ["file", "kind", "fingerprint", "count", "decision", "owner", "reasonIndex"],
      rows: [
        ["Tree.tsx", "native-control", "original", 1, "native-platform-editor-owner", "tree", 0],
      ],
    },
  });
  const finding = { file: "Tree.tsx", kind: "native-control", fingerprint: "original" };
  assert.deepEqual(compareUiFindings([finding], baseline), []);
  assert.equal(compareUiFindings([finding, finding], baseline).length, 1);
  assert.equal(compareUiFindings([{ ...finding, fingerprint: "changed" }], baseline).length, 1);
  assert.equal(baseline.entries[0].reason, "Native tree keyboard and drag owner.");
});

test("rejects malformed review tables and unresolved explanations", () => {
  const table = { columns: ["reasonIndex"], rows: [[0]] };
  const baseline = {
    schemaVersion: 2,
    reasons: ["Reviewed owner."],
    componentDecisions: table,
    entries: table,
  };
  for (const malformed of [
    { columns: ["reasonIndex", "reasonIndex"], rows: [[0, 0]] },
    { columns: ["reasonIndex"], rows: [[]] },
    { columns: ["reasonIndex"], rows: [[-1]] },
    { columns: ["reasonIndex"], rows: [[1]] },
    { columns: ["reasonIndex"], rows: [[null]] },
  ])
    assert.throws(
      () => decodeReviewBaseline({ ...baseline, entries: malformed }),
      /Invalid UI review/,
    );
  assert.throws(() => decodeReviewBaseline({ ...baseline, reasons: [null] }), /Invalid UI review/);
  assert.throws(() => decodeReviewBaseline({ schemaVersion: 3 }), /Unsupported/);
});

test("repository review data retains valid historical decisions and signal owners", () => {
  const baseline = decodeReviewBaseline(
    JSON.parse(fs.readFileSync(new URL("./ui-reviewed-baseline.json", import.meta.url), "utf8")),
  );
  validateComponentDecisions(baseline);
  assert.deepEqual(compareUiFindings([], baseline), []);
});

const source = (text) =>
  collectUiFindings({ sources: [scanSource("src/features/files/ui/Tree.tsx", text)], styles: [] });
const reviewed = (item, count = 1) => ({
  ...item,
  count,
  decision: "native-platform-editor-owner",
  owner: "file tree",
  reason: "Native treeitem retains keyboard selection and drag events.",
});

test("allows a reviewed native tree row and rejects a new ordinary action", () => {
  const tree = '<button role="treeitem" draggable aria-selected={selected} />';
  const baseline = { entries: [reviewed(source(tree)[0])] };
  assert.deepEqual(compareUiFindings(source(tree), baseline), []);
  assert.equal(
    compareUiFindings(source(tree + "<button onClick={save}>Save</button>"), baseline).length,
    1,
  );
});

test("requires review for a new ARIA action built from a generic element", () => {
  assert.equal(
    source('<div role="button" onClick={save}>Save</div>')[0].kind,
    "native-interaction",
  );
});

test("requires review for a broad semantic feedback CSS override", () => {
  const findings = collectUiFindings({
    sources: [],
    styles: [
      scanStyles(
        "src/features/a/ui/a.css",
        '.panel [role="alert"] { color: var(--color-danger); }',
      ),
    ],
  });
  assert.equal(findings[0].kind, "control-style");
  assert.equal(compareUiFindings(findings, { entries: [] }).length, 1);
});

test("cannot count a missing, duplicate or unexplained historical component as reviewed", () => {
  const item = {
    file: "src/app/Row.tsx",
    name: "Row",
    indexed: true,
    definition: "current",
    sourceFingerprint: "a".repeat(64),
    decision: "migrate",
    owner: "shared row",
    reason: "Selection controller retained with shared presentation.",
  };
  const baseline = { historicalCandidateCount: 1, componentDecisions: [item] };
  assert.doesNotThrow(() => validateComponentDecisions(baseline));
  assert.throws(
    () => validateComponentDecisions({ ...baseline, componentDecisions: [] }),
    /Incomplete/,
  );
  assert.throws(
    () =>
      validateComponentDecisions({
        ...baseline,
        historicalCandidateCount: 2,
        componentDecisions: [item, item],
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      validateComponentDecisions({ ...baseline, componentDecisions: [{ ...item, reason: "" }] }),
    /Invalid/,
  );
});
test("counts identical new signals and keeps reviews stable across line moves", () => {
  const tree = '<button role="treeitem" draggable />';
  const baseline = { entries: [reviewed(source(tree)[0])] };
  assert.equal(compareUiFindings(source(tree + tree), baseline).length, 1);
  assert.deepEqual(compareUiFindings(source("\n\n" + tree), baseline), []);
});
test("detects registry aliases and new CSS recipes without banning shared primitives", () => {
  assert.equal(
    source(
      'import { Input as Field } from "../../../shared/ui/arc/input/input"; const view = <Field/>;',
    )[0].kind,
    "registry-import",
  );
  const inventory = {
    sources: [scanSource("src/shared/ui/TextField.tsx", "<input />")],
    styles: [
      scanStyles(
        "src/features/a/ui/a.css",
        ".action { color: color-mix(in srgb, var(--color-accent) 20%, transparent); }",
      ),
    ],
  };
  assert.equal(
    collectUiFindings(inventory).filter((item) => item.kind === "native-control").length,
    0,
  );
  assert.equal(collectUiFindings(inventory)[0].kind, "color-recipe");
});
test("requires an explicit owner and reason instead of approving inventory counts", () => {
  const item = source('<input type="file" />')[0];
  assert.throws(
    () => compareUiFindings([item], { entries: [{ ...item, count: 1 }] }),
    /Invalid UI review/,
  );
});
test("keeps semantic icon content separate from feature control skins", () => {
  assert.equal(
    source(
      'import { X } from "../../../shared/ui/icons"; const view = <X className="text-danger"/>;',
    ).length,
    0,
  );
  assert.equal(
    source(
      'import { Button } from "../../../shared/ui/Button"; const view = <Button className="bg-content rounded-lg"/>;',
    )[0].kind,
    "control-presentation",
  );
});

test("tracks immutable field recipes in their lexical scope and invalidates changed recipes", () => {
  const view = (skin) => `import { TextField } from "@/shared/ui/TextField";
    function Other(){ const field="flex"; return <TextField className={field}/>; }
    function Form(){ const field="${skin}"; return <TextField className={field}/>; }`;
  const initial = source(view("h-9 border rounded-md"));
  assert.equal(initial.length, 1);
  const baseline = { entries: initial.map((item) => reviewed(item)) };
  assert.equal(compareUiFindings(source(view("h-10 border rounded-md")), baseline).length, 1);
});
