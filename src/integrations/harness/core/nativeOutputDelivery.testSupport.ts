// Fixture metadata is deliberately synthetic, never Native qualification.
import { createHash, randomUUID } from "node:crypto";
import {
  deliverNativeOutputItem,
  inspectNativeOutputDelivery,
  observeNativeOutputBatch,
  type NativeOutputMetadata,
} from "./nativeOutputDelivery";

export { captureNativeOutputEvent, getNativeOutputEventOrigin } from "./nativeOutputDelivery";

export function nativeOutputFrame(
  sessionId: string,
  line: string,
  callback: () => void,
  logicalSessionId?: string,
) {
  return nativeOutputStream(sessionId, logicalSessionId)(line, callback);
}

/** Repeated frames from one synthetic physical producer/recipient. */
export function nativeOutputStream(sessionId: string, logicalSessionId?: string) {
  const streamEpoch = randomUUID();
  const processEpoch = randomUUID();
  const storeInstance = randomUUID();
  const ownerEpoch = randomUUID();
  let sequence = 0;
  return (line: string, callback: () => void) => {
    const count = Buffer.alloc(4);
    count.writeUInt32LE(1);
    const bytes = Buffer.from(line),
      length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(bytes.length));
    const metadata: NativeOutputMetadata = {
      version: 1,
      qualified: false,
      processEpoch,
      streamEpoch,
      streamKind: "process",
      sessionId,
      ...(logicalSessionId === undefined ? {} : { logicalSessionId }),
      sourceStoreId: "fixture-store",
      sourceProfileId: "fixture-profile",
      storeInstance,
      processId: 42,
      ownerEpoch,
      sequence: ++sequence,
      channel: "stdout",
      itemCount: 1,
      utf8Bytes: bytes.length,
      payloadSha256: createHash("sha256")
        .update(
          Buffer.concat([
            Buffer.from("bycoda-native-output-items-v1\0"),
            Buffer.from([1]),
            count,
            length,
            bytes,
          ]),
        )
        .digest("hex"),
      digestEncoding: "bycoda-output-items-le/v1",
      available: true,
      unavailableReason: null,
    };
    const item = observeNativeOutputBatch(sessionId, "stdout", [line], metadata)?.[0];
    deliverNativeOutputItem(item, callback);
    return () =>
      inspectNativeOutputDelivery(logicalSessionId ?? sessionId).streams.find(
        (stream) => stream.streamEpoch === streamEpoch,
      )!;
  };
}
