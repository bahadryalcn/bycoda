import { setSessions } from "../../../../features/sessions/model/sessionsStore";

/**
 * Tells the reader why a send did not go out as typed. A plain status line
 * folds into the running turn's activity and is gone within seconds; a notice
 * block stays visible in the transcript. An identical notice right above is not
 * repeated, so a second refusal for the same reason adds nothing.
 */
export function showSubmitNotice(
  sessionId: string,
  text: string,
  notice: "info" | "error" = "info",
): void {
  const message = text.trim();
  if (!message) return;
  setSessions((all) =>
    all.map((session) => {
      if (session.id !== sessionId) return session;
      // Earlier pages are still being merged into this transcript. Any block
      // change now makes that merge discard its result and leaves the
      // conversation "loading" for good, so no notice is added until it ends
      // (or has failed, when nothing more arrives).
      if (session.historyLoading && !session.historyLoadError) return session;
      const last = session.blocks[session.blocks.length - 1];
      if (last?.role === "system" && last.notice === notice && last.text === message)
        return session;
      return {
        ...session,
        blocks: [
          ...session.blocks,
          { id: crypto.randomUUID(), role: "system" as const, text: message, notice },
        ],
      };
    }),
  );
}
