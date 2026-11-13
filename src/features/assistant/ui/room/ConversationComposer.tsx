import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import { AssistantChatComposer } from "./AssistantChat";
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
      <AssistantChatComposer
        label={t("Message {p0}", { p0: name })}
        placeholder={t("Message {p0}", { p0: name })}
        value={
          threadId && (!isTauri() || nativeDraftDisplayed === nativeDraftKey)
            ? (drafts[threadId] ?? "")
            : ""
        }
        disabled={!threadId}
        readOnly={isTauri() && nativeDraftReady !== nativeDraftKey}
        pending={pending}
        sendDisabled={clearing || !supported}
        onSend={() => void send().catch(onFailure)}
        onValueChange={(value) => {
          if (isTauri() && isAppQuitting()) return;
          const nativeDraft = nativeDrafts.current.get(threadId);
          if (isTauri() && nativeDraft && nativeDraft.environmentId === environmentId)
            nativeDraft.desired = value;
          draftsRef.current = { ...draftsRef.current, [threadId]: value };
          setDrafts((current) => ({ ...current, [threadId]: value }));
        }}
      />
    </div>
  );
}
