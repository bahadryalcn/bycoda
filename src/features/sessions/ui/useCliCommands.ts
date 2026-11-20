import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getReportedCommands,
  subscribeReportedCommands,
} from "../../../integrations/harness/core/reportedCommands";
import { listClaudeCommands, type ClaudeCommandEntry } from "../../../platform/tauri/fs";
import {
  mergeCliCommands,
  mergeDollarSkills,
  registerCliCommands,
  type DiskCommand,
} from "../../skills/model/cliCommands";
import { loadDisabledSkillPaths, type Skill } from "../../skills/model/skills";
import type { HarnessId } from "../model/session";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { boundedGet, boundedSet } from "../../../shared/lib/store";

const DISK_TTL_MS = 30_000;
/** Folders kept in memory; the least recently used one is dropped first. */
const DISK_CACHE_LIMIT = 32;
const disk = new Map<string, { at: number; commands: DiskCommand[] }>();
const NO_DISK_COMMANDS: DiskCommand[] = [];
const pendingDisk = new Map<string, Promise<ClaudeCommandEntry[]>>();

/** The last command read for this folder, or `null`. Stale entries are still returned; the caller decides. */
export function cachedDiskEntry(cwd: string): { at: number; commands: DiskCommand[] } | null {
  return boundedGet(disk, cwd);
}

export function discoverCommands(cwd: string): Promise<ClaudeCommandEntry[]> {
  const pending = pendingDisk.get(cwd);
  if (pending) return pending;
  const request = listClaudeCommands(cwd)
    .then((commands) => {
      boundedSet(disk, cwd, { at: Date.now(), commands }, DISK_CACHE_LIMIT);
      return commands;
    })
    .finally(() => {
      if (pendingDisk.get(cwd) === request) pendingDisk.delete(cwd);
    });
  pendingDisk.set(cwd, request);
  return request;
}

/**
 * Claude Code's own commands and Codex's `$` skills for the composer menus.
 * Workspace discovery follows the machine that owns the execution directory.
 * The files are read when the composer opens and again when a menu opens after
 * the cache went stale, never on a timer.
 */
export function useCliCommands(input: {
  harness: HarnessId;
  /** Execution directory, including remote:// paths. */
  localCwd: string;
  sessionId?: string;
  menuOpen: boolean;
  /** Names that already mean something else: Bycoda commands, file skills. */
  taken: ReadonlySet<string>;
  files: readonly Skill[];
}): { slashCommands: Skill[]; dollarSkills: Skill[] } {
  const { harness, localCwd, sessionId, menuOpen, taken, files } = input;
  const subscribe = useCallback(
    (listener: () => void) => subscribeReportedCommands(sessionId, listener),
    [sessionId],
  );
  const reported = useSyncExternalStore(subscribe, () => getReportedCommands(sessionId));
  // The module cache is the source of truth; a finished load only asks this hook to re-read it.
  const [, setLoadedRevision] = useState(0);
  const diskCommands =
    harness === "claude" && localCwd
      ? (cachedDiskEntry(localCwd)?.commands ?? NO_DISK_COMMANDS)
      : NO_DISK_COMMANDS;

  useEffect(() => {
    if (harness !== "claude" || !localCwd) return;
    const cached = cachedDiskEntry(localCwd);
    if (cached && Date.now() - cached.at < DISK_TTL_MS) return;
    // Opening the composer loads once; opening the menu refreshes a stale list.
    if (!menuOpen && cached) return;
    let live = true;
    discoverCommands(localCwd)
      .then(() => {
        if (live) setLoadedRevision((revision) => revision + 1);
      })
      .catch((error) => {
        console.warn("useCliCommands operation failed", error);
      });
    return () => {
      live = false;
    };
  }, [harness, localCwd, menuOpen]);

  const slashCommands = useMemo(
    () =>
      mergeCliCommands({
        harness,
        reported,
        disk: diskCommands,
        taken,
      }),
    [harness, reported, diskCommands, taken],
  );
  useEffect(
    () =>
      localCwd.startsWith(REMOTE_PATH_PREFIX)
        ? undefined
        : registerCliCommands(harness, slashCommands),
    [harness, slashCommands, localCwd],
  );
  const dollarSkills = useMemo(
    () =>
      mergeDollarSkills({
        harness,
        reported,
        files,
        disabledPaths: loadDisabledSkillPaths(),
      }),
    [harness, reported, files],
  );
  return { slashCommands, dollarSkills };
}
