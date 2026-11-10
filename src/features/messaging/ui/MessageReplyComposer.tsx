import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { MOD } from "../../../platform/tauri/platform";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { replyToThread } from "../model/messagingApi";
import type { MessageThread, ThreadMessage } from "../model/messagingTypes";
import {
  beginReplySend,
  clearReplyDraft,
  readReplyDraft,
  replyDraftKey,
  writeReplyDraftBody,
} from "../model/replyDrafts";

function destinationHint(thread: MessageThread, replyAddress: string | null): string | null {
  if (thread.provider === "email")
    return replyAddress ? t("Reply to {p0}", { p0: replyAddress }) : null;
  if (thread.provider === "teams") return t("Sends to this Teams chat");
  if (thread.provider === "slack") return t("Sends to {p0} in Slack", { p0: thread.title });
  return t("Sends to {p0} in Discord", { p0: thread.title });
}

/**
 * Reply editor for one thread. Sending is always an explicit press or Ctrl/Cmd+Enter;
 * the draft lives outside the component so switching threads keeps it, and a failed send
 * keeps the text and retries with the same request id.
 */
export function MessageReplyComposer({
  thread,
  replyAddress,
  onSent,
}: {
  thread: MessageThread;
  replyAddress: string | null;
  onSent: (message: ThreadMessage) => void;
}) {
  useLocale();
  const key = replyDraftKey(thread.accountId, thread.id);
  const [draft, setDraft] = useState(() => readReplyDraft(key).body);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const sendingRef = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const body = draft.trim();
  const hint = destinationHint(thread, replyAddress);

  const send = async () => {
    if (!body || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const requestId = beginReplySend(key, body);
    try {
      const message = await replyToThread(thread.accountId, thread.id, body, requestId);
      clearReplyDraft(key);
      setDraft("");
      onSent(message);
      field.current?.focus();
    } catch (cause) {
      setError(t("The reply was not sent. {p0}", { p0: errorText(cause) }));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing)
      return;
    event.preventDefault();
    send().catch((cause: unknown) => console.error("Reply send failed:", cause));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send().catch((cause: unknown) => console.error("Reply send failed:", cause));
  };

  return (
    <form
      onSubmit={onSubmit}
      aria-busy={sending}
      className="flex shrink-0 flex-col gap-1.5 border-t border-(--ui-tone-neutral-border) px-4 py-2"
    >
      <TextareaField
        hideLabel
        label={t("Reply")}
        ref={field}
        minRows={2}
        maxRows={8}
        autosize
        value={draft}
        // Read-only rather than disabled while sending, so focus stays in the field.
        readOnly={sending}
        placeholder={t("Write a reply ({p0}↩ to send)", { p0: MOD })}
        onChange={(event) => {
          setDraft(event.target.value);
          writeReplyDraftBody(key, event.target.value);
        }}
        onKeyDown={onKeyDown}
        fieldClassName="w-full"
      />
      <div className="flex min-w-0 items-center justify-end gap-2">
        {hint ? (
          <OverflowTooltip label={hint}>
            <span className="min-w-0 flex-1 truncate text-ui-caption text-(--ui-text-secondary)">
              {hint}
            </span>
          </OverflowTooltip>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={!body}
          loading={sending}
          loadingLabel={t("Sending…")}
          shortcut="Mod+Enter"
          className="shrink-0"
        >
          {t("Send")}
        </Button>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </form>
  );
}
