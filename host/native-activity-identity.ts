import { createHash } from "node:crypto";

export const nativeIdentityDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Provider preflight precedes turn capture; its device/session identity is stable. */
export const nativeProcessPrefix = (ownerId: string, sessionId: string, clientId?: string) =>
  `native-process:${nativeIdentityDigest(
    clientId
      ? [nativeIdentityDigest(ownerId), sessionId, clientId]
      : [nativeIdentityDigest(ownerId), sessionId],
  )}:`;

/** Turn markers are also scoped to the accepted run, unlike the provider process. */
export const nativeTurnPrefix = (
  ownerId: string,
  workspaceId: string,
  sessionId: string,
  clientId?: string,
) =>
  `native-turn:${nativeIdentityDigest(
    clientId
      ? [nativeIdentityDigest(ownerId), workspaceId, sessionId, clientId]
      : [nativeIdentityDigest(ownerId), workspaceId, sessionId],
  )}:`;

export const nativeTurnOwner = (
  ownerId: string,
  request: {
    workspaceId: string;
    sessionId: string;
    userBlockId: string;
    runId: string;
    clientId?: string;
  },
) =>
  `${nativeTurnPrefix(ownerId, request.workspaceId, request.sessionId, request.clientId)}${nativeIdentityDigest(
    [request.userBlockId, request.runId],
  )}`;
