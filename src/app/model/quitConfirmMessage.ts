import { t } from "../../shared/i18n";
import { quitWhileBusyMessage } from "../../features/sessions/model/inFlight";

/** What the desktop's `quit_confirm` event reports about the app-owned local Host. */
export type QuitHostActivity = {
  sessions: number;
  shells: number;
  automations: number;
  unknown?: boolean;
  runningSessions?: { id: string; title?: string | null }[];
};

export type QuitConfirmPayload = {
  id: number;
  /** Desktop work plus the Host's; the only count an older desktop sends. */
  inFlight: number;
  desktopInFlight?: number;
  hostActivity?: QuitHostActivity;
};

const LISTED_SESSIONS = 5;

function hostWork(host: QuitHostActivity | undefined): number {
  return host ? host.sessions + host.shells + host.automations : 0;
}

/**
 * The quit confirmation text. Without Host work it is the legacy chat message. With it, the
 * running Host sessions are listed and the owner is told they are stopped gracefully.
 */
export function quitConfirmMessage(payload: QuitConfirmPayload): string {
  const host = payload.hostActivity;
  if (!host || (hostWork(host) === 0 && !host.unknown)) {
    return quitWhileBusyMessage(payload.desktopInFlight ?? payload.inFlight);
  }
  const lines: string[] = [];
  const desktop = payload.desktopInFlight ?? 0;
  if (desktop > 0) {
    lines.push(
      desktop === 1
        ? t("1 chat is still running. It will resume when you reopen bycoda.")
        : t("{p0} chats are still running. They will resume when you reopen bycoda.", {
            p0: desktop,
          }),
    );
  }
  if (host.sessions > 0) {
    lines.push(
      host.sessions === 1
        ? t("1 session on this computer is still running.")
        : t("{p0} sessions on this computer are still running.", { p0: host.sessions }),
    );
    const listed = (host.runningSessions ?? []).slice(0, LISTED_SESSIONS);
    for (const session of listed) lines.push(`• ${session.title?.trim() || t("Untitled session")}`);
    if (host.sessions > listed.length && listed.length > 0)
      lines.push(t("and {p0} more", { p0: host.sessions - listed.length }));
  }
  const other = host.shells + host.automations;
  if (other > 0) {
    lines.push(
      other === 1
        ? t("1 other task on this computer is running.")
        : t("{p0} other tasks on this computer are running.", { p0: other }),
    );
  }
  if (host.unknown && hostWork(host) === 0)
    lines.push(t("Could not check what is running on this computer."));
  lines.push(t("Quitting stops them gracefully and keeps their history. Quit anyway?"));
  return lines.join("\n");
}
