import { parentPath, pathKey } from "../../../shared/lib/paths";

export const OPEN_CODE_WORKSPACE_EVENT = "bycoda:open-code-workspace";

const EXTENSION = ".code-workspace";

/** The folders of a VS Code `.code-workspace` file, resolved to absolute paths. */
export type CodeWorkspace = {
  name: string;
  folders: string[];
  /** Display names keyed by the resolved full project path. */
  folderNames: Record<string, string>;
  /** Entries Bycoda cannot open, such as remote `uri` folders. */
  unsupported: string[];
};

/** VS Code writes these files as JSON with comments, so `JSON.parse` alone fails. */
function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      out += ch;
      i += 1;
    } else if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Expects comments to be gone already. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        i += 1;
        out += text[i] ?? "";
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === "," && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    out += ch;
  }
  return out;
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("/");
}

function collapseSegments(path: string): string {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? "";
  const root = !drive && path.startsWith("//") ? "//" : "/";
  const parts: string[] = [];
  for (const segment of path.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `${drive}${root}${parts.join("/")}`;
}

function resolveFolder(folder: string, base: string, windows: boolean): string {
  const path = windows ? folder.replace(/\\/g, "/") : folder;
  return collapseSegments(isAbsolute(path) ? path : `${base}/${path}`);
}

function workspaceName(filePath: string): string {
  const file = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = file.toLowerCase().endsWith(EXTENSION) ? file.slice(0, -EXTENSION.length) : file;
  return stem || "Workspace";
}

/** Parses data-only configuration with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

/** Throws with a message fit to show the user when the file cannot be used. */
export function parseCodeWorkspace(text: string, filePath: string): CodeWorkspace {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    throw new Error("The workspace file is not valid JSON.");
  }
  const entries =
    parsed && typeof parsed === "object" ? (parsed as { folders?: unknown }).folders : undefined;
  if (!Array.isArray(entries)) {
    throw new Error("The workspace file has no folders list.");
  }

  const windows = isWindowsPath(filePath);
  const base = parentPath(windows ? filePath.replace(/\\/g, "/") : filePath);
  const folders: string[] = [];
  const folderNames: Record<string, string> = {};
  const unsupported: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const candidate = (entry ?? {}) as { path?: unknown; uri?: unknown; name?: unknown };
    if (typeof candidate.path !== "string" || !candidate.path.trim()) {
      unsupported.push(typeof candidate.uri === "string" ? candidate.uri : "(unknown entry)");
      continue;
    }
    const folder = resolveFolder(candidate.path.trim(), base, windows);
    const key = pathKey(folder);
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(folder);
    folderNames[key] =
      typeof candidate.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : folder.split("/").pop() || folder;
  }
  return { name: workspaceName(filePath), folders, folderNames, unsupported };
}
