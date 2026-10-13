import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

const DISK_TTL_MS = 30_000;
const disk = new Map<string, { at: number; commands: DiskCommand[] }>();
const pendingDisk = new Map<string, Promise<ClaudeCommandEntry[]>>();

function discoverCommands(cwd: string): Promise<ClaudeCommandEntry[]> {
  const pending = pendingDisk.get(cwd);
  if (pending) return pending;
  const request = listClaudeCommands(cwd)
    .then((commands) => {
      disk.set(cwd, { at: Date.now(), commands });
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
  const reported = useSyncExternalStore(
    (listener) => subscribeReportedCommands(sessionId, listener),
    () => getReportedCommands(sessionId),
  );
  const [found, setFound] = useState<{ cwd: string; commands: DiskCommand[] }>(() => ({
    cwd: localCwd,
    commands: disk.get(localCwd)?.commands ?? [],
  }));

  useEffect(() => {
    if (harness !== "claude" || !localCwd) {
      setFound({ cwd: localCwd, commands: [] });
      return;
    }
    const cached = disk.get(localCwd);
    setFound({ cwd: localCwd, commands: cached?.commands ?? [] });
    if (cached && Date.now() - cached.at < DISK_TTL_MS) return;
    // Opening the composer loads once; opening the menu refreshes a stale list.
    if (!menuOpen && cached) return;
    let live = true;
    discoverCommands(localCwd)
      .then((entries: ClaudeCommandEntry[]) => {
        if (live) setFound({ cwd: localCwd, commands: entries });
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
        disk: found.cwd === localCwd ? found.commands : [],
        taken,
      }),
    [harness, reported, found, taken, localCwd],
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
