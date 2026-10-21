import { Button } from "../../../shared/ui/Button";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { ModalPanel } from "../../../shared/ui/Modal";
import { claudeSessions, type ClaudeSessionSummary } from "../../../platform/tauri/fs";

type Props = {
  cwd: string;
  /** Whose conversations: an added account keeps its own transcripts. */
  providerAccountId?: string;
  onPick: (summary: ClaudeSessionSummary) => void;
  onClose: () => void;
};

/** Conversations Claude Code already recorded for this project, newest first. */
export function ClaudeSessionPicker({ cwd, providerAccountId, onPick, onClose }: Props) {
  useLocale();
  const [sessions, setSessions] = useState<ClaudeSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setError(null);
    claudeSessions(cwd, providerAccountId)
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, providerAccountId, retry]);

  return (
    <ModalPanel
      onClose={onClose}
      title={t("Resume a Claude Code conversation")}
      description={t("Picked up from where Claude Code left off in this project.")}
      fitViewport
    >
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 px-1 py-3 text-sm text-danger"
        >
          <span>{error}</span>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            {t("Retry")}
          </Button>
        </div>
      ) : sessions === null ? (
        <p className="px-1 py-6 text-center text-sm opacity-60">{t("Reading…")}</p>
      ) : sessions.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm opacity-60">
          {t("Claude Code has not recorded a conversation in this project yet.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sessions.map((session) => (
            <li key={session.id}>
              <Button
                fullWidth
                layout="stacked"
                variant="item"
                type="button"
                className="w-full flex-col text-left"
                onClick={() => onPick(session)}
              >
                <span className="line-clamp-2 text-sm">{session.title}</span>
                <span className="text-xs opacity-60">
                  {formatWhen(session.updatedAt)} ·{" "}
                  {session.messageCount === 1
                    ? t("1 message")
                    : t("{p0} messages", { p0: session.messageCount })}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ModalPanel>
  );
}

function formatWhen(at: number): string {
  if (!at) return "unknown date";
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(getLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
