// @vitest-environment happy-dom
import { CompletionContext } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorReadability } from "./editorReadability";
import { cssVariableCompletions } from "./editorAutocomplete";
import { languageForPath } from "./editorLanguage";

const views: EditorView[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});
function mount(doc: string, path = "test.ts", language: Extension = javascript({ jsx: true })) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    doc,
    extensions: [language, editorReadability(path)],
  });
  views.push(view);
  return view;
}

describe("editor readability", () => {
  it("does not stack tag highlights when two cursors are in the same element", () => {
    const view = mount("<div>text</div>", "test.tsx", [
      javascript({ jsx: true }),
      EditorState.allowMultipleSelections.of(true),
    ]);
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(3)]),
    });
    expect(
      [...view.dom.querySelectorAll(".cm-matchingBracket")].map((node) => node.textContent),
    ).toEqual(["div", "div"]);
  });

  it("does not mark differently named JSX tags as a matching pair", () => {
    const view = mount("<Widget>text</Other>", "test.tsx");
    view.dispatch({ selection: { anchor: 3 } });
    expect(view.dom.querySelector(".cm-matchingBracket")).toBeNull();
  });

  it.each([
    ["index.html", 2],
    ["index.xml", 0],
  ] as const)("respects tag-name case rules in %s", async (path, count) => {
    const view = mount("<DIV>text</div>", path, (await languageForPath(path))!);
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.dom.querySelectorAll(".cm-matchingBracket")).toHaveLength(count);
  });

  it("keeps native unmatched-bracket feedback", () => {
    const view = mount("const a = [1;");
    view.dispatch({ selection: { anchor: 11 } });
    expect(view.dom.querySelector(".cm-nonmatchingBracket")?.textContent).toBe("[");
  });
  it("colors template interpolation pairs without coloring template text", () => {
    const view = mount("const x = `literal () ${fn({x: [1]})}`;");
    const nodes = [...view.dom.querySelectorAll('[class*="cm-rainbowBracket-"]')];
    expect(nodes.map((node) => node.textContent)).toEqual([
      "${",
      "(",
      "{",
      "[",
      "]",
      "}",
      ")",
      "}",
    ]);
    expect(nodes[0].className).toBe(nodes.at(-1)!.className);
    expect(nodes[1].className).not.toBe(nodes[0].className);
  });

  it.each([
    ["test.py", 'def f():\n  return [{"a": (1, 2)}]\n# TODO'],
    ["test.rs", "fn f() { let a = [(1, 2)]; } // TODO"],
    ["test.go", 'func f() { x := []int{1,2}; s := "[ignore]" } // TODO [ignore]'],
  ])("supports nested brackets and comments in %s", async (path, doc) => {
    const view = mount(doc, path, (await languageForPath(path))!);
    const nodes = [...view.dom.querySelectorAll('[class*="cm-rainbowBracket-"]')];
    expect(nodes.length).toBeGreaterThan(4);
    expect(new Set(nodes.map((node) => node.className)).size).toBeGreaterThan(1);
    expect(nodes.map((node) => node.textContent).join("")).not.toContain("ignore");
    expect(view.dom.querySelector(".cm-commentAnnotation")?.textContent).toBe("TODO");
    expect(view.state.doc.toString()).toBe(doc);
  });
  it("uses the highest diagnostic severity regardless of arrival order", () => {
    const view = mount("const value = 1;");
    view.dispatch(
      setDiagnostics(view.state, [
        { from: 0, to: 1, severity: "info", message: "Information" },
        { from: 2, to: 3, severity: "warning", message: "Warning" },
      ]),
    );
    expect(view.dom.querySelector(".cm-diagnosticLabel")?.className).toContain(
      "cm-readability-warning",
    );
  });

  it("does not preview CSS identifier fragments or ordinary string prose as named colors", () => {
    vi.spyOn(CSS, "supports").mockImplementation(
      (property, value) => property === "color" && value === "red",
    );
    const view = mount(
      'a { animation-name: red-spinner; font-family: "red apple"; color: red; }',
      "theme.css",
      css(),
    );
    expect(
      [...view.dom.querySelectorAll(".cm-colorSwatch")].map((node) => node.getAttribute("title")),
    ).toEqual(["red"]);
  });

  it("recognizes individual alert lines in a starred block comment", () => {
    const view = mount("/*\n * ! danger\n * ? question\n * * important\n */");
    expect(view.dom.querySelector(".cm-readability-error")?.textContent).toContain("! danger");
    expect(view.dom.querySelector(".cm-readability-info")?.textContent).toContain("? question");
  });

  it("refreshes tag matching when the language arrives after the selection", () => {
    const language = new Compartment();
    const view = mount("<div><div>inner</div></div>", "index.html", language.of([]));
    view.dispatch({ selection: { anchor: 2 } });
    view.dispatch({ effects: language.reconfigure(html()) });
    view.focus();
    expect(
      [...view.dom.querySelectorAll(".cm-matchingBracket")].map((node) => node.textContent),
    ).toEqual(["div", "div"]);
  });

  it("colors nested structure without coloring bracket-like text or changing source", () => {
    const doc =
      'function f() {\n  const a = [{ x: "[text]" }];\n  // TODO: keep [comment] plain\n}';
    const view = mount(doc);
    expect(view.dom.querySelectorAll(".cm-indentBand").length).toBeGreaterThan(0);
    const brackets = [...view.dom.querySelectorAll('[class*="cm-rainbowBracket-"]')];
    expect(brackets.map((node) => node.textContent).join("")).not.toContain("text");
    expect(brackets.map((node) => node.textContent).join("")).not.toContain("comment");
    expect(new Set(brackets.map((node) => node.className)).size).toBeGreaterThan(1);
    expect(view.dom.querySelector(".cm-commentAnnotation")?.textContent).toBe("TODO:");
    expect(view.state.doc.toString()).toBe(doc);
    view.dispatch({
      changes: { from: doc.indexOf("TODO"), to: doc.indexOf("TODO") + 4, insert: "FIXME" },
    });
    expect(view.dom.querySelector(".cm-commentAnnotation")?.className).toContain(
      "cm-readability-error",
    );
  });

  it("shows asynchronous diagnostics inline, groups a line and removes resolved messages", () => {
    const view = mount("const value = ;");
    view.dispatch(
      setDiagnostics(view.state, [
        { from: 14, to: 15, severity: "error", message: "Expected an expression <script>" },
      ]),
    );
    expect(view.dom.querySelector(".cm-diagnosticLabel")?.textContent).toContain(
      "Expected an expression <script>",
    );
    expect(view.dom.querySelector("script")).toBeNull();
    view.dispatch(setDiagnostics(view.state, []));
    expect(view.dom.querySelector(".cm-diagnosticLabel")).toBeNull();
  });

  it("highlights log levels only for output/log files", () => {
    const view = mount("[12:00] ERROR connection failed\nINFO ready\nWARN retry", "server.log");
    expect(view.dom.querySelectorAll(".cm-logLine-error")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-logLine-info")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-logLine-warning")).toHaveLength(1);
    const code = mount('const ERROR = "WARN";');
    expect(code.dom.querySelector(".cm-logLine")).toBeNull();
  });

  it("does not confuse TODO identifiers or strings with annotations", () => {
    const view = mount('const TODO = "FIXME"; // ! important');
    expect(view.dom.querySelector(".cm-commentAnnotation")).toBeNull();
    expect(view.dom.querySelector(".cm-readability-error")?.textContent).toBe("// ! important");
  });

  it("keeps oversized documents usable without visual scanning", () => {
    const view = mount("// TODO\n" + " ".repeat(512 * 1024));
    expect(view.dom.querySelector(".cm-commentAnnotation")).toBeNull();
  });
});

describe("CSS variable completion", () => {
  it("collects actual embedded CSS declarations, not HTML prose or attributes", () => {
    const doc =
      '<div data-example="--fake: red;">--outside: red;</div><style>:root { --real: blue; } a {color: var(--re);}</style>';
    const pos = doc.indexOf("var(--re") + 8;
    const state = EditorState.create({ doc, extensions: html() });
    expect(
      cssVariableCompletions(new CompletionContext(state, pos, true))?.options.map(
        (option) => option.label,
      ),
    ).toEqual(["--real"]);
  });
  it("offers unsaved declarations with values, excludes comments and replaces only the prefix", () => {
    const doc =
      ":root { --brand: #abc; --spacing: 8px; }\n/* --fake: red; */\na { color: var(--br); }";
    const pos = doc.lastIndexOf("--br") + 4;
    const state = EditorState.create({ doc, extensions: css() });
    const result = cssVariableCompletions(new CompletionContext(state, pos, true));
    expect(result?.from).toBe(pos - 4);
    expect(result?.options).toEqual([
      { label: "--brand", info: "#abc", type: "variable" },
      { label: "--spacing", info: "8px", type: "variable" },
    ]);
  });
  it("does not open inside comments or unrelated custom-property declarations", () => {
    for (const doc of ["/* var(--br", ":root { --br"]) {
      const state = EditorState.create({ doc, extensions: css() });
      expect(cssVariableCompletions(new CompletionContext(state, doc.length, true))).toBeNull();
    }
  });
});
