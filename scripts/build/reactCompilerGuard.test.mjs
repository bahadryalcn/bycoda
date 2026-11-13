import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "@babel/core";
import { scanSource } from "../checks/check-compiler-coverage.mjs";
import { reactCompilerGuard } from "./reactCompilerGuard.ts";

const file = "src/shared/ui/Demo.tsx";
const PRELUDE =
  'import { t, getLocale } from "@/shared/i18n";\nimport { useEffect, useState } from "react";\n' +
  "declare const Menu: any;\ndeclare const List: any;\ndeclare const el: HTMLElement;\n" +
  "declare const run: (message: string) => void;\n";

test("TanStack useQuery defers query functions but not query option expressions", async () => {
  const query = 'import { useQuery as useData } from "@tanstack/react-query";\n';
  assert.equal(
    await marked(
      query +
        'export function A() { useData({queryKey: ["a"], queryFn: () => localStorage.getItem("a")}); return <p />; }',
    ),
    false,
  );
  assert.equal(
    await marked(
      query +
        'export function A() { useData({queryKey: ["a"], queryFn: getLocale}); return <p />; }',
    ),
    false,
  );
  assert.equal(
    await marked(
      query +
        'export function A() { useData({queryKey: [getLocale()], queryFn: () => "a"}); return <p />; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      query +
        'export function A() { useData({queryKey: ["a"], queryFn: getLocale()}); return <p />; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      query +
        'export function A() { useData({queryKey: ["a"], experimental_prefetchInRender: true, queryFn: () => getLocale()}); return <p />; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      "declare const useData: any; export function A() { useData({queryFn: () => getLocale()}); return <p />; }",
    ),
    true,
  );
});

/** Whether the guard opted any function of the source out. */
async function marked(code) {
  const { skipped } = await scanSource(file, PRELUDE + code);
  return skipped.some((item) => item.reason.startsWith("guard:"));
}

test("effect callbacks, JSX on* inline functions and useState initializers stay exempt", async () => {
  assert.equal(
    await marked(
      'export function A() { useEffect(() => { document.title = t("a"); }); return <p />; }',
    ),
    false,
  );
  assert.equal(
    await marked('export function B() { return <button onClick={() => run(t("a"))} />; }'),
    false,
  );
  assert.equal(
    await marked(
      "export function C() { const [n] = useState(() => Date.now()); return <p>{n}</p>; }",
    ),
    false,
  );
});

test("a useRetainedState initializer is kept like a useState one", async () => {
  assert.equal(
    await marked(
      'declare const useRetainedState: <T>(key: string, initial: () => T) => [T]; export function R() { const [n] = useRetainedState("k", () => Date.now()); return <p>{n}</p>; }',
    ),
    false,
  );
});

test("a: an async function is not render code", async () => {
  assert.equal(
    await marked(
      'export function A() { const save = async () => { await Promise.resolve(); run(t("saved")); }; useEffect(() => { void save(); }); return <p />; }',
    ),
    false,
  );
  assert.equal(
    await marked(
      'export function B() { async function load() { await 1; return t("x"); } void load(); return <p />; }',
    ),
    false,
  );
});

test("a: an async function unwrapped with use() stays opted out", async () => {
  assert.equal(
    await marked(
      'import { use } from "react";\nexport function A() { const load = async () => t("x"); const v = use(load()); return <p>{v}</p>; }',
    ),
    true,
  );
});

test("b: callbacks of then/catch/finally, timers, frames, microtasks and listeners are deferred", async () => {
  const bodies = [
    'fetch("/x").then(() => run(t("a")))',
    'fetch("/x").catch(() => run(t("a")))',
    'fetch("/x").finally(() => run(t("a")))',
    'setTimeout(() => run(t("a")), 1)',
    'window.setTimeout(() => run(t("a")), 1)',
    'globalThis.setInterval(() => run(t("a")), 1)',
    'requestAnimationFrame(() => run(t("a")))',
    'queueMicrotask(() => run(t("a")))',
    'window.addEventListener("x", () => run(t("a")))',
    'el.addEventListener("x", function () { run(t("a")); })',
  ];
  for (const body of bodies)
    assert.equal(await marked(`export function A() { ${body}; return <p />; }`), false, body);
});

test("b: a timer-named method on an unrelated receiver is still render code", async () => {
  assert.equal(
    await marked(
      'declare const timers: { setTimeout(cb: () => void): void };\nexport function A() { timers.setTimeout(() => run(t("a"))); return <p />; }',
    ),
    true,
  );
});

test("c: functions under an on* object key, including methods, are deferred", async () => {
  assert.equal(
    await marked('export function A() { Menu.open({ onOpen: () => t("a") }); return <p />; }'),
    false,
  );
  assert.equal(
    await marked(
      'export function B() { Menu.open({ onOpen() { return t("a"); } }); return <p />; }',
    ),
    false,
  );
});

test("d: a local function used only in deferred positions is deferred", async () => {
  const bodies = [
    'function pick() { return t("a"); } return <button onClick={pick} />;',
    'const pick = () => t("a"); return <button onClick={pick} />;',
    'const pick = () => t("a"); useEffect(() => { pick(); }); return <p />;',
    'const pick = () => t("a"); const other = () => pick(); return <button onClick={other} />;',
    'const pick = () => t("a"); setTimeout(pick, 1); return <p />;',
    'const pick = () => t("a"); return <Menu {...{ onClose: pick }} />;',
  ];
  for (const body of bodies)
    assert.equal(await marked(`export function A() { ${body} }`), false, body);
});

test("a hidden read in render keeps the opt-out", async () => {
  const bodies = [
    'return <p>{t("a")}</p>;',
    "return <p>{getLocale()}</p>;",
    "return <p>{Date.now()}</p>;",
    "return <p>{performance.now()}</p>;",
    "return <p>{Math.random()}</p>;",
    "return <p>{String(new Date())}</p>;",
    'return <p>{localStorage.getItem("k")}</p>;',
    'return <p>{sessionStorage.getItem("k")}</p>;',
  ];
  for (const body of bodies)
    assert.equal(await marked(`export function A() { ${body} }`), true, body);
});

test("a local function called directly in render keeps the opt-out", async () => {
  assert.equal(
    await marked('export function A() { const label = () => t("a"); return <p>{label()}</p>; }'),
    true,
  );
  assert.equal(
    await marked(
      'export function B() { function label() { return t("a"); } return <p>{label()}</p>; }',
    ),
    true,
  );
});

test("a render prop is render code", async () => {
  assert.equal(
    await marked(
      'export function A() { const item = () => <b>{t("a")}</b>; return <List renderItem={item} />; }',
    ),
    true,
  );
  assert.equal(
    await marked('export function B() { return <List renderItem={() => <b>{t("a")}</b>} />; }'),
    true,
  );
  assert.equal(
    await marked('export function C() { return <List>{() => <b>{t("a")}</b>}</List>; }'),
    true,
  );
});

test("a function used both as onClick and called in render keeps the opt-out", async () => {
  assert.equal(
    await marked(
      'export function A() { const pick = () => t("a"); return <button onClick={pick}>{pick()}</button>; }',
    ),
    true,
  );
});

test("a function under a non-on key spread into props keeps the opt-out", async () => {
  assert.equal(
    await marked(
      'export function A() { const pick = () => t("a"); const props = { label: pick }; return <Menu {...props} />; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      'export function B() { const props = { label: () => t("a") }; return <Menu {...props} />; }',
    ),
    true,
  );
});

test("a function stored in an array or returned keeps the opt-out", async () => {
  assert.equal(
    await marked(
      'export function A() { const pick = () => t("a"); return <Menu items={[pick]} />; }',
    ),
    true,
  );
  assert.equal(
    await marked('export function useThing() { const pick = () => t("a"); return pick; }'),
    true,
  );
});

test("hook-returned handlers keep the opt-out unless stored under an on* key", async () => {
  // Decision: a handler that escapes through a hook result cannot be classified.
  assert.equal(
    await marked(
      'export function useMenu() { const [, set] = useState(""); const update = () => set(t("a")); return { update }; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      'export function useMenu() { const [, set] = useState(""); const update = () => set(t("a")); return { onUpdate: update }; }',
    ),
    false,
  );
});

test("a reassigned function or a cycle called in render is not released", async () => {
  assert.equal(
    await marked(
      'export function A() { let pick = () => t("a"); pick = () => t("b"); return <button onClick={pick} />; }',
    ),
    true,
  );
  assert.equal(
    await marked(
      'export function B() { const a = () => b(); const b = () => { a(); return t("x"); }; return <p>{a()}</p>; }',
    ),
    true,
  );
});

test("an opted-out function loses a hand-written use memo", () => {
  const out = transformSync(
    PRELUDE + 'export function A() { "use memo"; return <p>{t("a")}</p>; }',
    {
      filename: path.join(fileURLToPath(new URL("../../", import.meta.url)), file),
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [reactCompilerGuard({ annotation: false })],
    },
  ).code;
  assert.match(out, /"use no memo"/);
  assert.doesNotMatch(out, /"use memo"/);
});

test("useFormat from shared/i18n does not taint its callers, the module formatters do", async () => {
  const imports = 'import { useFormat, formatNumber } from "@/shared/i18n";\n';
  assert.equal(
    await marked(
      imports +
        "export function A({ n, now }: { n: number; now: number }) { const f = useFormat(); const { formatDuration } = f; return <p>{f.formatNumber(n)} {f.formatRelativeTime(n, { now })} {formatDuration(n)}</p>; }",
    ),
    false,
  );
  assert.equal(
    await marked(
      imports + "export function B({ n }: { n: number }) { return <p>{formatNumber(n)}</p>; }",
    ),
    true,
  );
});
