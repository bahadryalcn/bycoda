/** Fence language names for the highlighter, keyed by file extension or file name. */
export const LANGUAGE_FROM_EXT: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  yml: "yaml",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
};

export const LANGUAGE_FILE_NAMES: Record<string, string> = {
  bash: "code.sh",
  c: "code.c",
  cpp: "code.cpp",
  "c++": "code.cpp",
  csharp: "code.cs",
  css: "code.css",
  go: "code.go",
  html: "code.html",
  java: "code.java",
  javascript: "code.js",
  js: "code.js",
  jsx: "code.jsx",
  json: "code.json",
  markdown: "code.md",
  md: "code.md",
  php: "code.php",
  python: "code.py",
  py: "code.py",
  ruby: "code.rb",
  rust: "code.rs",
  rs: "code.rs",
  shell: "code.sh",
  sh: "code.sh",
  sql: "code.sql",
  swift: "code.swift",
  toml: "code.toml",
  ts: "code.ts",
  tsx: "code.tsx",
  typescript: "code.ts",
  xml: "code.xml",
  yaml: "code.yaml",
  yml: "code.yaml",
  zsh: "code.sh",
};

/** Fence languages that name no grammar; the block's own label shows them instead of Shiki's. */
export const PLAINTEXT_FENCE_LANGUAGES = new Set(["text", "plaintext", "txt", ""]);

/** Shiki's grammar-less language: rendered as plain text without tokenizing. */
export const PLAIN_TEXT_LANGUAGE = "text";

/**
 * The grammar to highlight a fence with. An untagged fence gets the language its code
 * looks like, or plain text when unsure; an explicit `text` fence stays plain.
 */
export function highlightLanguageFor(language: string, code = ""): string {
  const lower = language.toLowerCase();
  if (lower === "") return detectCodeLanguage(code);
  return PLAINTEXT_FENCE_LANGUAGES.has(lower) ? PLAIN_TEXT_LANGUAGE : language;
}

/** Detection reads only this much of a block, so a streaming fence costs the same every frame. */
const DETECT_MAX_CHARS = 4_000;
const DETECT_MAX_LINES = 50;

const SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+)?(\w+)/;
const SHEBANG_LANGUAGES: Record<string, string> = {
  bash: "bash",
  sh: "bash",
  zsh: "bash",
  python: "python",
  python3: "python",
  node: "javascript",
  pwsh: "powershell",
};
const DIFF = /^(?:diff --git |--- a\/|\+\+\+ b\/|@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/m;
const JSON_START = /^\s*(?:\{\s*(?:"|\}|$)|\[\s*(?:["{[\]\d-]|true\b|false\b|null\b|$))/;
const XML_START = /^\s*<\?xml\b/;
const HTML_START = /^\s*(?:<!doctype html|<!--|<[a-z][\w:-]*(?:\s[^>]*)?\/?>)/i;
/** A lone `<placeholder>` line is prose; markup closes a tag somewhere. */
const HTML_MARKUP = /<\/[a-z][\w:-]*>|^\s*<!doctype html/i;
const POWERSHELL =
  /^\s*(?:PS [^>\n]*> )?(?:Get|Set|New|Remove|Write|Invoke|Start|Stop|Test|Import|Select|Where|ForEach|Copy|Move|Out)-[A-Z]\w+|\$env:\w+|-ErrorAction\b/m;
const SHELL_PROMPT = /^\s*\$ \S/;
const SHELL_COMMAND =
  /^\s*(?:sudo\s+)?(?:npm|pnpm|npx|yarn|bun|deno|node|git|gh|cd|ls|mkdir|rm|rmdir|cp|mv|cat|echo|export|apt|apt-get|brew|curl|wget|docker|kubectl|pip3?|uv|cargo|rustup|go|make|chmod|chown|tar|unzip|grep|rg|find|sed|awk|ssh|scp|source|touch|which|tsc|vp|python3?\s+-m)(?=\s|$)/;
const RUST =
  /\bfn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->|\{)|\blet\s+mut\s+\w|^\s*(?:pub\s+)?(?:impl|struct|enum|mod|trait)\s+\w|^\s*use\s+\w+::|#\[derive\(|\bprintln!\(/m;
const PYTHON =
  /^\s*(?:async\s+)?def\s+\w+\s*\(.*\)\s*(?:->\s*[^:]+)?:\s*$|^\s*class\s+\w+(?:\(.*\))?:\s*$|^\s*from\s+[\w.]+\s+import\s|^\s*import\s+[\w.]+(?:\s+as\s+\w+)?\s*$|^if __name__ ==/m;
const SCRIPT =
  /^\s*(?:import\s.+\sfrom\s+["']|import\s+["']|export\s+(?:default|const|let|function|class|interface|type|async)\b|(?:const|let|var)\s+[\w{[]|(?:async\s+)?function\s*\w*\s*\(|interface\s+\w+|type\s+\w+\s*=)|\([^()\n]*\)\s*=>\s*[{(\w]|\bconsole\.\w+\(|\brequire\(["']/m;
const TYPESCRIPT_ONLY =
  /^\s*(?:export\s+)?(?:interface|type)\s+\w+|:\s*(?:string|number|boolean|unknown|void)\b|\bas const\b/m;
const JSX = /<\/[A-Za-z][\w.]*>|<[A-Z]\w*[\s/>]/;
const SQL =
  /^\s*(?:SELECT\s[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW|DATABASE|SCHEMA)\b|ALTER\s+TABLE\b|DROP\s+TABLE\b|WITH\s+\w+\s+AS\s*\()/m;
const CSS_RULE = /^\s*(?:[.#:@]?[\w-]+[^{};\n]*)\{\s*$/m;
const CSS_DECLARATION = /^\s*-{0,2}[a-z][\w-]*\s*:\s*[^;{}]+;\s*$/m;
const YAML_LINE = /^\s*(?:- )?[\w.-]+:(?:\s|$)|^\s*- \S|^---\s*$/;

/**
 * A cheap guess at the language of an untagged fence from its first lines: plain text
 * unless a signal is clear, since a wrong grammar colors worse than none (a shell glob
 * read as JavaScript turns the rest of the block into a comment).
 */
export function detectCodeLanguage(code: string): string {
  const lines = code.slice(0, DETECT_MAX_CHARS).split("\n", DETECT_MAX_LINES);
  const sample = lines.join("\n");
  const meaningful = lines.filter((line) => line.trim() !== "");
  if (meaningful.length === 0) return PLAIN_TEXT_LANGUAGE;
  const shebang = SHEBANG.exec(meaningful[0]);
  if (shebang) return SHEBANG_LANGUAGES[shebang[1]] ?? PLAIN_TEXT_LANGUAGE;
  if (DIFF.test(sample)) return "diff";
  if (XML_START.test(sample)) return "xml";
  if (JSON_START.test(sample)) return "json";
  if (HTML_START.test(sample) && HTML_MARKUP.test(sample)) return "html";
  if (POWERSHELL.test(sample)) return "powershell";
  const commands = meaningful.filter((line) => !line.trimStart().startsWith("#"));
  if (commands.length > 0 && SHELL_PROMPT.test(commands[0])) return "bash";
  if (RUST.test(sample)) return "rust";
  if (PYTHON.test(sample)) return "python";
  if (SCRIPT.test(sample)) {
    if (JSX.test(sample)) return "tsx";
    return TYPESCRIPT_ONLY.test(sample) ? "typescript" : "javascript";
  }
  if (SQL.test(sample)) return "sql";
  if (CSS_RULE.test(sample) && CSS_DECLARATION.test(sample)) return "css";
  const shellLines = commands.filter((line) => SHELL_COMMAND.test(line)).length;
  if (commands.length > 0 && SHELL_COMMAND.test(commands[0]) && shellLines * 2 >= commands.length)
    return "bash";
  const yamlLines = meaningful.filter((line) => YAML_LINE.test(line)).length;
  if (yamlLines >= 2 && yamlLines === meaningful.length) return "yaml";
  return PLAIN_TEXT_LANGUAGE;
}
