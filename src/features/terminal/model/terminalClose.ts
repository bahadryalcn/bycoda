import type { FilePaneTab } from "../../workspace/model/layout";
import { getPtyStatus } from "../../../platform/tauri/pty";
import { t } from "../../../shared/i18n";
import { confirmInApp, type AppConfirmRequest } from "../../../shared/model/appConfirm";
import { terminalTabLabel } from "./terminalTab";

/** Asks the owner; window close passes the native dialog so it cannot hang behind page state. */
type Confirm = (request: AppConfirmRequest) => Promise<boolean>;

type RunningTerminal = {
  file: FilePaneTab;
  process: string | null;
};

/** Longest list of terminals spelled out in the dialog; the rest are counted. */
const LISTED_TERMINALS = 6;

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

/**
 * Confirm closing one terminal when its foreground process is not the shell, or
 * when it is the dock's last terminal, since closing that also closes the panel.
 */
export async function confirmCloseTerminal(
  file: FilePaneTab,
  options: { last?: boolean } = {},
  confirm: Confirm = confirmInApp,
): Promise<boolean> {
  const running = await runningTerminals([file]);
  if (running.length > 0) return confirmSingle(running[0], confirm);
  if (!options.last) return true;
  return confirm({
    title: t("Close terminal?"),
    message: t(
      "{p0} is the last terminal. Closing it also closes the terminal panel. To keep it, hide the panel instead.",
      { p0: terminalTabLabel(file) },
    ),
    confirmLabel: t("Close terminal"),
    // Nothing is running; only the idle shell and its scrollback go away.
    tone: "normal",
  });
}

/** Confirm closing terminals that still have a foreground process. */
export async function confirmCloseTerminals(
  files: FilePaneTab[],
  confirm: Confirm = confirmInApp,
): Promise<boolean> {
  const running = await runningTerminals(files);
  if (running.length === 0) return true;
  if (running.length === 1) return confirmSingle(running[0], confirm);
  const unknown = running.some(({ process }) => !process);
  const lines = running
    .slice(0, LISTED_TERMINALS)
    .map(
      ({ file, process }) =>
        `• ${terminalTabLabel(file)} (${process ?? t("process status unknown")})`,
    );
  if (running.length > LISTED_TERMINALS) {
    lines.push(t("and {p0} more", { p0: running.length - LISTED_TERMINALS }));
  }
  return confirm({
    title: t("Close {p0} terminals?", { p0: running.length }),
    message: [
      unknown
        ? t("These terminals may still have running processes:")
        : t("These terminals are still running:"),
      ...lines,
      "",
      t("Closing them stops the work running in them."),
    ].join("\n"),
    confirmLabel: t("Close {p0} terminals", { p0: running.length }),
    tone: "danger",
  });
}

function confirmSingle(
  { file, process }: RunningTerminal,
  confirm: Confirm = confirmInApp,
): Promise<boolean> {
  const label = terminalTabLabel(file);
  return confirm({
    title: t("Close terminal?"),
    message: process
      ? t("“{p0}” is still running in {p1}. Closing the terminal stops it.", {
          p0: process,
          p1: label,
        })
      : t(
          "Can’t tell whether a process is still running in {p0}. Closing the terminal may stop running work.",
          { p0: label },
        ),
    confirmLabel: t("Close terminal"),
    tone: "danger",
  });
}
