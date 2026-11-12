import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existingPath, searchHostContent } from "./workspace";
import { publishWorkspaceFile } from "../storage/workspace-publication";
import { withWorkspaceMutation } from "./workspace-mutations";

/** Review hashes fence every write; search page limits also bound replacement scope. */
export async function replaceHostContent(
  root: string,
  input: unknown,
  authorize: () => Promise<void>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid replacement");
  const options = input as Record<string, unknown>;
  if (
    typeof options.query !== "string" ||
    !options.query.trim() ||
    typeof options.replacement !== "string" ||
    Buffer.byteLength(options.replacement) > 512 * 1024 ||
    typeof options.dryRun !== "boolean"
  )
    throw new Error("Invalid replacement");
  const replacement = options.replacement;
  const pattern = replacementPattern(options);
  const search = await searchHostContent(root, options);
  const files = new Map<string, Set<number>>();
  for (const match of search.matches) {
    const lines = files.get(match.relative) ?? new Set<number>();
    lines.add(match.line);
    files.set(match.relative, lines);
  }
  const result = {
    filesChanged: 0,
    replacements: 0,
    failures: [] as string[],
    revisions: {} as Record<string, string>,
  };
  const revisions = options.revisions as Record<string, unknown> | undefined;
  if (!options.dryRun && revisions)
    for (const relative of Object.keys(revisions))
      if (!files.has(relative)) files.set(relative, new Set());
  for (const [relative, lines] of files) {
    try {
      await withWorkspaceMutation(root, async () => {
        const path = await existingPath(root, relative);
        const original = await stat(path);
        if (!original.isFile() || original.size > 512 * 1024) throw new Error("File is too large");
        const bytes = await readFile(path);
        if (bytes.includes(0)) throw new Error("Binary file");
        const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        const revision = createHash("sha256").update(bytes).digest("hex");
        if (!options.dryRun && revisions?.[relative] !== revision)
          throw new Error("File changed since confirmation; search again");
        const data = {
          text,
          replacement,
          lines: [...lines],
          source: pattern.source,
          flags: pattern.flags,
          regex: options.regex === true,
          wholeWord: options.wholeWord === true,
        };
        const { content, count } = options.regex ? await replaceInWorker(data) : replaceText(data);
        if (!count || content === text) return;
        if (!options.dryRun) {
          await publishWorkspaceFile(path, content, original, async () => {
            await authorize();
            if (
              (await existingPath(root, relative)) !== path ||
              !(await readFile(path)).equals(bytes)
            )
              throw new Error("File changed before saving");
          });
        }
        result.filesChanged++;
        result.replacements += count;
        result.revisions[relative] = revision;
      });
    } catch (error) {
      result.failures.push(
        `${relative}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}

export function replacementPattern(options: Record<string, unknown>): RegExp {
  const query = String(options.query).trim();
  // Keep the common Rust/JavaScript regex subset; never silently reinterpret lookaround or backreferences.
  if (options.regex && /\(\?[=!<]|\\[1-9]|\(\?[a-z-]+\)/.test(query))
    throw new Error("This regular expression is unsupported for remote search");
  const classes: Record<string, string> = {
    digit: "0-9",
    lower: "a-z",
    upper: "A-Z",
    alpha: "a-zA-Z",
    alnum: "a-zA-Z0-9",
    word: "a-zA-Z0-9_",
    space: "\\s",
    blank: " \\t",
    xdigit: "a-fA-F0-9",
    ascii: "\\x00-\\x7f",
    cntrl: "\\x00-\\x1f\\x7f",
    graph: "!-~",
    print: " -~",
    punct: "!-/:-@\\[-`{-~",
  };
  const expression = !options.regex
    ? query
    : query.replace(/\[:([a-z]+):\]/g, (_token, name: string) => {
        if (!(name in classes)) throw new Error("Unsupported POSIX character class");
        return classes[name];
      });
  return new RegExp(
    options.regex ? expression : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    options.caseSensitive ? "gu" : "giu",
  );
}

type ReplaceInput = {
  text: string;
  replacement: string;
  lines: number[];
  source: string;
  flags: string;
  regex: boolean;
  wholeWord: boolean;
};

/** Closure-free: regex matching runs off the Host event loop with a deadline. */
function replaceText(input: ReplaceInput): { content: string; count: number } {
  const pattern = new RegExp(input.source, input.flags);
  const lines = new Set(input.lines);
  const parts: string[] = [];
  let count = 0;
  let bytes = 0;
  const append = (part: string) => {
    bytes += Buffer.byteLength(part);
    if (bytes > 512 * 1024) throw new Error("Replacement would exceed 512 KiB");
    parts.push(part);
  };
  const body = input.text.startsWith("\ufeff") ? input.text.slice(1) : input.text;
  if (body !== input.text) append("\ufeff");
  for (const [index, chunk] of body.split(/(?<=\n)/).entries()) {
    if (!lines.has(index + 1)) {
      append(chunk);
      continue;
    }
    const line = chunk.replace(/[\r\n]+$/, "");
    let end = 0;
    for (const match of line.matchAll(pattern)) {
      const offset = match.index;
      if (
        input.wholeWord &&
        (/[\p{L}\p{N}_]$/u.test(line.slice(0, offset)) ||
          /^[\p{L}\p{N}_]/u.test(line.slice(offset + match[0].length)))
      )
        continue;
      append(line.slice(end, offset));
      const replacement = input.regex
        ? input.replacement.replace(
            /\$\$|\$\{([^}]+)\}|\$([\w]+)/g,
            (token, braced: string, plain: string) => {
              if (token === "$$") return "$";
              const key = braced ?? plain;
              return (/^\d+$/.test(key) ? match[Number(key)] : match.groups?.[key]) ?? "";
            },
          )
        : input.replacement;
      append(replacement);
      count++;
      end = offset + match[0].length;
    }
    append(line.slice(end));
    append(chunk.slice(line.length));
  }
  return { content: parts.join(""), count };
}

function replaceInWorker(input: ReplaceInput): Promise<{ content: string; count: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads"); parentPort.postMessage((${replaceText.toString()})(workerData));`,
      { eval: true, workerData: input },
    );
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate().catch(() => {});
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("Regular expression timed out"));
    }, 2000);
    worker.once("message", (result: { content: string; count: number }) => {
      finish();
      resolve(result);
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error("Regular expression worker stopped"));
      }
    });
  });
}
