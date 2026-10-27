import { createHash } from "node:crypto";

export const nativeIdentityDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Provider processes live across turns; their device/session identity is stable. */
export const nativeProcessPrefix = (ownerId: string, sessionId: string) =>
  `native-process:${nativeIdentityDigest([nativeIdentityDigest(ownerId), sessionId])}:`;

/** Turn markers are also scoped to the accepted run, unlike the provider process. */
export const nativeTurnPrefix = (ownerId: string, workspaceId: string, sessionId: string) =>
  `native-turn:${nativeIdentityDigest([nativeIdentityDigest(ownerId), workspaceId, sessionId])}:`;

export const nativeTurnOwner = (
  ownerId: string,
  request: { workspaceId: string; sessionId: string; userBlockId: string; runId: string },
) =>
  `${nativeTurnPrefix(ownerId, request.workspaceId, request.sessionId)}${nativeIdentityDigest([
    request.userBlockId,
    request.runId,
  ])}`;
