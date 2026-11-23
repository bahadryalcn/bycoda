import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

function scanRule(t, name, files) {
  const root = mkdtempSync(join(tmpdir(), "bycoda lint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  };
  const ruleUrl = new URL(`./${name}.mjs`, import.meta.url).href;
  const ruleId = `bycoda/${name}`;
  write("package.json", JSON.stringify({ name: "fixture", private: true }));
  write(
    "plugin.mjs",
    `import rule from ${JSON.stringify(ruleUrl)};
export default { meta: { name: "bycoda" }, rules: { ${JSON.stringify(name)}: rule } };`,
  );
  write(
    "vite.config.mjs",
    `export default { lint: { categories: { correctness: "off" },
jsPlugins: ["./plugin.mjs"], rules: { ${JSON.stringify(ruleId)}: "error" } } };`,
  );
  for (const [file, lines] of Object.entries(files)) write(file, lines.join("\n"));

  const vp = join(dirname(require.resolve("vite-plus/package.json")), "bin", "vp");
  const result = spawnSync(
    process.execPath,
    [vp, "lint", "--format", "json", ...Object.keys(files)],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.ok(result.stdout.trim(), result.stderr);
  const { diagnostics } = JSON.parse(result.stdout);
  return diagnostics
    .map(({ code, filename, labels }) => {
      assert.equal(code, `bycoda(${name})`);
      return [filename.replaceAll("\\", "/"), labels[0].span.line];
    })
    .sort((a, b) => a[1] - b[1]);
}

test("no-raw-error-text flags raw error expressions that reach JSX content", (t) => {
  const file = "src/Screen.tsx";
  const rejected = [
    "const a = <div>{String(err)}</div>;",
    "const b = <>{err.message}</>;",
    "const c = <Alert title={error.message} />;",
    "const d = <Alert description={`Failure: ${loadError}`} />;",
    "const e = <Alert message={cause.toString()} />;",
    "const f = <Alert label={ready ? t('Ready') : ERROR?.message} />;",
    "const g = <Alert children={failed && String(reason)} />;",
    "const h = <div>{(saveError.message as string) ?? t('Failed')}</div>;",
  ];
  const accepted = [
    "const i = <ErrorDetails title={t('Failed')} detail={String(error)} />;",
    "const j = <div>{presentError(error)}{String(count)}{item.message}{item.toString()}</div>;",
    "const k = <div>{error.message ? t('Failed') : t('Ready')}</div>;",
    "const l = <div>{error.message && t('Failed')}</div>;",
    "const m = <Alert onClick={() => console.warn(String(error))} />;",
    "const n = <div>{/* empty JSX expression */}{`Message: ${item}`}</div>;",
    "const o = <div>{`Genre: ${terror}`}</div>;",
    "console.error(error.message, String(err));",
  ];
  assert.deepEqual(
    scanRule(t, "no-raw-error-text", {
      [file]: [...rejected, ...accepted],
      "src/Screen.test.tsx": rejected,
      "src/Screen.spec.tsx": rejected,
      "src/test-support/Screen.tsx": rejected,
      "src/shared/ui/ErrorDetailsPreview.tsx": rejected,
      "host/Screen.tsx": rejected,
    }),
    rejected.map((_, index) => [file, index + 1]),
  );
});

test("no-raw-error-text flags raw error text passed to toast.show", (t) => {
  const file = "src/hooks/useSave.ts";
  const rejected = [
    "toast.show({ tone: 'danger', message: String(error) });",
    "toast.show({ tone: 'danger', message: err.message });",
    "api.toast.show({ title: `Failed: ${cause}` });",
  ];
  const accepted = [
    "toast.show({ tone: 'danger', title: t('Save failed') });",
    "toast.show({ tone: 'danger', message: presentError(error) });",
    "toast.show({ tone: 'info', message: item.message });",
    "dialog.show({ message: String(error) });",
    "console.warn(String(error));",
  ];
  assert.deepEqual(
    scanRule(t, "no-raw-error-text", {
      [file]: [...rejected, ...accepted],
      "src/hooks/useSave.test.ts": rejected,
    }),
    rejected.map((_, index) => [file, index + 1]),
  );
});
