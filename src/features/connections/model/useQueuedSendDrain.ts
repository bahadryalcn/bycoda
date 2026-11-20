import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { sameQueuedModelTarget } from "../../sessions/public/messageQueue";
import type { Attachment, ComposerTurnOptions, QueuedMessage, RuntimeMode } from "../../sessions";
import type { RemoteProvider } from "./protocol";
import { SESSION_PROVIDER_ACCOUNT } from "./remoteCapabilities";
import {
  remoteIntentAuthority,
  remoteIntentAuthorityMatches,
  remoteOutcomeUnknownMessage,
  remoteRequestPastRetryLimit,
} from "./remoteOutbox";

export const QUEUED_DRAIN_RETRY_MIN_MS = 250;
export const QUEUED_DRAIN_RETRY_MAX_MS = 5_000;

/** Wait before offering a refused queue head again: 250 ms doubling up to 5 s. */
export const queuedDrainRetryDelay = (refusals: number): number =>
  Math.min(QUEUED_DRAIN_RETRY_MIN_MS * 2 ** Math.min(refusals, 10), QUEUED_DRAIN_RETRY_MAX_MS);

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
  /** Consecutive refused submits of the current head; sets the next wait. */
  const refusals = useRef(0);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reset the Host retry backoff when the pending send or its admission conditions change.
  useEffect(() => {
    refusals.current = 0;
  }, [
    next?.id,
    saved?.harness,
    saved?.model,
    saved?.settings,
    input.providers,
    capabilities,
    pageCacheOnly,
    remoteDeleted,
    input.authorityGeneration,
  ]);
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
    // A row's account applies only when it switches provider. On the same provider the
    // conversation's current account wins: the owner may have switched after a usage limit.
    const switchesProvider = !!target && !!saved && target.harness !== saved.harness;
    if (
      target &&
      saved &&
      !sameQueuedModelTarget(target, {
        harness: saved.harness,
        model: saved.model,
        modelSettings: saved.settings,
      })
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
        ...(capabilities?.includes(SESSION_PROVIDER_ACCOUNT) &&
        switchesProvider &&
        target.providerAccountId !== undefined
          ? {
              providerAccountId:
                target.providerAccountId === "default" ? null : target.providerAccountId,
            }
          : {}),
      });
      return;
    }
    const attempt = () => {
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
      if (accepted) {
        refusals.current = 0;
        queue.sent(next.id);
        return;
      }
      // A refusal (rewind, preparing, missing context replay) is tracked in refs that never
      // re-render this hook, so look again later at a bounded pace instead of spinning. The
      // head stays first in the queue and is offered again with the same id.
      const delay = queuedDrainRetryDelay(refusals.current++);
      timer = setTimeout(attempt, delay);
    };
    let timer = setTimeout(attempt, 0);
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
    remoteDeleted,
    input.authorityGeneration,
  ]);
  return {
    retryDrain: () => {
      // The owner asks for a fresh look (for example after a lease wait): start the pace over.
      refusals.current = 0;
      setDrainRetry((value) => value + 1);
    },
  };
}
