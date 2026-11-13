import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { t } from "../../../../shared/i18n";
import type { AssistantThread } from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { Text } from "../../../../shared/ui/Text";
import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { ScrollArea } from "../../../../shared/ui/ScrollArea";
import { CheckList, RefreshCw } from "../../../../shared/ui/icons";
import { AssistantChatComposer, AssistantChatMessage } from "./AssistantChat";
import { ConversationDraftRecovery } from "./ConversationDraftRecovery";
import { useAssistantRoom } from "./assistantRoomContext";
import {
  useConversationPanelState,
  type ConversationPanelProps,
} from "./useConversationPanelState";
import { useConversationPanelMessages } from "./useConversationPanelMessages";
import { useConversationPanelSend } from "./useConversationPanelSend";
import { useConversationPanelView } from "./useConversationPanelView";
import styles from "./Jobs.module.css";

/** A dedicated, durable planning thread; no worker starts from a discussion send. */
export function JobDiscussion() {
  const room = useAssistantRoom();
  return (
    <JobDiscussionSource
      key={JSON.stringify([room.environmentId, room.defaultProjectId, room.privacy.key])}
    />
  );
}

function JobDiscussionSource() {
  const room = useAssistantRoom();
  const [request] = useState(() => room.assistantRequest);
  const [thread, setThread] = useState<AssistantThread>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const environmentId = room.environmentId;
  const projectId = room.defaultProjectId;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Loads the dedicated planning thread for this exact Host and visible project; never sends a message or starts work.
  useEffect(() => {
    let active = true;
    if (!environmentId) return;
    setError("");
    void request(
      { op: "threads.open", purpose: "job-planning", ...(projectId ? { projectId } : {}) },
      environmentId,
    )
      .then((result) => {
        if (!active) return;
        if (
          result.thread?.purpose !== "job-planning" ||
          (result.thread.projectId ?? "") !== projectId
        )
          throw new Error("The job discussion could not be opened.");
        setThread(result.thread);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [request, environmentId, projectId, attempt]);
  if (error)
    return (
      <InlineError retry={{ onRetry: () => setAttempt((value) => value + 1), label: t("Retry") }}>
        {t(error)}
      </InlineError>
    );
  if (!thread || !room.snapshot || !room.canonicalSnapshot)
    return <LoadingText>{t("Opening job discussion...")}</LoadingText>;
  return <JobDiscussionConversation thread={thread} />;
}

function JobDiscussionConversation({ thread }: { thread: AssistantThread }) {
  const room = useAssistantRoom();
  const props: ConversationPanelProps = {
    request: room.assistantRequest,
    environmentId: room.environmentId,
    snapshot: { ...room.snapshot!, threads: [thread] },
    source: {
      ...room.canonicalSnapshot!,
      threads: [...room.canonicalSnapshot!.threads.filter((item) => item.id !== thread.id), thread],
    },
    privacy: room.privacy,
    canSeeProject: room.canSeeProject,
    projectId: thread.projectId ?? "",
    projects: room.projects,
    query: "",
    onJob: room.setDetail,
    isAppQuitting: room.isAppQuitting,
  };
  const state = useConversationPanelState(props);
  const messages = useConversationPanelMessages({ ...props, ...state });
  const send = useConversationPanelSend({ ...props, ...state, ...messages });
  const view = useConversationPanelView({ ...props, ...state, ...messages, ...send });
  const c = { ...props, ...state, ...messages, ...send, ...view };
  const latest = c.visible[c.visible.length - 1];
  const native = isTauri();
  const ready = !native || c.nativeDraftReady === c.nativeDraftKey;
  const draft =
    !native || c.nativeDraftDisplayed === c.nativeDraftKey ? (c.drafts[c.threadId] ?? "") : "";
  const fail = (cause: unknown) =>
    c.setError(cause instanceof Error ? cause.message : String(cause));
  const canReview =
    latest?.role === "assistant" &&
    !c.pending &&
    !c.error &&
    !draft.trim() &&
    !c.draftSaveError &&
    !c.requestKey.current[c.threadId];
  return (
    <section className={styles.discussion}>
      <Text size="caption" tone="secondary">
        {t("Discuss the outcome, then review the brief before starting.")}
      </Text>
      {!!c.visible.length && (
        <ScrollArea
          className={styles.discussionTranscript}
          ref={c.history}
          onScroll={(event) => c.onHistoryScroll(event.currentTarget)}
        >
          {c.hasMore[c.threadId] && (
            <Button
              disabled={c.pending}
              onClick={() => void c.load(c.threadId, c.messages[c.threadId]?.[0]).catch(fail)}
            >
              {t("Load earlier messages")}
            </Button>
          )}
          {c.visible.map((message) => (
            <AssistantChatMessage
              key={message.id}
              role={message.role}
              text={message.text}
              author={message.role === "assistant" ? room.identity.name : t("You")}
            />
          ))}
        </ScrollArea>
      )}
      {c.error && (
        <InlineError
          retry={{ label: t("Check conversation"), onRetry: () => void c.checkConversation() }}
        >
          {c.error}
        </InlineError>
      )}
      {c.draftSaveError && (
        <InlineError retry={{ label: t("Recover draft"), onRetry: () => c.openDraftRecovery() }}>
          {t("The draft could not be saved.")}
        </InlineError>
      )}
      <AssistantChatComposer
        label={t("Discuss a job")}
        placeholder={t("What should this job achieve?")}
        value={draft}
        pending={c.pending}
        disabled={!c.threadVisible(c.threadId)}
        readOnly={!ready}
        sendDisabled={!c.supported || c.clearing || !!c.requestKey.current[c.threadId]}
        onValueChange={(value) => {
          if (room.isAppQuitting()) return;
          const saved = c.nativeDrafts.current.get(c.threadId);
          if (native && saved && saved.environmentId === room.environmentId) saved.desired = value;
          c.draftsRef.current = { ...c.draftsRef.current, [c.threadId]: value };
          c.setDrafts((current) => ({ ...current, [c.threadId]: value }));
        }}
        onSend={() => void c.send().catch(fail)}
      />
      {!!c.visible.length && (
        <div className={styles.discussionActions}>
          <Button
            variant="ghost"
            iconOnly
            label={t("Check conversation")}
            disabled={c.pending}
            onClick={() => void c.checkConversation()}
          >
            <RefreshCw className="icon-sm" />
          </Button>
          {latest?.role === "assistant" && (
            <Button
              variant="primary"
              startIcon={<CheckList className="icon-sm" />}
              disabled={!canReview || !!room.pending}
              onClick={() => {
                if (!canReview) return;
                try {
                  const prepared = room.prepareJobReview(latest.text, true);
                  room.setJobText(latest.text);
                  room.openJobReview(prepared);
                } catch (cause) {
                  fail(cause);
                }
              }}
            >
              {t("Review brief")}
            </Button>
          )}
        </div>
      )}
      {!c.supported && (
        <Text size="caption" tone="secondary">
          {t("Conversation replies are unavailable on this Host.")}
        </Text>
      )}
      <ConversationDraftRecovery c={c} />
    </section>
  );
}
