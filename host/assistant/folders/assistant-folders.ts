import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  ASSISTANT_FOLDERS_MAX,
  type AssistantFoldersResponse,
} from "../../../src/shared/model/assistantFolders";
import type { AssistantRepository } from "../repository";

const RECORD = "assistant-folders";
type Stored = {
  id: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  value: { paths?: unknown; runWithoutAsking?: unknown };
};
type Deps = {
  repository: Pick<AssistantRepository, "get" | "put">;
  now: () => number;
};
export type FolderRuleContext = {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
};

const POSIX_SYSTEM = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/System",
  "/Library",
  "/Applications",
  "/private/etc",
];
/** Credential stores inside the home folder; picking one is almost surely a mistake. */
const HOME_SECRET_DIRS = [".ssh", ".gnupg", ".aws", ".kube", ".docker"];

const flavor = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);
const fold = (platform: NodeJS.Platform, value: string) =>
  platform === "win32" || platform === "darwin" ? value.toLowerCase() : value;
const inside = (p: typeof path.posix, platform: NodeJS.Platform, parent: string, child: string) => {
  const rel = p.relative(fold(platform, parent), fold(platform, child));
  return rel === "" || (!rel.startsWith("..") && !p.isAbsolute(rel));
};
const defaults = (): FolderRuleContext => ({
  platform: process.platform,
  home: homedir(),
  env: process.env,
});

/** Which protected folder kind holds a canonical path, or undefined. Applies to a chosen folder and to every path
 * the tools touch inside one, so a whole drive can be chosen without exposing system or
 * credential folders. */
export function assistantPathRefusal(canonical: string, context = defaults()) {
  const { platform, home, env } = context;
  const p = flavor(platform);
  const system =
    platform === "win32"
      ? [
          env.SystemRoot ?? env.windir ?? "C:\\Windows",
          env.ProgramFiles ?? "C:\\Program Files",
          env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
          env.ProgramData ?? "C:\\ProgramData",
        ]
      : POSIX_SYSTEM;
  if (
    system.some((dir) => inside(p, platform, dir, canonical)) ||
    (platform !== "win32" && fold(platform, canonical) === "/var")
  )
    return "system" as const;
  if (home && HOME_SECRET_DIRS.some((name) => inside(p, platform, p.join(home, name), canonical)))
    return "credential" as const;
  return undefined;
}

/** Pure rule check on an already canonical absolute path. Throws the owner-facing reason.
 * A drive or the home folder may be chosen; system and credential folders inside stay refused. */
export function assertAssistantFolderAllowed(canonical: string, context = defaults()) {
  const { platform } = context;
  const p = flavor(platform);
  if (!p.isAbsolute(canonical) || canonical.includes("\0"))
    throw new Error("Choose an absolute local folder.");
  if (platform === "win32" && canonical.startsWith("\\\\") && !/^\\\\\?\\[a-z]:\\/i.test(canonical))
    throw new Error("Network and device paths cannot be Assistant folders.");
  const refusal = assistantPathRefusal(canonical, context);
  if (refusal) throw new Error(`A ${refusal} folder cannot be an Assistant folder.`);
}

/** Refuses a path inside an Assistant folder that falls in a system or credential folder.
 * Links are resolved first; a path that does not exist yet is judged by its own location. */
export async function assertAssistantPathAllowed(path: string, context = defaults()) {
  const real = await realpath(path).catch(() => path);
  const home = await realpath(context.home).catch(() => context.home);
  const refusal = assistantPathRefusal(real, { ...context, home });
  if (refusal) throw new Error(`The assistant cannot use paths inside a ${refusal} folder.`);
}

/** Resolves links (so the stored path is the physical one), then applies the rules. */
export async function canonicalAssistantFolder(input: string, context = defaults()) {
  if (typeof input !== "string" || !input.trim() || input.length > 4096 || input.includes("\0"))
    throw new Error("Choose an absolute local folder.");
  if (!flavor(context.platform).isAbsolute(input.trim()))
    throw new Error("Choose an absolute local folder.");
  const real = await realpath(input.trim()).catch(() => {
    throw new Error("The folder does not exist or cannot be read.");
  });
  if (!(await stat(real)).isDirectory()) throw new Error("Choose a folder, not a file.");
  // The home folder may itself sit behind a link; compare physical forms.
  const home = await realpath(context.home).catch(() => context.home);
  assertAssistantFolderAllowed(real, { ...context, home });
  return real;
}

export const assistantFolderId = (canonical: string, platform = process.platform) =>
  `f${createHash("sha256").update(fold(platform, canonical)).digest("hex").slice(0, 16)}`;

const stored = (deps: Deps) => deps.repository.get<Stored>("runtime", RECORD);

export async function getAssistantFolders(deps: Deps): Promise<AssistantFoldersResponse> {
  const row = await stored(deps);
  const paths = Array.isArray(row?.value.paths)
    ? row.value.paths.filter((value): value is string => typeof value === "string")
    : [];
  return {
    folders: paths
      .slice(0, ASSISTANT_FOLDERS_MAX)
      .map((value) => ({ id: assistantFolderId(value), path: value })),
    runWithoutAsking: row?.value.runWithoutAsking === true,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt ?? 0,
  };
}

export async function setAssistantFolders(
  deps: Deps,
  expectedVersion: number,
  paths: string[],
  runWithoutAsking: boolean,
  context = defaults(),
): Promise<AssistantFoldersResponse> {
  if (paths.length > ASSISTANT_FOLDERS_MAX)
    throw new Error(`At most ${ASSISTANT_FOLDERS_MAX} Assistant folders are allowed.`);
  const canonical = new Map<string, string>();
  for (const input of paths) {
    const real = await canonicalAssistantFolder(input, context);
    canonical.set(assistantFolderId(real), real);
  }
  const old = await stored(deps);
  if ((old?.version ?? 0) !== expectedVersion)
    throw new Error("Assistant folders changed; reload before saving.");
  const now = deps.now();
  await deps.repository.put(
    "runtime",
    {
      id: RECORD,
      version: old?.version ?? 0,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      value: { paths: [...canonical.values()], runWithoutAsking },
    },
    expectedVersion,
  );
  return getAssistantFolders(deps);
}

/** Single entry for the Assistant service's `folders.*` operations. Only the owner may write. */
export async function assistantFoldersOp(
  input:
    | { op: "folders.get" }
    | { op: "folders.set"; expectedVersion: number; paths: string[]; runWithoutAsking: boolean },
  principal: string,
  deps: Deps,
): Promise<{ assistantFolders: AssistantFoldersResponse }> {
  if (input.op === "folders.get") return { assistantFolders: await getAssistantFolders(deps) };
  if (principal !== "owner") throw new Error("This action requires the owner's direct authority.");
  return {
    assistantFolders: await setAssistantFolders(
      deps,
      input.expectedVersion,
      input.paths,
      input.runWithoutAsking,
    ),
  };
}

/** Re-validates a saved folder at use: it must still exist, still be the same physical path
 * (a replaced link or moved folder is refused) and still pass the rules. */
export async function resolveAssistantFolder(
  state: Pick<AssistantFoldersResponse, "folders">,
  id: unknown,
  context = defaults(),
): Promise<string> {
  const entry =
    typeof id === "string" ? state.folders.find((folder) => folder.id === id) : undefined;
  if (!entry) throw new Error("Unknown Assistant folder. Read files.roots for the folder ids.");
  const real = await canonicalAssistantFolder(entry.path, context);
  if (fold(context.platform, real) !== fold(context.platform, entry.path))
    throw new Error(
      "The Assistant folder was moved or replaced by a link; ask the owner to add it again.",
    );
  return entry.path;
}
