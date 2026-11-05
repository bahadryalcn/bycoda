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

// Shiki (via Streamdown's CodeBlock) treats these as plaintext and renders no
// syntax colors at all, which is common in agent output (pseudocode, file
// trees, command output) fenced as `text` or left untagged. Falling back to
// the JS grammar for these still colors strings, numbers, and punctuation,
// matching what most agent-output fences actually look like.
export const PLAINTEXT_FENCE_LANGUAGES = new Set(["text", "plaintext", "txt", ""]);

export function highlightLanguageFor(language: string): string {
  return PLAINTEXT_FENCE_LANGUAGES.has(language.toLowerCase()) ? "js" : language;
}
