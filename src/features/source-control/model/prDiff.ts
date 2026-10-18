export type PrDiffLineKind = "add" | "del" | "context" | "hunk";

export type PrDiffLine = {
  kind: PrDiffLineKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
};

export type PrDiffStatus = "added" | "deleted" | "renamed" | "modified";

export type PrDiffFile = {
  path: string;
  previousPath: string | null;
  status: PrDiffStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  lines: PrDiffLine[];
};

export type PrDiffMetaFile = {
  path: string;
  additions: number;
  deletions: number;
};

export function parsePrPatch(patch: string): PrDiffFile[] {
  const text = patch.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  const files: PrDiffFile[] = [];
  const parts = text.split(/^diff --git /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const file = parsePrFile(`diff --git ${part}`);
    if (file) files.push(file);
  }
  return files;
}

export function mergePrDiff(
  meta: readonly PrDiffMetaFile[],
  parsed: readonly PrDiffFile[],
): PrDiffFile[] {
  if (parsed.length === 0) {
    return meta.map((file) => ({
      path: file.path,
      previousPath: null,
      status: "modified",
      binary: false,
      additions: file.additions,
      deletions: file.deletions,
      lines: [],
    }));
  }
  if (meta.length === 0) return [...parsed];

  const byPath = new Map(parsed.map((file) => [file.path, file]));
  const used = new Set<string>();
  const out: PrDiffFile[] = [];
  for (const file of meta) {
    const hit = byPath.get(file.path);
    if (hit) {
      out.push({
        ...hit,
        additions: file.additions,
        deletions: file.deletions,
      });
      used.add(file.path);
    } else {
      out.push({
        path: file.path,
        previousPath: null,
        status: "modified",
        binary: false,
        additions: file.additions,
        deletions: file.deletions,
        lines: [],
      });
    }
  }
  for (const file of parsed) {
    if (!used.has(file.path)) out.push(file);
  }
  return out;
}

function parsePrFile(block: string): PrDiffFile | null {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  let path = "";
  let previousPath: string | null = null;
  let status: PrDiffStatus = "modified";
  let binary = false;
  let additions = 0;
  let deletions = 0;
  const diffLines: PrDiffLine[] = [];
  let oldNum = 0;
  let newNum = 0;
  let inHunk = false;
  let sawHunk = false;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const line of lines) {
    const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      sawHunk = true;
      oldNum = Number(hunk[1]);
      newNum = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      inHunk = oldRemaining > 0 || newRemaining > 0;
      diffLines.push({ kind: "hunk", text: line, oldNumber: null, newNumber: null });
      continue;
    }
    if (sawHunk) {
      // Only prefixed records within the declared ranges are source lines.
      // In particular, ---/+++ inside a hunk are deletion/addition records.
      if (!inHunk) continue;
      if (line.startsWith("+") && newRemaining > 0) {
        additions += 1;
        diffLines.push({ kind: "add", text: line.slice(1), oldNumber: null, newNumber: newNum++ });
        newRemaining -= 1;
      } else if (line.startsWith("-") && oldRemaining > 0) {
        deletions += 1;
        diffLines.push({ kind: "del", text: line.slice(1), oldNumber: oldNum++, newNumber: null });
        oldRemaining -= 1;
      } else if (line.startsWith(" ") && oldRemaining > 0 && newRemaining > 0) {
        diffLines.push({
          kind: "context",
          text: line.slice(1),
          oldNumber: oldNum++,
          newNumber: newNum++,
        });
        oldRemaining -= 1;
        newRemaining -= 1;
      }
      inHunk = oldRemaining > 0 || newRemaining > 0;
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const paths = parseGitPaths(line);
      if (paths) {
        previousPath = paths[0] === paths[1] ? null : paths[0];
        path = paths[1];
      }
      continue;
    }
    if (line.startsWith("new file mode")) {
      status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      previousPath = unquoteDiffPath(line.slice("rename from ".length));
      status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      path = unquoteDiffPath(line.slice("rename to ".length));
      status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      const next = stripDiffPath(line.slice(4));
      if (next === "/dev/null") {
        if (status === "modified") status = "added";
      } else if (next && !previousPath && next !== path) {
        previousPath = next;
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const next = stripDiffPath(line.slice(4));
      if (next === "/dev/null") {
        status = "deleted";
      } else if (next) {
        path = next;
      }
      continue;
    }
  }

  if (!path) return null;
  if (status !== "renamed" || previousPath === path) previousPath = null;
  return {
    path,
    previousPath,
    status,
    binary,
    additions,
    deletions,
    lines: diffLines,
  };
}

function parseGitPaths(line: string): [string, string] | null {
  const rest = line.slice("diff --git ".length).trim();
  const paths = rest.match(/^("(?:\\.|[^"\\])*"|a\/.*) ("(?:\\.|[^"\\])*"|b\/.*)$/);
  if (paths) return [stripDiffPath(paths[1]), stripDiffPath(paths[2])];
  return null;
}

function stripDiffPath(raw: string): string {
  let value = raw.trim();
  const tab = value.indexOf("\t");
  if (tab >= 0) value = value.slice(0, tab);
  value = unquoteDiffPath(value);
  if (value === "/dev/null") return value;
  if (value.startsWith("a/") || value.startsWith("b/")) return value.slice(2);
  return value;
}

function unquoteDiffPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const escapes: Record<string, string> = {
    a: "\x07",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    '"': '"',
    "\\": "\\",
  };
  return value.slice(1, -1).replace(/(?:\\[0-7]{1,3})+|\\[abtnvfr"\\]/g, (escape) => {
    if (/^\\[0-7]/.test(escape)) {
      const bytes = Array.from(escape.matchAll(/\\([0-7]{1,3})/g), (match) =>
        parseInt(match[1], 8),
      );
      return new TextDecoder().decode(new Uint8Array(bytes));
    }
    return escapes[escape[1]];
  });
}
