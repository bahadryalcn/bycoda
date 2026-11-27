import type { SocialClient } from "../../model/socialClient";
import type { InstagramDirectMediaKind } from "../../../../integrations/social/adapters/instagram-direct-media";
import type { InboxReplyOperation } from "./inboxReplyOperation";

export type ReplyDraft = {
  text: string;
  factIds: string[];
  instagramPrivateReply?: true;
  instagramAttachment?: { kind: InstagramDirectMediaKind; url: string; file?: File };
};
type ReplyState = {
  draft: ReplyDraft;
  operation?: InboxReplyOperation;
  busy: "" | "suggest" | "send";
  error: string;
  /** Raw Host text behind `error`, shown under Details rather than inside the sentence. */
  errorDetail: string;
  queued: boolean;
};

// Same lifetime and authority as retained Social clients; never share across Hosts.
const clients = new WeakMap<SocialClient, Map<string, ReturnType<typeof createState>>>();
function createState() {
  let current: ReplyState = {
    draft: { text: "", factIds: [] },
    busy: "",
    error: "",
    errorDetail: "",
    queued: false,
  };
  const listeners = new Set<() => void>();
  return {
    snapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (patch: Partial<ReplyState>) => {
      current = { ...current, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

export function inboxReplyState(client: SocialClient, threadId: string) {
  let threads = clients.get(client);
  if (!threads) {
    threads = new Map();
    clients.set(client, threads);
  }
  let state = threads.get(threadId);
  if (!state) {
    state = createState();
    threads.set(threadId, state);
  }
  return state;
}
