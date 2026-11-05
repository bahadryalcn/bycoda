import {
  mergeNativeLibraryProofs,
  type NativeLibraryProof,
} from "../../../src/shared/model/nativeLibraryProof";
export {
  NativeLibraryProofSchema,
  mergeNativeLibraryProofs,
  type NativeLibraryProof,
} from "../../../src/shared/model/nativeLibraryProof";
const nativeResultMarker = Symbol("room-native-result");
export function roomNativeResult(value: unknown, proofs: NativeLibraryProof[]) {
  return { [nativeResultMarker]: true as const, value, proofs: mergeNativeLibraryProofs(proofs) };
}
export function unwrapRoomNativeResult(
  value: unknown,
): ReturnType<typeof roomNativeResult> | undefined {
  return value && typeof value === "object" && nativeResultMarker in value
    ? (value as ReturnType<typeof roomNativeResult>)
    : undefined;
}
