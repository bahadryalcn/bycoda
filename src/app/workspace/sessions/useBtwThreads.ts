import { HARNESS_TITLE, sessionWorkCwd, type BtwThread, type HarnessId, type Session } from "../../../features/sessions/model/session";
import { type MutableRefObject, useCallback } from "react";
import { type setSessions } from "../../../features/sessions/model/sessionsStore";
import { applyBtwHarnessEvent, buildBtwPrompt, replaceBtwThread, sealBtwResponseBlocks, supportsBtwHarness } from "../../../features/sessions/model/btw";
import { nativeModelId } from "../../../features/sessions/model/models";
import { runHarnessTextPrompt } from "../../../integrations/harness";
export interface BtwRequestInput {
  sessionId: string;
  userBlockId: string;
  source: Session;
  thread: BtwThread;
  harness: HarnessId;
}

export interface BtwThreadActions {
  updateBtwThread: (
    sessionId: string,
    userBlockId: string,
    threadId: string,
    update: (thread: BtwThread | undefined) => BtwThread | undefined,
  ) => Session | undefined;
  removeBtwThread: (sessionId: string, userBlockId: string, threadId: string) => Session | undefined;
  runBtwRequest: (input: BtwRequestInput) => void;
}

export interface BtwThreadsDeps {
  btwRequestsRef: MutableRefObject<Map<string, { sessionId: string; controller: AbortController }>>;
  sessionsRef: MutableRefObject<Session[]>;
  setSessions: typeof setSessions;
  persistSession: (session: Session | undefined) => void;
}

/** Side-question thread state: local updates, persistence, and the harness request. */
export function useBtwThreads({
  btwRequestsRef,
  sessionsRef,
  setSessions,
  persistSession,
}: BtwThreadsDeps): BtwThreadActions {
  const updateBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
      update: (thread: BtwThread | undefined) => BtwThread | undefined,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const current = block.btwThreads?.find((thread) => thread.id === threadId);
        const nextThread = update(current);
        if (!nextThread) return session;
        const nextBlock = current
          ? replaceBtwThread(block, nextThread)
          : {
              ...block,
              btwThreads: [...(block.btwThreads ?? []), nextThread],
            };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const removeBtwThread = useCallback(
    (sessionId: string, userBlockId: string, threadId: string): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const threads = block.btwThreads ?? [];
        if (!threads.some((thread) => thread.id === threadId)) return session;
        const nextThreads = threads.filter((thread) => thread.id !== threadId);
        const nextBlock = {
          ...block,
          btwThreads: nextThreads.length > 0 ? nextThreads : undefined,
        };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const runBtwRequest = useCallback(
    (input: {
      sessionId: string;
      userBlockId: string;
      source: Session;
      thread: BtwThread;
      harness: HarnessId;
    }) => {
      const harness = input.harness;
      if (!supportsBtwHarness(harness)) return;
      const cwd = sessionWorkCwd(input.source);
      const model = nativeModelId(input.thread.model ?? input.source.model).trim();
      if (!cwd || cwd === "~") {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error: "A project working directory is required for this question.",
              }
            : undefined,
        );
        return;
      }
      if (!model && harness === "codex") {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error: "The selected Codex model is unavailable.",
              }
            : undefined,
        );
        return;
      }

      let prompt: string;
      try {
        prompt = buildBtwPrompt({
          blocks: input.source.blocks,
          thread: input.thread,
          cwd,
        });
      } catch (error) {
        updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
          thread
            ? {
                ...thread,
                status: "error",
                updatedAt: Date.now(),
                error:
                  error instanceof Error
                    ? error.message
                    : "The completed turn is no longer available.",
              }
            : undefined,
        );
        return;
      }

      const key = `${input.sessionId}:${input.thread.id}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      const controller = new AbortController();
      btwRequestsRef.current.set(key, {
        sessionId: input.sessionId,
        controller,
      });

      const userMessageId =
        input.thread.messages[input.thread.messages.length - 1]?.id ?? input.thread.id;
      const responseModel = model || input.source.model;

      void runHarnessTextPrompt({
        harness,
        cwd,
        providerAccountId: input.source.providerAccountId,
        model: model || undefined,
        modelSettings: input.thread.modelSettings ?? input.source.modelSettings,
        threadId: input.thread.providerThreadId,
        ephemeral: false,
        onThreadId: (providerThreadId) => {
          if (controller.signal.aborted) return;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread && thread.providerThreadId !== providerThreadId
              ? {
                  ...thread,
                  providerThreadId,
                  updatedAt: Date.now(),
                }
              : thread,
          );
        },
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread?.status === "running"
              ? {
                  ...thread,
                  updatedAt: Date.now(),
                  pendingBlocks: applyBtwHarnessEvent(
                    thread.pendingBlocks ?? [],
                    event,
                    harness,
                    responseModel,
                    userMessageId,
                  ),
                }
              : undefined,
          );
        },
        intent: "plan",
        prompt,
        signal: controller.signal,
      })
        .then((output) => {
          if (controller.signal.aborted) return;
          const text = output.trim();
          if (!text) {
            throw new Error(`${HARNESS_TITLE[harness]} returned an empty side answer.`);
          }
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) => {
            if (!thread) return undefined;
            const pendingBlocks = thread.pendingBlocks ?? [];
            const blocks =
              pendingBlocks.length > 0
                ? sealBtwResponseBlocks(pendingBlocks, harness, responseModel, userMessageId)
                : undefined;
            return {
              ...thread,
              status: "ready",
              updatedAt: Date.now(),
              pendingBlocks: undefined,
              messages: [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text,
                  createdAt: Date.now(),
                  ...(blocks?.length ? { blocks } : {}),
                },
              ],
              error: undefined,
            };
          });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof Error
              ? error.message
              : `${HARNESS_TITLE[harness]} could not answer this side question.`;
          updateBtwThread(input.sessionId, input.userBlockId, input.thread.id, (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  pendingBlocks: undefined,
                  error: message,
                }
              : undefined,
          );
        })
        .finally(() => {
          if (btwRequestsRef.current.get(key)?.controller === controller) {
            btwRequestsRef.current.delete(key);
          }
        });
    },
    [updateBtwThread],
  );
  return { updateBtwThread, removeBtwThread, runBtwRequest };
}
