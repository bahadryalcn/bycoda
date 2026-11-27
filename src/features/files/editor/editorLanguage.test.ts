import { ensureSyntaxTree, language } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { languageForPath } from "./editorLanguage";
import { syntaxDiagnostics } from "./editorLint";

function languageName(extension: Extension): string | null {
  return EditorState.create({ extensions: [extension] }).facet(language)?.name ?? null;
}

describe("languageForPath", () => {
  it.each(["Dialog.js", "Dialog.jsx", "Dialog.mjs", "Dialog.cjs", "Dialog.tsx"])(
    "accepts React JSX in %s without cascading false errors",
    async (path) => {
      const extension = await languageForPath(path);
      const state = EditorState.create({
        doc: 'const show = () => open({ content: (<TransactionRefundDialog refetchTransactionReport={refetchTransactionReport} setIsLoading={setIsLoading} isSubMerchant={isSubMerchant} />), dialogProperties: { fullWidth: true, maxWidth: "sm" } });',
        extensions: [extension!],
      });
      expect(syntaxDiagnostics(state)).toEqual([]);
    },
  );
  it.each(["module.mts", "module.cts"])("parses TypeScript in %s", async (path) => {
    const extension = await languageForPath(path);
    expect(
      syntaxDiagnostics(
        EditorState.create({ doc: "const value: string = 'ok';", extensions: [extension!] }),
      ),
    ).toEqual([]);
  });
  it.each([
    "index.php",
    "Program.cs",
    "main.go",
    "app.dart",
    "View.swift",
    "Main.kt",
    "library.c",
    "library.hpp",
    "Application.java",
  ])("loads highlighting for reported language file %s", async (path) => {
    await expect(languageForPath(path)).resolves.not.toBeNull();
  });

  it("maps C files to C while keeping headers mapped to C++", async () => {
    const c = await languageForPath("library.c");
    const header = await languageForPath("library.h");

    expect(c).not.toBeNull();
    expect(header).not.toBeNull();
    expect(languageName(c!)).toBe("c");
    expect(languageName(header!)).toBe("cpp");
  });

  it.each([
    "app.rb",
    "deploy.sh",
    "query.sql",
    "workflow.yaml",
    "layout.xml",
    "Cargo.toml",
    "build.scala",
    "plugin.lua",
    "analysis.r",
    "script.pl",
    "profile.ps1",
    "Controller.m",
    "messages.proto",
    "Dockerfile",
    "settings.jsonc",
  ])("loads highlighting for additional mainstream file %s", async (path) => {
    await expect(languageForPath(path)).resolves.not.toBeNull();
  });

  it("leaves unknown file types as plain text", async () => {
    await expect(languageForPath("notes.unknown")).resolves.toBeNull();
  });

  it.each([".env", ".env.local", ".env.production", "app.env"])(
    "highlights %s as dotenv",
    async (path) => {
      const extension = await languageForPath(path);
      expect(extension).not.toBeNull();
      expect(languageName(extension!)).toBe("dotenv");
    },
  );

  it("colors dotenv keys, values and comments separately", async () => {
    const extension = await languageForPath(".env");
    const doc = [
      "# settings",
      "SESSION_EXPIRY_MS_TIME = -1 # 900000",
      "NEXT_PUBLIC_SESSION_UNLOAD_ENABLED = false",
      'export NEXT_PUBLIC_APP_VERSION = "0.0.0-${STAGE}"',
      "URL=http://x#y",
    ].join("\n");
    const state = EditorState.create({ doc, extensions: [extension!] });
    const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;
    const highlighter = tagHighlighter([
      { tag: tags.propertyName, class: "key" },
      { tag: tags.string, class: "string" },
      { tag: tags.number, class: "number" },
      { tag: tags.bool, class: "bool" },
      { tag: tags.comment, class: "comment" },
      { tag: tags.keyword, class: "keyword" },
      { tag: tags.meta, class: "meta" },
    ]);
    const tokens: string[] = [];
    highlightTree(tree, highlighter, (from, to, cls) => {
      tokens.push(`${cls}:${doc.slice(from, to)}`);
    });
    expect(tokens).toEqual([
      "comment:# settings",
      "key:SESSION_EXPIRY_MS_TIME",
      "number:-1",
      "comment:# 900000",
      "key:NEXT_PUBLIC_SESSION_UNLOAD_ENABLED",
      "bool:false",
      "keyword:export",
      "key:NEXT_PUBLIC_APP_VERSION",
      'string:"0.0.0-',
      "meta:${STAGE}",
      'string:"',
      "key:URL",
      "string:http://x#y",
    ]);
  });
});
