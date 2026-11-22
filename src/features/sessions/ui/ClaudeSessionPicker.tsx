import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { ClampText } from "../../../shared/ui/ClampText";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { formatDate, useT } from "../../../shared/i18n";
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
  const t = useT();
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
        if (!cancelled) setError(errorText(reason));
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
        <InlineError
          inset="row"
          retry={{ onRetry: () => setRetry((value) => value + 1) }}
        >
          {error}
        </InlineError>
      ) : sessions === null ? (
        <LoadingText inset="panel">{t("Reading…")}</LoadingText>
      ) : sessions.length === 0 ? (
        <EmptyState
          size="inline"
          description={t("Claude Code has not recorded a conversation in this project yet.")}
        />
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
                <ClampText as="span" lines={2} expandable={false} size="body">
                  {session.title}
                </ClampText>
                <Text size="caption" tone="inherit" className="opacity-60">
                  {formatWhen(session.updatedAt, t("Unknown date"))} ·{" "}
                  {session.messageCount === 1
                    ? t("1 message")
                    : t("{p0} messages", { p0: session.messageCount })}
                </Text>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ModalPanel>
  );
}

function formatWhen(at: number, unknown: string): string {
  if (!at) return unknown;
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? formatDate(date, { hour: "2-digit", minute: "2-digit" })
    : formatDate(date, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
