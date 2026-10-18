import { ask } from "@tauri-apps/plugin-dialog";
import type { FilePaneTab } from "../../workspace/model/layout";
import { getPtyStatus } from "../../../platform/tauri/pty";
import { terminalTabLabel } from "./terminalTab";
import { appName } from "../../../shared/lib/appName";

type RunningTerminal = {
  file: FilePaneTab;
  process: string | null;
};

async function runningTerminals(files: FilePaneTab[]): Promise<RunningTerminal[]> {
  const running: RunningTerminal[] = [];
  for (const file of files) {
    if (!file.terminal) continue;
    try {
      const { foreground, supported } = await getPtyStatus(file.id);
      const process = foreground?.trim();
      if (process) running.push({ file, process });
      else if (supported === false) running.push({ file, process: null });
    } catch {
      // A failed query cannot establish that killing the PTY is safe.
      running.push({ file, process: null });
    }
  }
  return running;
}

/** Confirm closing one terminal when its foreground process is not the shell. */
export async function confirmCloseTerminal(file: FilePaneTab): Promise<boolean> {
  const running = await runningTerminals([file]);
  if (running.length === 0) return true;
  const { process } = running[0];
  const label = terminalTabLabel(file);
  return ask(closeQuestion(label, process), {
    title: appName(),
    kind: "warning",
  });
}

/** Confirm closing terminals that still have a foreground process. */
export async function confirmCloseTerminals(files: FilePaneTab[]): Promise<boolean> {
  const running = await runningTerminals(files);
  if (running.length === 0) return true;
  if (running.length === 1) {
    const { file, process } = running[0];
    return ask(closeQuestion(terminalTabLabel(file), process), {
      title: appName(),
      kind: "warning",
    });
  }
  const lines = running
    .map(
      ({ file, process }) => `• ${terminalTabLabel(file)} (${process ?? "process status unknown"})`,
    )
    .join("\n");
  const heading = running.some(({ process }) => !process)
    ? "These terminals may still have running processes:"
    : "These terminals are still running:";
  return ask(`${heading}\n${lines}\n\nClose them anyway?`, {
    title: appName(),
    kind: "warning",
  });
}

function closeQuestion(label: string, process: string | null): string {
  return process
    ? `"${process}" is still running in ${label}. Close this terminal anyway?`
    : `Cannot determine whether a process is still running in ${label}. Closing may stop running work. Close this terminal anyway?`;
}
