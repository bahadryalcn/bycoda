import { isTauri } from "@tauri-apps/api/core";
import { beginAssistantDraftOperation } from "../../model/assistantDraftFlush";
import {
  assistantNativeHeldIntent,
  readAssistantNativeHeldIntent,
  reconcileAssistantNative,
  sendAssistantNative,
} from "../../model/assistantNativeSend";
import { AssistantResponseValidationSchema } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { operationId } from "../../model/assistantClient";
import {
  type ConversationPanelProps,
  type ConversationPanelState,
} from "./useConversationPanelState";
import type { ConversationPanelMessagesState } from "./useConversationPanelMessages";

export type ConversationPanelSendState = ReturnType<typeof useConversationPanelSend>;

export function useConversationPanelSend(
  input: ConversationPanelProps & ConversationPanelState & ConversationPanelMessagesState,
) {
  const {
    assistantRequest,
    threadId,
    currentScope,
    threadVisible,
    scope,
    setMessages,
    drafts,
    setDrafts,
    draftsRef,
    setPending,
    pending,
    clearingRef,
    error,
    setError,
    selected,
    requestKey,
    nativeSendInFlight,
    nativeDrafts,
    nativeDraftReady,
    nativeDraftKey,
    setNativeDraftReload,
    flushNativeDraft,
    flushDrafts,
    environmentId,
    sessionId,
    isAppQuitting,
    load,
  } = input;

  async function checkConversation() {
    if (isAppQuitting()) return;
    const release = beginAssistantDraftOperation();
    const target = threadId;
    try {
      if (isTauri() && environmentId) {
        const intent =
          assistantNativeHeldIntent(target, environmentId) ??
          (await readAssistantNativeHeldIntent(target, environmentId));
        if (
          intent &&
          threadVisible(target) &&
          currentScope.current.environmentId === intent.environmentId
        ) {
          if (nativeDraftReady !== JSON.stringify([intent.environmentId, target]))
            throw new Error("The original draft is unavailable. Recover it before continuing.");
          await flushNativeDraft(target);
          AssistantResponseValidationSchema.parse(
            await reconcileAssistantNative(target, intent.environmentId, intent.key),
          );
          setNativeDraftReload((value) => value + 1);
          await load(target);
          return;
        }
      }
      await load(target);
      if (isTauri() && selected.current === target && error)
        setError(
          t(
            "The original reply remains unconfirmed. Check the original Host before sending again.",
          ),
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      release();
    }
  }
  async function send() {
    if (isAppQuitting()) return;
    if (isTauri()) {
      if (nativeSendInFlight.current) return;
      const target = threadId;
      const text = (drafts[target] ?? "").trim();
      if (
        !text ||
        pending ||
        clearingRef.current ||
        nativeDraftReady !== nativeDraftKey ||
        !threadVisible(target)
      )
        return;
      if (!environmentId) {
        setError(
          t(
            "The original Host could not be verified. Keep this draft and reconnect its original computer.",
          ),
        );
        return;
      }
      const sourceEnvironment = environmentId;
      const key = operationId();
      const sourceSession = scope === "session" ? sessionId : undefined;
      nativeSendInFlight.current = true;
      const release = beginAssistantDraftOperation();
      setPending(true);
      setError("");
      try {
        await flushNativeDraft(target);
        if (
          selected.current !== target ||
          currentScope.current.environmentId !== sourceEnvironment ||
          !threadVisible(target)
        )
          throw new Error(
            "The original conversation is no longer available. Keep the draft before continuing.",
          );
        const draft = nativeDrafts.current.get(target);
        if (!draft || draft.environmentId !== sourceEnvironment)
          throw new Error("The original draft is unavailable.");
        await sendAssistantNative(
          target,
          {
            text,
            key,
            environmentId: sourceEnvironment,
            draftVersion: draft.version,
            ...(sourceSession ? { sessionId: sourceSession } : {}),
          },
          async (response) => {
            if (isAppQuitting())
              throw new Error("The reply is retained for recovery after closing.");
            const reply = AssistantResponseValidationSchema.parse(response);
            if (!reply.messages?.some((message) => message.role === "assistant"))
              throw new Error(
                t("The reply has not been confirmed. Check the conversation before retrying."),
              );
            if (
              selected.current !== target ||
              currentScope.current.environmentId !== sourceEnvironment ||
              !threadVisible(target)
            )
              throw new Error(
                "The original conversation is no longer available. Check it before retrying.",
              );
            setMessages((current) => {
              const existing = current[target] ?? [];
              return {
                ...current,
                [target]: [
                  ...existing,
                  ...reply.messages!.filter(
                    (message) => !existing.some((item) => item.id === message.id),
                  ),
                ],
              };
            });
            const currentDrafts = draftsRef.current;
            const nextDrafts = {
              ...currentDrafts,
              [target]: (currentDrafts[target] ?? "").trim() === text ? "" : currentDrafts[target],
            };
            draftsRef.current = nextDrafts;
            const currentDraft = nativeDrafts.current.get(target);
            if (currentDraft?.environmentId === sourceEnvironment)
              currentDraft.desired = nextDrafts[target] ?? "";
            setDrafts(nextDrafts);
            // A confirmed reply must not clear its send fence until the matching
            // draft update is durable too; otherwise reload could offer it again.
            await flushNativeDraft(target);
            return reply;
          },
          release,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        release();
        nativeSendInFlight.current = false;
        setPending(false);
      }
      return;
    }
    if (!navigator.locks) {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      return;
    }
    try {
      await navigator.locks.request(
        "bycoda.assistant.send-intents",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setError(
              t("The reply has not been confirmed. Check the conversation before retrying."),
            );
            return;
          }
          await sendLocked();
        },
      );
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
    }
  }
  async function sendLocked() {
    const text = (drafts[threadId] ?? "").trim();
    if (!text || pending || clearingRef.current || !threadVisible(threadId)) return;
    let persisted: typeof requestKey.current;
    try {
      persisted = JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
      if (!persisted || typeof persisted !== "object" || Array.isArray(persisted))
        throw new Error("Invalid intents");
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      return;
    }
    requestKey.current = persisted;
    const previous = persisted[threadId];
    // A retained intent may already have reached the Host. Do not dispatch it
    // again merely because the same draft remains visible after an uncertain
    // result; recovery must establish the original outcome first.
    if (previous) {
      setError(t("The reply has not been confirmed. Check the conversation before retrying."));
      return;
    }
    const sourceEnvironment = environmentId;
    if (!sourceEnvironment) {
      setError(
        t(
          "The original Host could not be verified. Keep this draft and reconnect its original computer.",
        ),
      );
      return;
    }
    setPending(true);
    setError("");
    const key = operationId();
    const sourceSession = scope === "session" ? sessionId : undefined;
    requestKey.current[threadId] = {
      text,
      key,
      environmentId: sourceEnvironment,
      ...(sourceSession ? { sessionId: sourceSession } : {}),
    };
    try {
      localStorage.setItem("bycoda.assistant.send-intents", JSON.stringify(requestKey.current));
    } catch {
      setError(
        t("The send identity could not be saved. Keep this window open until the result is known."),
      );
      setPending(false);
      return;
    }
    try {
      const result = await assistantRequest(
        {
          op: "threads.send",
          threadId,
          text,
          via: "text",
          idempotencyKey: key,
          ...(sourceSession ? { sessionId: sourceSession } : {}),
        },
        sourceEnvironment,
      );
      if (!result.messages?.some((message) => message.role === "assistant"))
        throw new Error(
          t("The reply has not been confirmed. Check the conversation before retrying."),
        );
      setMessages((current) => {
        const existing = current[threadId] ?? [];
        return {
          ...current,
          [threadId]: [
            ...existing,
            ...result.messages!.filter(
              (message) => !existing.some((item) => item.id === message.id),
            ),
          ],
        };
      });
      const currentDrafts = draftsRef.current;
      const nextDrafts = {
        ...currentDrafts,
        [threadId]: (currentDrafts[threadId] ?? "").trim() === text ? "" : currentDrafts[threadId],
      };
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      flushDrafts();
      delete requestKey.current[threadId];
      try {
        const latest = JSON.parse(localStorage.getItem("bycoda.assistant.send-intents") ?? "{}");
        if (latest?.[threadId]?.key === key) delete latest[threadId];
        localStorage.setItem("bycoda.assistant.send-intents", JSON.stringify(latest));
      } catch {
        /* A retained receipt remains safe to retry. */
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  return {
    checkConversation,
    send,
    sendLocked,
  };
}
