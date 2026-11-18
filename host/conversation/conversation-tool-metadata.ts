/** Transport authorization is independent of descriptive read-only hints.
 * Room notebook reads retain their existing write-scoped transport policy. */
export function conversationToolMetadata(action: string, authorizationScope: "read" | "write") {
  const readOnly =
    authorizationScope === "read" || action === "notebook.list" || action === "notebook.get";
  return {
    authorizationScope,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      idempotentHint: readOnly,
      openWorldHint:
        (action.startsWith("inbox.") && action !== "inbox.list") ||
        action === "liveGames.start" ||
        action === "liveGames.obsStream" ||
        action === "liveGames.goLive" ||
        action === "liveGames.endLive",
    },
  };
}
