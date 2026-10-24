import { relative } from "node:path";
import { createHash } from "node:crypto";
import {
  existingPath,
  hostFileDiff,
  hostGitIndex,
  indexHostFiles,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  createHostPath,
  writeHostFile,
} from "./workspace";
import { hostBranches } from "./git-branches";
import { hostWorktrees } from "./git-worktrees";
import { scrubRuntimeLogText } from "./runtime-logs";
import { inspectConversationPath, mutateConversationPath } from "./conversation-file-mutations";
import type { WorkspaceCommands } from "./workspace-commands";

const path = { type: "string", minLength: 1, maxLength: 4096 };
const expectedHash = { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
const pagination = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const textPage = {
  offset: { type: "integer", minimum: 0 },
  maxChars: { type: "integer", minimum: 200, maximum: 16000 },
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const CONVERSATION_FILE_TOOLS = {
  "files.inspect": object({ path }, ["path"]),
  "files.rename": object({ path, name: path, expectedHash }, ["path", "name", "expectedHash"]),
  "files.move": object({ path, destinationParent: path, expectedHash }, ["path", "destinationParent", "expectedHash"]),
  "files.copy": object({ path, destinationParent: path, expectedHash }, ["path", "destinationParent", "expectedHash"]),
  "files.delete": object({ path, expectedHash }, ["path", "expectedHash"]),
  "files.create": object({ parent: path, name: path, isDir: { type: "boolean" } }, [
    "parent",
    "name",
    "isDir",
  ]),
  "files.write": object(
    {
      path,
      expectedHash: { type: "string", minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
      content: { type: "string", maxLength: 1000000 },
    },
    ["path", "expectedHash", "content"],
  ),
  "files.list": object({ path, ...pagination }),
  "files.index": object(pagination),
  "files.search": object(
    { query: { type: "string", minLength: 1, maxLength: 200 }, ...pagination },
    ["query"],
  ),
  "files.searchContent": object(
    {
      query: { type: "string", minLength: 1, maxLength: 1000 },
      caseSensitive: { type: "boolean" },
      wholeWord: { type: "boolean" },
      regex: { type: "boolean" },
      include: { type: "string", maxLength: 1000 },
      exclude: { type: "string", maxLength: 1000 },
      ...pagination,
    },
    ["query"],
  ),
  "files.read": object({ path, ...textPage }, ["path"]),
  "git.index": object(pagination),
  "git.fileDiff": object({ path, staged: { type: "boolean" }, ...textPage }, ["path"]),
  "git.branches": object({}),
  "git.worktrees": object({}),
} as const;
export const FILE_CONVERSATION_READS = Object.keys(CONVERSATION_FILE_TOOLS).filter(
  (action) => !["files.create", "files.write", "files.rename", "files.move", "files.copy", "files.delete"].includes(action),
);
export const isFileConversationTool = (action: string) =>
  Object.hasOwn(CONVERSATION_FILE_TOOLS, action);
export function describeFileConversationTool(action: string) {
  if (!isFileConversationTool(action)) return undefined;
  if (["files.inspect", "files.rename", "files.move", "files.copy", "files.delete"].includes(action))
    return "Inspect or mutate a file/directory in this conversation's verified working copy. Read files.inspect first and pass its exact expectedHash; the shared host editor queue rechecks it before commit and rejects observed changes. Arbitrary external filesystem writes are not an atomic tree transaction. Inspection is bounded to 2000 entries/32 MiB and rejects Git internals, links and special files. rename takes one name; move/copy take an existing destinationParent in the same checkout and refuse collisions. delete removes the inspected tree. No root deletion, arbitrary paths, Git actions or cross-project operations. Mutations reuse the editor filesystem service.";
  if (action === "files.create" || action === "files.write")
    return "Create or save a file in the calling session's verified working copy through the existing editor service. Read before write and pass files.read's hash as expectedHash; concurrent changes reject the save. No cwd/project override, deletion, Git operation or publishing. Creation refuses an existing target. File content is bounded; writes do not execute it.";
  return "Read files, search or inspect Git in the calling session's verified project working copy. Paths are workspace-relative; no cwd/project override or Git writes. Results are bounded with pagination; search truncation is explicit. File/diff text uses character offsets after credential redaction. A read does not authorize edits, commits or publication.";
}
const page = <T>(items: T[], input: Record<string, unknown>) => {
  const offset = Number(input.offset ?? 0),
    limit = Number(input.limit ?? 30);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
};
const text = (value: string, input: Record<string, unknown>) => {
  const clean = scrubRuntimeLogText(value, Number.MAX_SAFE_INTEGER);
  const offset = Number(input.offset ?? 0),
    maxChars = Number(input.maxChars ?? 6000);
  return {
    text: clean.slice(offset, offset + maxChars),
    totalChars: clean.length,
    offset,
    nextOffset: offset + maxChars < clean.length ? offset + maxChars : null,
  };
};

/** root is resolved by the host from the authenticated session, never tool input. */
export async function callFileConversationTool(
  root: string,
  action: string,
  input: Record<string, unknown>,
  execute?: WorkspaceCommands["run"],
) {
  if (action === "files.inspect") return inspectConversationPath(root, input.path);
  if (["files.rename", "files.move", "files.copy", "files.delete"].includes(action)) {
    if (!execute) throw new Error("Editor filesystem mutations unavailable.");
    return mutateConversationPath(root, action, input, execute);
  }
  if (action === "files.create")
    return {
      path: await createHostPath(root, input.parent, input.name, input.isDir),
      created: true,
    };
  if (action === "files.write") {
    const current = await readHostFile(root, input.path);
    if (createHash("sha256").update(current).digest("hex") !== input.expectedHash)
      throw new Error("File changed on the host; reload before saving");
    await writeHostFile(root, input.path, current, input.content);
    return {
      path: input.path,
      saved: true,
      hash: createHash("sha256").update(String(input.content)).digest("hex"),
    };
  }
  if (action === "files.list") return page(await listHostFiles(root, input.path ?? "."), input);
  if (action === "files.index") {
    const items = await indexHostFiles(root);
    return { ...page(items, input), truncated: items.length >= 20000 };
  }
  if (action === "files.search") {
    const items = await searchHostFiles(root, input.query);
    return { ...page(items, input), truncated: items.length >= 200 };
  }
  if (action === "files.read") {
    const content = await readHostFile(root, input.path);
    return {
      path: input.path,
      hash: createHash("sha256").update(content).digest("hex"),
      ...text(content, input),
    };
  }
  if (action === "files.searchContent") {
    const result = await searchHostContent(root, input);
    const matches = [];
    for (const match of result.matches) {
      // Search can encounter symlinks. Prove each match belongs to this workspace
      // before exposing content, just as the editor's file reader does.
      const actual = await existingPath(root, match.relative).catch(() => undefined);
      if (!actual) continue;
      matches.push({
        ...match,
        path: relative(root, actual).replaceAll("\\", "/"),
        preview: scrubRuntimeLogText(match.preview, 1000),
      });
    }
    return { ...page(matches, input), truncated: result.truncated };
  }
  if (action === "git.index") {
    const { files, conflicts, ...state } = await hostGitIndex(root);
    return { ...state, ...page(files, input), conflicts: page(conflicts ?? [], input) };
  }
  if (action === "git.fileDiff") {
    const { original, current, ...state } = await hostFileDiff(
      root,
      input.path,
      input.staged === true,
    );
    return { ...state, original: text(original, input), current: text(current, input) };
  }
  if (action === "git.branches") return hostBranches(root);
  if (action === "git.worktrees") return hostWorktrees(root);
  throw new Error("Unsupported file conversation tool.");
}
