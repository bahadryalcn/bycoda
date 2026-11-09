/** How long after the first report a project or tab change is still logged. */
const BOOT_DIAGNOSTIC_WINDOW_MS = 10_000;

export interface BootProjectState {
  activeTabId: string;
  projectCwd: string;
  sidebarCwd: string;
}

let firstReportAt: number | null = null;
let lastKey = "";

/**
 * Logs the active tab and project at boot, then every change of either during
 * the first seconds. When a window opens on an unexpected project, this is the
 * trail that shows which of the saved tab, the saved project or a later move did it.
 */
export function reportBootProjectState(state: BootProjectState, now = Date.now()): void {
  const key = `${state.activeTabId}|${state.projectCwd}|${state.sidebarCwd}`;
  if (key === lastKey) return;
  lastKey = key;
  if (firstReportAt === null) {
    firstReportAt = now;
    console.info("[boot] first workspace state", state);
    return;
  }
  if (now - firstReportAt <= BOOT_DIAGNOSTIC_WINDOW_MS) {
    console.info(`[boot] project or tab changed after ${now - firstReportAt} ms`, state);
  }
}

/** Test seam: forget what was reported. */
export function resetBootProjectDiagnostics(): void {
  firstReportAt = null;
  lastKey = "";
}
