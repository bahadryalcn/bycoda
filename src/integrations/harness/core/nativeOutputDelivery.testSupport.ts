// Fixture metadata is deliberately synthetic, never Native qualification.
import { createHash, randomUUID } from "node:crypto";
import {
  deliverNativeOutputItem,
  inspectNativeOutputDelivery,
  observeNativeOutputBatch,
  type NativeOutputMetadata,
} from "./nativeOutputDelivery";

export { captureNativeOutputEvent, getNativeOutputEventOrigin } from "./nativeOutputDelivery";

export function nativeOutputFrame(sessionId: string, line: string, callback: () => void, logicalSessionId?: string) {
  const count = Buffer.alloc(4); count.writeUInt32LE(1);
  const bytes = Buffer.from(line), length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(bytes.length));
  const streamEpoch = randomUUID();
  const metadata: NativeOutputMetadata = {
    version: 1, qualified: false, processEpoch: randomUUID(), streamEpoch,
    streamKind: "process", sessionId, ...(logicalSessionId === undefined ? {} : {logicalSessionId}),
    sourceStoreId: "fixture-store", sourceProfileId: "fixture-profile", storeInstance: randomUUID(),
    processId: 42, ownerEpoch: randomUUID(), sequence: 1, channel: "stdout", itemCount: 1,
    utf8Bytes: bytes.length, payloadSha256: createHash("sha256").update(Buffer.concat([
      Buffer.from("bycoda-native-output-items-v1\0"), Buffer.from([1]), count, length, bytes,
    ])).digest("hex"), digestEncoding: "bycoda-output-items-le/v1", available: true, unavailableReason: null,
  };
  const [item] = observeNativeOutputBatch(sessionId, "stdout", [line], metadata)!;
  deliverNativeOutputItem(item, callback);
  return () => inspectNativeOutputDelivery(logicalSessionId ?? sessionId).streams.find(stream => stream.streamEpoch === streamEpoch)!;
}
