import { describe, expect, it } from "vitest";
import { detectCodeLanguage, highlightLanguageFor } from "./agentMarkdownLanguages";

describe("untagged fence language detection", () => {
  it.each([
    ["bash", "$ pnpm install\n$ pnpm test"],
    ["bash", "#!/bin/bash\nset -e\necho done"],
    ["bash", "rm -rf build/*\nmkdir build"],
    ["bash", "# install\nnpm install\ngit status"],
    ["json", '{\n  "name": "app",\n  "version": "1.0.0"\n}'],
    ["json", '[{"id": 1}, {"id": 2}]'],
    ["diff", "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-a\n+b"],
    ["diff", "@@ -10,3 +10,4 @@ function f() {\n   keep\n+  added\n"],
    ["typescript", 'import { a } from "./a";\n\nexport interface Props {\n  name: string;\n}'],
    ["javascript", "const total = items.reduce((sum, item) => sum + item, 0);"],
    ["tsx", "export function App() {\n  return <div>Hi</div>;\n}"],
    ["python", "def main():\n    print('hi')\n\nif __name__ == '__main__':\n    main()"],
    ["python", "from pathlib import Path\nroot = Path('.')"],
    ["rust", 'fn main() {\n    let mut x = 1;\n    println!("{x}");\n}'],
    ["rust", "use std::fs;\n\npub struct Config {\n    name: String,\n}"],
    ["html", '<div class="card">\n  <p>Hello</p>\n</div>'],
    ["html", "<!DOCTYPE html>\n<html>"],
    ["xml", '<?xml version="1.0"?>\n<root/>'],
    ["yaml", "name: build\non:\n  push:\n    branches: [main]"],
    ["sql", "SELECT id, name\nFROM users\nWHERE active = 1;"],
    ["powershell", "Get-ChildItem -Recurse | Where-Object { $_.Length -gt 0 }"],
    ["powershell", "$env:PATH += ';C:\\tools'"],
    ["css", ".card {\n  color: red;\n  padding: 4px;\n}"],
  ])("detects %s", (language, code) => {
    expect(detectCodeLanguage(code)).toBe(language);
  });

  it.each([
    "",
    "src/\n  index.ts\n  app.tsx",
    "Build finished in 3.2s with 0 warnings.",
    "<path> is the file to open",
    "Select the file from the menu.",
    "a => b",
    "Error: something failed",
  ])("falls back to plain text when unsure: %j", (code) => {
    expect(detectCodeLanguage(code)).toBe("text");
  });

  it("reads only a bounded prefix", () => {
    const code = `${"plain line\n".repeat(60)}const x = 1;\n`;
    expect(detectCodeLanguage(code)).toBe("text");
  });

  it("detects only untagged fences and keeps explicit text plain", () => {
    expect(highlightLanguageFor("", "rm -rf build/*")).toBe("bash");
    expect(highlightLanguageFor("text", "rm -rf build/*")).toBe("text");
    expect(highlightLanguageFor("TXT", "const x = 1;")).toBe("text");
    expect(highlightLanguageFor("python", "rm -rf build/*")).toBe("python");
  });
});
