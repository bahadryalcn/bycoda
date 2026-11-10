import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { EditorState, type Extension } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { isLintable, syntaxDiagnostics } from "./editorLint";

function stateWith(doc: string, language: Extension): EditorState {
  return EditorState.create({ doc, extensions: [language] });
}

function typescript(): Extension {
  return javascript({ typescript: true });
}

function typescriptJsx(): Extension {
  return javascript({ typescript: true, jsx: true });
}

function cssLang(): Extension {
  return css();
}

describe("syntaxDiagnostics", () => {
  it.each([{}, { jsx: true }, { typescript: true }, { typescript: true, jsx: true }])(
    "accepts defaulted destructuring arrow parameters in %j",
    (options) => {
      const state = stateWith(
        `const resolveQuickButtonDate = (
  { beginDate, endDate } = {},
  { isFuture = false, startOfDay = false, endOfDay = false } = {}
) => {
  const date = isFuture ? endDate : beginDate;
  if (!date) return null;
  if (endOfDay) return dayjs(date).endOf('day').toDate();
  if (startOfDay) return dayjs(date).startOf('day').toDate();
  return date;
};`,
        javascript(options),
      );
      expect(syntaxDiagnostics(state)).toEqual([]);
    },
  );

  it.each([
    "const f = (a + b) => b;",
    "const f = ({ a } = {}, { b = false } = {}) => { const x = ; };",
    "const f = ({ a } = {}, { b = false } = {})\n=> b;",
    "const f = ({ a } = {}, ...rest, b) => b;",
  ])("still reports invalid arrow syntax: %s", (doc) => {
    expect(syntaxDiagnostics(stateWith(doc, javascript())).length).toBeGreaterThan(0);
  });

  it("flags an unclosed brace", () => {
    const state = stateWith("function go() {\n  return 1;\n", javascript());
    const diagnostics = syntaxDiagnostics(state);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("reports nothing for valid code", () => {
    const state = stateWith("const a = 1;\nexport { a };\n", javascript());
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("flags a trailing comma in JSON", () => {
    const state = stateWith('{ "a": 1, }', json());
    expect(syntaxDiagnostics(state).length).toBeGreaterThan(0);
  });

  it("reports nothing for valid JSON", () => {
    const state = stateWith('{ "a": [1, 2], "b": null }', json());
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("flags a broken Python statement", () => {
    const state = stateWith("def go(:\n    return 1\n", python());
    expect(syntaxDiagnostics(state).length).toBeGreaterThan(0);
  });

  it("names the token the parser choked on", () => {
    const state = stateWith("const a = 1;\n)\n", javascript());
    const messages = syntaxDiagnostics(state).map((d) => d.message);
    expect(messages.some((m) => m.includes('")"'))).toBe(true);
  });

  it("gives every diagnostic a visible range", () => {
    const state = stateWith("if (a {\n  b();\n}\n", javascript());
    const diagnostics = syntaxDiagnostics(state);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.to).toBeGreaterThan(diagnostic.from);
      expect(diagnostic.to).toBeLessThanOrEqual(state.doc.length);
    }
  });

  it("never widens a diagnostic across a line break", () => {
    const state = stateWith("const a = {\n", javascript());
    for (const diagnostic of syntaxDiagnostics(state)) {
      const line = state.doc.lineAt(diagnostic.from);
      expect(diagnostic.to).toBeLessThanOrEqual(line.to);
    }
  });

  it("caps the diagnostics for a file that resyncs badly", () => {
    const state = stateWith(")\n".repeat(400), javascript());
    expect(syntaxDiagnostics(state).length).toBeLessThanOrEqual(50);
  });

  it("skips a document past the size cap", () => {
    const state = stateWith(")".repeat(512 * 1024 + 1), javascript());
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("reports nothing without a language", () => {
    expect(syntaxDiagnostics(EditorState.create({ doc: "){}(" }))).toEqual([]);
  });

  it("does not flag a TypeScript type predicate on an arrow function", () => {
    const state = stateWith(
      "const xs = ids\n  .map((id) => sessions.find((s) => s.id === id))\n  .filter((session): session is Session => session != null);\n",
      typescript(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("does not flag a tuple type predicate", () => {
    const state = stateWith(
      "entries.filter((entry): entry is [string, string] => entry.length === 2);\n",
      typescript(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("does not flag a typed catch clause", () => {
    const state = stateWith(
      "try { run(); } catch (error: unknown) { report(error); }\n",
      typescript(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("does not flag a multiline JSX comment", () => {
    const open = `{${"/*"}`;
    const close = `${"*/"}}`;
    const state = stateWith(
      `function T() {\n  return (\n    <div>\n      ${open}\n        hello\n      ${close}\n      <span />\n    </div>\n  );\n}\n`,
      typescriptJsx(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("does not flag typeof import() type arguments", () => {
    const state = stateWith(
      'const actual = await importOriginal<typeof import("./fs")>();\n',
      typescript(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("does not flag Tailwind @source rules", () => {
    const state = stateWith(
      '@import "tailwindcss";\n@source "../node_modules/foo/*.js";\n@theme { --color-x: red; }\n',
      cssLang(),
    );
    expect(syntaxDiagnostics(state)).toEqual([]);
  });

  it("still flags a real TypeScript syntax error", () => {
    const state = stateWith("function go() {\n  return 1;\n", typescript());
    expect(syntaxDiagnostics(state).length).toBeGreaterThan(0);
  });

  it("does not flag the parse frontier on a long valid file", () => {
    const state = stateWith("const a = 1;\n".repeat(400), typescript());
    expect(syntaxDiagnostics(state)).toEqual([]);
  });
});

describe("isLintable", () => {
  it("accepts languages whose grammar reports errors", () => {
    for (const path of ["/a/b.ts", "/a/b.tsx", "/a/b.json", "/a/b.css", "/a/b.py"]) {
      expect(isLintable(path)).toBe(true);
    }
  });

  it("skips Markdown, whose parser accepts anything", () => {
    expect(isLintable("/a/README.md")).toBe(false);
    expect(isLintable("/a/b.mdx")).toBe(false);
  });

  it("skips Rust, whose highlighter grammar is too incomplete to lint", () => {
    expect(isLintable("/a/lib.rs")).toBe(false);
  });

  it("skips files with no grammar", () => {
    expect(isLintable("/a/notes.txt")).toBe(false);
    expect(isLintable("/a/Makefile")).toBe(false);
  });
});
