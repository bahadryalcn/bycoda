import { invoke } from "@tauri-apps/api/core";

export type ImportProvider = "claude" | "codex";

/** Interactive chats, non-interactive runs, and threads another agent spawned. */
export type ImportKind = "interactive" | "exec" | "subagent";

/** One conversation a provider CLI stored on disk, summarized in Rust. */
export type ImportCandidate = {
  provider: ImportProvider;
  path: string;
  providerSessionId: string;
  /** The folder it ran in, as the transcript recorded it. */
  cwd: string;
  cwdExists: boolean;
  /** Whether the provider can continue it from `cwd`. */
  resumable: boolean;
  firstPrompt: string;
  startedAt: number;
  lastAt: number;
  sizeBytes: number;
  kind: ImportKind;
  model?: string | null;
  archived: boolean;
};

export type DiscoveryReport = {
  candidates: ImportCandidate[];
  filesScanned: number;
  filesSkipped: number;
  elapsedMs: number;
};

export type ClaudeTranscript = {
  text: string;
  truncated: boolean;
  totalRecords: number;
  keptRecords: number;
  oversizeSkipped: number;
};

/** A Codex rollout record reduced to what a read-back transcript needs. */
export type CodexEntry = {
  kind: "user" | "assistant" | "tool";
  at: number;
  text: string;
  callId?: string | null;
  name?: string | null;
  input?: string | null;
  output?: string | null;
  cwd?: string | null;
};

export type CodexTranscript = {
  entries: CodexEntry[];
  truncated: boolean;
  dropped: number;
  oversizeSkipped: number;
};

/** Scans `~/.claude` and `~/.codex` read-only; reads no more than a head and tail of each file. */
export function discoverImportableSessions(): Promise<DiscoveryReport> {
  return invoke<DiscoveryReport>("import_discover");
}

export function readClaudeTranscript(path: string, maxBytes: number): Promise<ClaudeTranscript> {
  return invoke<ClaudeTranscript>("import_read_claude", { path, maxBytes });
}

export function readCodexTranscript(path: string, maxBytes: number): Promise<CodexTranscript> {
  return invoke<CodexTranscript>("import_read_codex", { path, maxBytes });
}

/** A real folder to file conversations under when their own folder is gone. */
export function importPlaceholderDir(original: string): Promise<string> {
  return invoke<string>("import_placeholder_dir", { original });
}
