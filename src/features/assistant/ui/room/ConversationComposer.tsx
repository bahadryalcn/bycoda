import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { ArrowUp } from "../../../../shared/ui/icons";
import { PromptField } from "../../../../shared/ui/PromptField";
import styles from "./Conversation.module.css";
import type { ConversationContext } from "./ConversationTypes";

export function ConversationComposer({
  c,
  onFailure,
}: {
  c: ConversationContext;
  onFailure: (cause: unknown) => void;
}) {
  const {
    snapshot,
    threadId,
    drafts,
    setDrafts,
    draftsRef,
    nativeDrafts,
    nativeDraftReady,
    nativeDraftDisplayed,
    nativeDraftKey,
    environmentId,
    isAppQuitting,
    clearing,
    pending,
    supported,
    send,
  } = c;
  const name = snapshot.profile.name;
  return (
    <div className={styles.composer}>
      <PromptField
        quiet
        label={t("Message {p0}", { p0: name })}
        placeholder={t("Message {p0}", { p0: name })}
        value={
          threadId && (!isTauri() || nativeDraftDisplayed === nativeDraftKey)
            ? (drafts[threadId] ?? "")
            : ""
        }
        disabled={!threadId}
        readOnly={isTauri() && nativeDraftReady !== nativeDraftKey}
        minRows={1}
        maxRows={8}
        maxLength={16000}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            if (supported && !clearing) void send().catch(onFailure);
          }
        }}
        onChange={(event) => {
          if (isTauri() && isAppQuitting()) return;
          const value = event.currentTarget.value;
          const nativeDraft = nativeDrafts.current.get(threadId);
          if (isTauri() && nativeDraft && nativeDraft.environmentId === environmentId)
            nativeDraft.desired = value;
          draftsRef.current = { ...draftsRef.current, [threadId]: value };
          setDrafts((current) => ({ ...current, [threadId]: value }));
        }}
        toolbarTrailing={
          <Button
            variant="primary"
            iconOnly
            label={t("Send")}
            loading={pending}
            disabled={
              clearing ||
              !threadId ||
              !drafts[threadId]?.trim() ||
              !supported ||
              (isTauri() && nativeDraftReady !== nativeDraftKey)
            }
            onClick={() => void send().catch(onFailure)}
          >
            <ArrowUp className="icon-md" />
          </Button>
        }
      />
    </div>
  );
}
