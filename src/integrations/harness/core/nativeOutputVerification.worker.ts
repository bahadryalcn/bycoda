import { verifyOutputItems, type VerificationChannel } from "./nativeOutputVerification";

self.onmessage = async (
  event: MessageEvent<{
    id: number;
    channel: VerificationChannel;
    items: readonly string[];
    utf8Bytes: number;
  }>,
) => {
  const { id, channel, items, utf8Bytes } = event.data;
  try {
    const digest = await verifyOutputItems(channel, items, utf8Bytes);
    self.postMessage({ id, digest });
  } catch {
    // A rejected/malformed computation is not proof. Client revalidates through full fallback.
    self.postMessage({ id, error: true });
  }
};
