import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { browserImpact } from "./browser-impact.mjs";

function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), "browser-impact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  write("src/shared/ui/Button.tsx", "export const Button = 1;\n");
  write("src/features/notes/ui/Notes.tsx", 'import { Button } from "../../../shared/ui/Button";\n');
  write("src/features/notes/index.ts", 'export * from "./ui/Notes";\n');
  write(
    "src/features/tasks/ui/Tasks.tsx",
    'import "../../notes";\nimport("../../../shared/ui/Button");\n',
  );
  const suite = (area, entry) => {
    write(
      `tests/browser/${area}/${area}.html`,
      `<script type="module" src="./${area}.ts"></script>`,
    );
    write(`tests/browser/${area}/${area}.ts`, `import "../../../${entry}";\n`);
    write(`tests/browser/${area}/${area}.spec.ts`, "");
    return {
      id: area,
      config: `tests/browser/${area}/${area}.playwright.config.ts`,
      files: [`${area}.spec.ts`],
      fixture: { path: `/tests/browser/${area}/${area}.html` },
    };
  };
  const manifest = {
    suites: [
      suite("notes", "src/features/notes/ui/Notes.tsx"),
      suite("tasks", "src/features/tasks/ui/Tasks.tsx"),
    ],
  };
  return { root, manifest };
}

test("a feature change runs the feature's own suite and defers suites that reach it through imports", (t) => {
  const { root, manifest } = repository(t);
  assert.deepEqual(browserImpact(["src/features/notes/ui/Notes.tsx"], { root, manifest }), {
    run: ["notes"],
    deferred: ["tasks"],
  });
});

test("a changed spec or fixture file selects its suite; non-UI files select nothing", (t) => {
  const { root, manifest } = repository(t);
  assert.deepEqual(browserImpact(["tests/browser/tasks/tasks.spec.ts"], { root, manifest }).run, [
    "tasks",
  ]);
  assert.deepEqual(browserImpact(["tests/browser/tasks/tasks.ts"], { root, manifest }).run, [
    "tasks",
  ]);
  assert.deepEqual(browserImpact(["host/engine.ts", "README.md"], { root, manifest }), {
    run: [],
    deferred: [],
  });
});

test("a shared change runs reached suites only while they fit the limit", (t) => {
  const { root, manifest } = repository(t);
  const shared = ["src/shared/ui/Button.tsx"];
  assert.deepEqual(browserImpact(shared, { root, manifest }).run.sort(), ["notes", "tasks"]);
  assert.deepEqual(browserImpact(shared, { root, manifest, limit: 1 }), {
    run: [],
    deferred: ["notes", "tasks"],
  });
});
