/** How far above the end a reader may rest and still count as following the newest turn. */
export const CHAT_TAIL_PX = 24;

/** True when the scroller sits at, or within a few pixels of, its end. */
export function isAtChatTail(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= CHAT_TAIL_PX;
}
