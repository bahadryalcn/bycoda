/**
 * What a file reference in a reply is, for colour and icon decisions: one small set of kinds
 * mapped from the file name, plus the theme tones an owner may pick for each kind.
 */
export const FILE_REF_KINDS = [
  "code",
  "markup",
  "docs",
  "data",
  "media",
  "archive",
  "folder",
  "other",
] as const;
export type FileRefKind = (typeof FILE_REF_KINDS)[number];

/** Fixed theme tones (the `--color-<tone>` roles); there are no free colour values. */
export const FILE_REF_TONES = [
  "info",
  "success",
  "warning",
  "danger",
  "feature",
  "orchestration",
  "accent",
  "neutral",
] as const;
export type FileRefTone = (typeof FILE_REF_TONES)[number];

export const FILE_REF_TONE_DEFAULTS: Record<FileRefKind, FileRefTone> = {
  code: "info",
  markup: "warning",
  docs: "feature",
  data: "success",
  media: "orchestration",
  archive: "neutral",
  folder: "accent",
  other: "neutral",
};

const words = (list: string) => list.split(" ");
const EXTENSION_KINDS: Record<Exclude<FileRefKind, "folder" | "other">, readonly string[]> = {
  code: words(
    "ts tsx mts cts js jsx mjs cjs py pyi rs go java kt kts swift c h cc cpp cxx hpp cs rb php sh bash zsh fish ps1 psm1 bat sql lua dart scala exs erl hs clj vue svelte astro css scss sass styl gradle graphql gql proto zig nim jl",
  ),
  markup: words("html htm xhtml xml xsl xslt jsp aspx ejs hbs pug"),
  docs: words("md mdx markdown txt pdf doc docx rtf odt tex rst adoc epub ppt pptx odp"),
  data: words(
    "json jsonc json5 jsonl ndjson yaml yml toml csv tsv xlsx xls ods ini cfg conf ipynb parquet sqlite plist",
  ),
  media: words(
    "png jpg jpeg gif webp avif bmp ico icns tif tiff heic svg psd mp4 m4v mov webm mkv avi ogv mp3 m4a aac wav ogg oga opus flac",
  ),
  archive: words("zip tar gz tgz bz2 xz 7z rar zst"),
};
// `log`, `map`, `env` and `lock` are real file types but read as code in `console.log`,
// `array.map` and `process.env`, so only the whole dotfile or lock name counts (see NAMED_KINDS).
const KIND_BY_EXTENSION = new Map<string, FileRefKind>(
  (Object.entries(EXTENSION_KINDS) as [FileRefKind, readonly string[]][]).flatMap(([kind, list]) =>
    list.map((ext) => [ext, kind] as const),
  ),
);
const NAMED_KINDS = new Map<string, FileRefKind>([
  ["dockerfile", "code"],
  ["makefile", "code"],
  ["gemfile", "code"],
  ["rakefile", "code"],
  ["license", "docs"],
  ["readme", "docs"],
  ["changelog", "docs"],
  [".env", "data"],
  [".gitignore", "data"],
  [".gitattributes", "data"],
  [".editorconfig", "data"],
  [".npmrc", "data"],
  [".prettierrc", "data"],
  [".eslintrc", "data"],
  ["package-lock.json", "data"],
  ["pnpm-lock.yaml", "data"],
  ["yarn.lock", "data"],
  ["cargo.lock", "data"],
]);

function extensionOf(name: string): string {
  const leaf =
    name
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}
function leafOf(name: string): string {
  return (
    name
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? ""
  ).toLowerCase();
}

/**
 * True when the name carries a file type this app recognises. A dotted word such as
 * `images.generate` or `logs.sources` is an identifier, not a file, so it is not known.
 */
export function isKnownFileType(name: string): boolean {
  const leaf = leafOf(name);
  return (
    NAMED_KINDS.has(leaf) ||
    /^\.env\.[\w.-]+$/.test(leaf) ||
    KIND_BY_EXTENSION.has(extensionOf(name))
  );
}

/** Kind of a file or folder by name; a directory is always `folder`, an unlisted file `other`. */
export function fileReferenceKind(name: string, isDir: boolean): FileRefKind {
  if (isDir) return "folder";
  const leaf = leafOf(name);
  if (/^\.env\.[\w.-]+$/.test(leaf)) return "data";
  return NAMED_KINDS.get(leaf) ?? KIND_BY_EXTENSION.get(extensionOf(name)) ?? "other";
}

const LOCATION = /(?::(\d+)(?::(\d+))?|#L(\d+)(?::(\d+))?(?:-L?(\d+))?)$/;
/**
 * Splits a trailing line location (`:711`, `:711:5`, `#L13`, `#L13-L20`) off a reference so it can
 * show quieter than the name. `location` reads `L711`, `L711:5` or `L13-20`.
 */
export function splitFileLocation(text: string): { name: string; location?: string } {
  const match = LOCATION.exec(text);
  if (!match || match.index === 0) return { name: text };
  const name = text.slice(0, match.index);
  if (match[1]) return { name, location: `L${match[1]}${match[2] ? `:${match[2]}` : ""}` };
  const end = match[5] ?? match[4];
  return { name, location: `L${match[3]}${match[5] ? `-${end}` : match[4] ? `:${match[4]}` : ""}` };
}
