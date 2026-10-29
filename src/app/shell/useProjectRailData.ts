import { useState, useSyncExternalStore } from "react";
import {
  loadPinnedProjects,
  loadProjectRailOrder,
  saveProjectRailOrder,
  subscribeProjectPathsChanged,
} from "../../features/projects/model/recents";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
} from "../../features/projects/model/projectGroups";
import { remoteOnlyProjects } from "../../features/sync/model/syncProjects";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
} from "../../features/workspace/model/tabGroups";

/**
 * What the project rail reads from storage and the sync layer. It is not state
 * of the rail: other windows, menus and the sync layer write it too, so the
 * rail subscribes instead of mirroring each value into its own state.
 */
function readProjectRailData() {
  const projectGroups = loadProjectGroups();
  return {
    remoteOnly: remoteOnlyProjects(),
    railOrder: loadProjectRailOrder(),
    pinnedPaths: loadPinnedProjects(),
    groupLabels: loadTabGroupLabels(),
    groupColors: loadTabGroupColors(),
    groupMascots: loadTabGroupMascots(),
    groupCustomColors: loadTabGroupCustomColors(),
    projectGroups,
    projectGroupAssignments: loadProjectGroupAssignments(projectGroups),
  };
}

export type ProjectRailData = ReturnType<typeof readProjectRailData>;

let snapshot: ProjectRailData | null = null;
let stale = true;
const listeners = new Set<() => void>();

/** A re-read keeps the identity of every value that did not change. */
function reuseUnchanged(previous: ProjectRailData | null, next: ProjectRailData): ProjectRailData {
  if (!previous) return next;
  const merged: Record<string, unknown> = { ...next };
  let changed = false;
  for (const key of Object.keys(next) as Array<keyof ProjectRailData>) {
    if (JSON.stringify(previous[key]) === JSON.stringify(next[key])) merged[key] = previous[key];
    else changed = true;
  }
  return changed ? (merged as ProjectRailData) : previous;
}

function getSnapshot(): ProjectRailData {
  if (stale || snapshot === null) {
    snapshot = reuseUnchanged(snapshot, readProjectRailData());
    stale = false;
  }
  return snapshot;
}

function invalidate() {
  stale = true;
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  subscribeProjectPathsChanged(invalidate);
  // Another window moved a group or a project: its writes arrive as storage events.
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("bycoda.project")) invalidate();
  });
}

/** Saves a new rail order and shows it. Saving the order does not announce itself. */
export function commitProjectRailOrder(order: string[]) {
  saveProjectRailOrder(order);
  invalidate();
}

export function useProjectRailData(): ProjectRailData {
  // A fresh mount reads storage again: not every writer announces itself.
  useState(() => {
    stale = true;
  });
  return useSyncExternalStore(subscribe, getSnapshot);
}
