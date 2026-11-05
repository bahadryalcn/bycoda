import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { sameQueuedModelTarget } from "../../sessions/public/messageQueue";
import type { Attachment, ComposerTurnOptions, QueuedMessage, RuntimeMode } from "../../sessions";
import type { RemoteProvider } from "./protocol";
import {
  remoteIntentAuthority,
  remoteIntentAuthorityMatches,
  remoteOutcomeUnknownMessage,
  remoteRequestPastRetryLimit,
} from "./remoteOutbox";

/** The model/mode a queued head asks for before it can be sent. */
export type QueuedConfigurationChange = {
  providerAccountId?: string | null;
  authorityGeneration?: number;
  harness: RemoteProvider;
  model: string;
  settings: Record<string, string>;
  mode: RuntimeMode;
};

/**
 * Sends the head of a remote queue once the turn is over and the machine is
 * reachable. A held queue loses nothing: it simply waits for both.
 *
 * The hook owns only the drain timer and its retry counter. The one send owner
 * stays with the caller: the head is handed to `submit`, a model change is
 * requested through `requestChange`, and a refusal is reported through
 * `reportError`. Returns `retryDrain`, which re-arms the drain (for example after
 * a lease wait).
 */
export function useQueuedSendDrain(input: {
  next: QueuedMessage | undefined;
  /** The snapshot is a page-cache copy or the conversation is gone: never drain. */
  pageCacheOnly: boolean;
  remoteDeleted: boolean;
  /** `snapshot?.authorityGeneration`: queued intents are never upgraded to a newer authority. */
  authorityGeneration: number | undefined;
  /** The conversation's own saved configuration, when the host has the session. */
  saved: QueuedConfigurationChange | undefined;
  ownerBound: boolean;
  providers: readonly RemoteProvider[];
  capabilities: readonly string[] | undefined;
  queue: {
    pause(): unknown;
    current(): { status?: string; messages: readonly unknown[] };
    sent(id: string): unknown;
  };
  /** Epoch ms before which a lease wait keeps the head from being sent. */
  leaseWait: { readonly current: number };
  submit: (
    text: string,
    attachments: Attachment[],
    options: Pick<ComposerTurnOptions, "intent">,
    asDraft: boolean,
    planBlockId: undefined,
    queuedId: string,
  ) => boolean;
  requestChange: (change: QueuedConfigurationChange) => void;
  reportError: (message: string) => void;
}): { retryDrain: () => void } {
  const { next, pageCacheOnly, remoteDeleted, saved, queue, capabilities } = input;
  const [drainRetry, setDrainRetry] = useState(0);
  const submitRef = useRef(input.submit);
  submitRef.current = input.submit;
  useEffect(() => {
    if (!next || pageCacheOnly || remoteDeleted) return;
    if (!remoteIntentAuthorityMatches(next, { authorityGeneration: input.authorityGeneration })) {
      queue.pause();
      input.reportError(
        t(
          "This queued request belongs to an earlier session authority. Review it and create a new message to continue.",
        ),
      );
      return;
    }
    // An old queued request is never re-sent automatically: its outcome is unknown.
    if (remoteRequestPastRetryLimit(next.id)) {
      input.reportError(remoteOutcomeUnknownMessage());
      return;
    }
    const target = next.modelTarget;
    if (
      target &&
      saved &&
      (!sameQueuedModelTarget(target, {
        harness: saved.harness,
        model: saved.model,
        modelSettings: saved.settings,
      }) ||
        (input.ownerBound &&
          target.providerAccountId !== undefined &&
          target.providerAccountId !== (saved.providerAccountId ?? "default")))
    ) {
      if (
        !input.providers.includes(target.harness as RemoteProvider) ||
        (target.harness !== saved.harness && !capabilities?.includes("sessions.harnessSwitch"))
      ) {
        input.reportError(t("The queued message's provider is unavailable on this machine."));
        return;
      }
      input.requestChange({
        ...remoteIntentAuthority(next),
        harness: target.harness as RemoteProvider,
        model: target.model,
        settings: { ...target.modelSettings },
        mode: saved.mode,
        ...(input.ownerBound && target.providerAccountId !== undefined
          ? {
              providerAccountId:
                target.providerAccountId === "default" ? null : target.providerAccountId,
            }
          : {}),
      });
      return;
    }
    const timer = setTimeout(() => {
      const currentQueue = queue.current();
      if (
        currentQueue.status === "paused" ||
        currentQueue.status === "restored" ||
        currentQueue.status === "resuming" ||
        currentQueue.messages[0] !== next ||
        Date.now() < input.leaseWait.current
      )
        return;
      const accepted = submitRef.current(
        next.text,
        next.attachments,
        { intent: next.intent },
        false,
        undefined,
        next.id,
      );
      if (accepted) queue.sent(next.id);
      else setDrainRetry((value) => value + 1);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    next,
    drainRetry,
    saved?.harness,
    saved?.model,
    saved?.settings,
    input.providers,
    capabilities,
    pageCacheOnly,
    input.authorityGeneration,
  ]);
  return { retryDrain: () => setDrainRetry((value) => value + 1) };
}
