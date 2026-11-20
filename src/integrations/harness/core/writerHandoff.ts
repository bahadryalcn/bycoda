import { errorText } from "../../../shared/lib/errors";

/**
 * Desktop windows share one native session claim per conversation. When a
 * window finds the claim held, it asks the holding window to retire its idle
 * writer, the same retirement a Host takeover from the phone or another PC
 * uses, and then acquires the claim itself.
 */
const CHANNEL = "bycoda-harness-writer-handoff-v1";
/** Matches the Host's desktop writer transfer deadline. */
export const WRITER_HANDOFF_TIMEOUT_MS = 12_000;

type HandoffMessage =
  | { type: "request"; id: string; sessionId: string }
  | { type: "reply"; id: string; error?: string };

let served: BroadcastChannel | undefined;
/** This window's own requests; its server must not answer them. */
const ownRequests = new Set<string>();

/** Answer other windows for writers this window holds; `release` returns false when it holds none. */
export function serveWriterHandoff(release: (sessionId: string) => Promise<boolean>): void {
  if (served || typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  served = channel;
  channel.onmessage = (event: MessageEvent<HandoffMessage>) => {
    const message = event.data;
    if (
      message?.type !== "request" ||
      typeof message.sessionId !== "string" ||
      ownRequests.has(message.id)
    )
      return;
    void release(message.sessionId).then(
      (held) => {
        if (held) channel.postMessage({ type: "reply", id: message.id });
      },
      (error: unknown) =>
        channel.postMessage({
          type: "reply",
          id: message.id,
          error: errorText(error),
        }),
    );
  };
}

/** Resolves true once the holding window retired its writer, false when no window answered. */
export function requestWriterHandoff(
  sessionId: string,
  timeoutMs = WRITER_HANDOFF_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  const channel = new BroadcastChannel(CHANNEL);
  const id = crypto.randomUUID();
  ownRequests.add(id);
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => finish(() => resolve(false)), timeoutMs);
    function finish(settle: () => void) {
      clearTimeout(timer);
      ownRequests.delete(id);
      channel.close();
      settle();
    }
    channel.onmessage = (event: MessageEvent<HandoffMessage>) => {
      const message = event.data;
      if (message?.type !== "reply" || message.id !== id) return;
      finish(() => (message.error ? reject(new Error(message.error)) : resolve(true)));
    };
    channel.postMessage({ type: "request", id, sessionId });
  });
}
