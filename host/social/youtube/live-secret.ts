import { createHash } from "node:crypto";
import type { YouTubeLiveIngestSecret } from "../../../src/integrations/social/youtube-live";
import type { SocialCredentialStore } from "../social-credentials";

const referencePattern = /^youtube-live:[a-f0-9]{64}$/;

function reference(accountId: string, streamId: string): string {
  const id = createHash("sha256").update(JSON.stringify([accountId, streamId])).digest("hex");
  return `youtube-live:${id}`;
}

/** Store the key and ingest URL in the existing OS social vault. Only the opaque reference leaves Host. */
export function youTubeLiveSecretWriter(credentials: SocialCredentialStore, accountId: string) {
  return async (secret: YouTubeLiveIngestSecret): Promise<string> => {
    const credentialRef = reference(accountId, secret.streamId);
    await credentials.set(credentialRef, { accessToken: JSON.stringify(secret) });
    return credentialRef;
  };
}

/** Only for a future, authorized encoder handoff inside Host. Keep this out of RPC and tool output. */
export async function loadYouTubeLiveIngest(
  credentials: SocialCredentialStore,
  accountId: string,
  streamId: string,
  credentialRef: string,
): Promise<YouTubeLiveIngestSecret | undefined> {
  if (!referencePattern.test(credentialRef) || credentialRef !== reference(accountId, streamId))
    return undefined;
  const credential = await credentials.get(credentialRef);
  if (!credential) return undefined;
  try {
    const value: Partial<YouTubeLiveIngestSecret> = JSON.parse(credential.accessToken);
    if (
      value?.streamId === streamId &&
      typeof value.rtmpUrl === "string" &&
      typeof value.streamKey === "string"
    )
      return { streamId: value.streamId, rtmpUrl: value.rtmpUrl, streamKey: value.streamKey };
  } catch {
    // A vault entry from an incompatible version must never be exposed as a key.
  }
  throw new Error("YouTube Live credential is unavailable.");
}
