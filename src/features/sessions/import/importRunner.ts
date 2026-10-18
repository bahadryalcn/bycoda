import { forgetHarnessSession } from "../../../integrations/harness/core/registry";
import {
  importPlaceholderDir,
  readClaudeTranscript,
  readCodexTranscript,
  type ClaudeTranscript,
  type CodexTranscript,
  type ImportCandidate,
} from "../../../platform/tauri/sessionImport";
import { pathKey } from "../../../shared/lib/paths";
import { proposeProjectGroups } from "../../projects/model/importGrouping";
import {
  assignProjectsToNamedGroup,
  loadProjectGroupAssignments,
  loadProjectGroups,
} from "../../projects/model/projectGroups";
import {
  isRemoteProjectPath,
  loadRecents,
  looksLikeProject,
  normalizeProjectPath,
  rememberImportedProjects,
  sameProjectPath,
} from "../../projects/model/recents";
import {
  importSessionRecord,
  importedSessionKeys,
  isPersistableId,
  type SessionSummary,
} from "../data/sessionStore";
import { buildImportedSession } from "../model/claudeSessionImport";
import { newSession, titleFromPrompt, type Block, type Session } from "../model/session";
import { buildCodexSession } from "./codexTranscript";
import { candidateKey, importedSessionId, isAlreadyImported } from "./importModel";

/**
 * Per conversation, how much of a transcript crosses into the webview. Rust
 * keeps the newest part when a conversation is larger, and the replayed blocks
 * are capped again below, because a saved session is read back whole and
 * written under the store lock whenever it changes.
 */
export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
export const MAX_BLOCKS_BYTES = 6 * 1024 * 1024;

export const MISSING_FOLDERS_GROUP = "Missing folders";

export type ImportFailure = { candidate: ImportCandidate; error: string };

export type ImportProgress = {
  total: number;
  done: number;
  imported: number;
  /** Already in Bycoda. */
  skipped: number;
  failed: ImportFailure[];
  current: string | null;
};

export type ImportSummary = {
  imported: number;
  skipped: number;
  failed: ImportFailure[];
  cancelled: boolean;
  /** Imported with a note that they cannot be continued. */
  readOnly: number;
  /** Imported without the oldest part of the conversation. */
  truncated: number;
  projects: number;
  groups: string[];
};

export type ImportDeps = {
  readClaude: (path: string, maxBytes: number) => Promise<ClaudeTranscript>;
  readCodex: (path: string, maxBytes: number) => Promise<CodexTranscript>;
  placeholderDir: (original: string) => Promise<string>;
  persist: (
    session: Session,
    times: { createdAt: number; updatedAt: number },
  ) => Promise<SessionSummary | null>;
  storedKeys: () => Promise<string[]>;
  /** Replay records a resume binding for the id it ran under; drop it. */
  forgetReplay: (sessionId: string) => void;
  /** Give the webview a turn between conversations. */
  yieldToUi: () => Promise<void>;
};

const defaultDeps: ImportDeps = {
  readClaude: readClaudeTranscript,
  readCodex: readCodexTranscript,
  placeholderDir: importPlaceholderDir,
  persist: importSessionRecord,
  storedKeys: importedSessionKeys,
  forgetReplay: (sessionId) => {
    void forgetHarnessSession("claude", sessionId).catch(() => undefined);
  },
  yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

type FolderTarget = {
  /** Project path the sessions are filed under. */
  cwd: string;
  /** The folder the conversation ran in is the project (not a placeholder). */
  real: boolean;
  original: string;
};

function displayPath(path: string): string {
  return normalizeProjectPath(path).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
}

/**
 * Whether sessions can be filed straight under the folder they ran in: it must
 * exist and be a folder Bycoda treats as a project (the home directory, for
 * one, is not).
 */
export function isUsableProjectFolder(candidate: ImportCandidate): boolean {
  const path = displayPath(candidate.cwd);
  return candidate.cwdExists && looksLikeProject(path) && !isRemoteProjectPath(path);
}

async function resolveTarget(candidate: ImportCandidate, deps: ImportDeps): Promise<FolderTarget> {
  const original = displayPath(candidate.cwd);
  if (isUsableProjectFolder(candidate)) {
    // A project the user already has keeps its spelling, so its sessions stay
    // together with the ones imported now.
    const known = loadRecents().find((item) => sameProjectPath(item.path, original));
    return { cwd: known?.path ?? original, real: true, original };
  }
  return {
    cwd: normalizeProjectPath(await deps.placeholderDir(original)),
    real: false,
    original,
  };
}

/** Drop the oldest blocks until the transcript fits what the store should hold. */
export function fitBlocks(
  blocks: Block[],
  maxBytes = MAX_BLOCKS_BYTES,
): { blocks: Block[]; trimmed: boolean } {
  let kept = blocks;
  let trimmed = false;
  while (kept.length > 1 && JSON.stringify(kept).length > maxBytes) {
    kept = kept.slice(Math.max(1, Math.ceil(kept.length * 0.1)));
    trimmed = true;
  }
  return { blocks: kept, trimmed };
}

export function importNote(
  candidate: ImportCandidate,
  target: FolderTarget,
  options: { resumable: boolean; truncated: boolean },
): string {
  const source = candidate.provider === "claude" ? "Claude Code" : "Codex";
  const parts = [`Imported from ${source}.`];
  if (!target.real) {
    parts.push(
      `The original folder (${target.original}) ${
        candidate.cwdExists ? "is not a project folder" : "no longer exists"
      }, so this is read-only history; sending a message starts a new conversation.`,
    );
  } else if (!options.resumable) {
    parts.push(
      "Its transcript could not be matched to this folder, so this is read-only history; sending a message starts a new conversation.",
    );
  } else {
    parts.push(
      `Sending a message continues the same ${source === "Codex" ? "Codex thread" : "conversation"}.`,
    );
  }
  if (candidate.provider === "codex") {
    parts.push("Tool calls are shown as simple rows and reasoning is not included.");
  }
  if (options.truncated) {
    parts.push("Only the most recent part was imported because of its size.");
  }
  return parts.join(" ");
}

type Built = { session: Session; truncated: boolean; readOnly: boolean };

async function buildSession(
  candidate: ImportCandidate,
  target: FolderTarget,
  deps: ImportDeps,
): Promise<Built> {
  const harness = candidate.provider;
  const base: Session = {
    ...newSession(harness, target.cwd, candidate.model ?? undefined, "supervised"),
    id: crypto.randomUUID(),
    title: titleFromPrompt(candidate.firstPrompt, harness),
  };

  let built: Session;
  let truncated: boolean;
  if (harness === "claude") {
    const transcript = await deps.readClaude(candidate.path, MAX_TRANSCRIPT_BYTES);
    built = buildImportedSession({
      base,
      transcript: transcript.text,
      providerSessionId: candidate.providerSessionId,
    });
    deps.forgetReplay(base.id);
    truncated = transcript.truncated || transcript.oversizeSkipped > 0;
  } else {
    const transcript = await deps.readCodex(candidate.path, MAX_TRANSCRIPT_BYTES);
    built = buildCodexSession({ base, entries: transcript.entries });
    truncated = transcript.truncated || transcript.oversizeSkipped > 0;
  }
  if (!built.blocks.some((block) => block.role === "user")) {
    if (
      !truncated ||
      !built.blocks.some((block) => block.role === "assistant" || block.role === "tool")
    ) {
      throw new Error("The conversation has no messages to import");
    }
  }

  const fitted = fitBlocks(built.blocks);
  truncated ||= fitted.trimmed;
  if (truncated && !fitted.blocks.some((block) => block.role === "user")) {
    fitted.blocks = [
      {
        id: crypto.randomUUID(),
        role: "system",
        text: "The retained history starts inside a turn; its user prompt is outside the imported portion.",
      },
      ...fitted.blocks,
    ];
  }
  const resumable = target.real && candidate.resumable;
  const note: Block = {
    id: crypto.randomUUID(),
    role: "system",
    text: importNote(candidate, target, { resumable, truncated }),
  };
  const session: Session = {
    ...built,
    id: importedSessionId(candidate),
    cwd: target.cwd,
    blocks: [note, ...fitted.blocks],
  };
  // Binding is what makes the next message continue the conversation; a
  // read-only import must not carry one.
  if (resumable) session.providerSessionId = candidate.providerSessionId;
  else delete session.providerSessionId;
  return { session, truncated, readOnly: !resumable };
}

function importTimes(candidate: ImportCandidate): {
  createdAt: number;
  updatedAt: number;
} {
  const now = Date.now();
  const updatedAt = candidate.lastAt > 0 ? candidate.lastAt : now;
  const createdAt = candidate.startedAt > 0 ? Math.min(candidate.startedAt, updatedAt) : updatedAt;
  return { createdAt, updatedAt };
}

/** The groups the import would put its folders in, for the dialog and the run alike. */
export function planProjectGroups(
  realPaths: readonly string[],
  placeholderPaths: readonly string[] = [],
): { name: string; paths: string[] }[] {
  const grouped = new Set(Object.keys(loadProjectGroupAssignments()));
  const groups: { name: string; paths: string[] }[] = proposeProjectGroups({
    paths: realPaths,
    grouped,
    existingGroupNames: loadProjectGroups().map((group) => group.name),
  }).map(({ name, paths }) => ({ name, paths }));
  const orphans = placeholderPaths.filter((path) => !grouped.has(pathKey(path)));
  const hasGroup = loadProjectGroups().some(
    (group) => group.name.toLocaleLowerCase() === MISSING_FOLDERS_GROUP.toLocaleLowerCase(),
  );
  if (orphans.length >= 2 || (orphans.length > 0 && hasGroup)) {
    groups.push({ name: MISSING_FOLDERS_GROUP, paths: orphans });
  }
  return groups;
}

/** Folder groups for the selected conversations, as the dialog previews them. */
export function previewProjectGroups(
  candidates: readonly ImportCandidate[],
): { name: string; count: number }[] {
  const real = new Map<string, string>();
  const missing = new Set<string>();
  for (const candidate of candidates) {
    if (isUsableProjectFolder(candidate)) {
      real.set(pathKey(candidate.cwd), displayPath(candidate.cwd));
    } else {
      missing.add(pathKey(candidate.cwd));
    }
  }
  const groups = planProjectGroups([...real.values()]).map(({ name, paths }) => ({
    name,
    count: paths.length,
  }));
  if (missing.size > 0) {
    groups.push({ name: MISSING_FOLDERS_GROUP, count: missing.size });
  }
  return groups;
}

export async function runSessionImport(input: {
  candidates: readonly ImportCandidate[];
  groupProjects: boolean;
  signal: AbortSignal;
  onProgress: (progress: ImportProgress) => void;
  deps?: Partial<ImportDeps>;
}): Promise<ImportSummary> {
  const deps: ImportDeps = { ...defaultDeps, ...input.deps };
  const stored = new Set(await deps.storedKeys());
  const targets = new Map<string, Promise<FolderTarget>>();
  const folders = new Map<string, { target: FolderTarget; lastUsedAt: number }>();

  const progress: ImportProgress = {
    total: input.candidates.length,
    done: 0,
    imported: 0,
    skipped: 0,
    failed: [],
    current: null,
  };
  const summary: ImportSummary = {
    imported: 0,
    skipped: 0,
    failed: progress.failed,
    cancelled: false,
    readOnly: 0,
    truncated: 0,
    projects: 0,
    groups: [],
  };

  for (const candidate of input.candidates) {
    if (input.signal.aborted) {
      summary.cancelled = true;
      break;
    }
    progress.current = candidate.firstPrompt;
    input.onProgress({ ...progress, failed: [...progress.failed] });
    // Progress is what the dialog repaints on, so cancel can land right here.
    if (input.signal.aborted) {
      summary.cancelled = true;
      break;
    }
    try {
      if (!isPersistableId(importedSessionId(candidate))) {
        throw new Error("Unsupported conversation id");
      }
      if (isAlreadyImported(candidate, stored)) {
        progress.skipped += 1;
      } else {
        const key = pathKey(candidate.cwd);
        let pending = targets.get(key);
        if (!pending) {
          pending = resolveTarget(candidate, deps);
          targets.set(key, pending);
        }
        const target = await pending;
        const built = await buildSession(candidate, target, deps);
        const summaryRow = await deps.persist(built.session, importTimes(candidate));
        if (summaryRow) {
          stored.add(candidateKey(candidate));
          progress.imported += 1;
          if (built.readOnly) summary.readOnly += 1;
          if (built.truncated) summary.truncated += 1;
          const folder = folders.get(key);
          const lastUsedAt = importTimes(candidate).updatedAt;
          folders.set(key, {
            target,
            lastUsedAt: Math.max(folder?.lastUsedAt ?? 0, lastUsedAt),
          });
        } else {
          progress.skipped += 1;
        }
      }
    } catch (error) {
      progress.failed.push({
        candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    progress.done += 1;
    await deps.yieldToUi();
  }
  progress.current = null;
  input.onProgress({ ...progress, failed: [...progress.failed] });

  // Cancelling still registers what was imported, so none of it is stranded
  // in a folder the rail does not list.
  if (folders.size > 0) {
    const entries = [...folders.values()].map(({ target, lastUsedAt }) => ({
      path: target.cwd,
      lastUsedAt,
    }));
    rememberImportedProjects(entries);
    summary.projects = entries.length;
    if (input.groupProjects) {
      const real = [...folders.values()]
        .filter(({ target }) => target.real)
        .map(({ target }) => target.cwd);
      const placeholders = [...folders.values()]
        .filter(({ target }) => !target.real)
        .map(({ target }) => target.cwd);
      for (const group of planProjectGroups(real, placeholders)) {
        if (assignProjectsToNamedGroup(group.name, group.paths)) {
          summary.groups.push(group.name);
        }
      }
    }
  }

  summary.imported = progress.imported;
  summary.skipped = progress.skipped;
  return summary;
}
