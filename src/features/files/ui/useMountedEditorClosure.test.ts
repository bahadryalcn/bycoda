import { describe, expect, it } from "vitest";
import type { NativeCaptureState, NativeEditorDraftMetadata } from "../data/editorDraftPersistence";
import { exactMountedEditorDraftReceipt } from "./useMountedEditorClosure";

function fixture() {
  const ack: NativeEditorDraftMetadata = {
    ownerId: "a".repeat(64),
    storeInstance: "store",
    windowIncarnation: "window",
    windowLabel: "main",
    documentId: "document",
    path: "/original.txt",
    revision: 3,
    payloadDigest: "b".repeat(64),
    textDigest: "c".repeat(64),
    serializedTextDigest: "d".repeat(64),
    baselineDigest: "e".repeat(64),
    retainedBytes: 42,
    state: "retained",
    saveAckId: null,
    updatedAt: 10,
  };
  const binding: NativeCaptureState = {
    qualified: false,
    documentId: ack.documentId,
    path: ack.path,
    ownerEpoch: ack.ownerId,
    phase: "retained",
    pending: false,
    disposed: false,
    initializationDecisionRequired: false,
    acknowledgedDraft: ack,
    currentDraft: {
      metadata: { ...ack },
      payload: {
        documentId: ack.documentId,
        path: ack.path,
        text: "exact\n",
        eol: "crlf",
        diskBaseline: "disk\r\n",
        revision: ack.revision,
      },
    },
  };
  const input = {
    origin: "local-native",
    documentId: ack.documentId,
    path: ack.path,
    text: "exact\n",
    eol: "crlf",
    diskBaseline: "disk\r\n",
  };
  return { ack, binding, input };
}
describe("mounted editor Native draft ACK lineage", () => {
  it("exposes only the original acknowledged binding for the exact body and baseline", () => {
    const { ack, binding, input } = fixture();
    expect(exactMountedEditorDraftReceipt(binding, input)).toBe(ack);
    expect(
      exactMountedEditorDraftReceipt(binding, { ...input, text: "newer coalesced body\n" }),
    ).toBeNull();
    expect(
      exactMountedEditorDraftReceipt(binding, { ...input, diskBaseline: "changed after save\r\n" }),
    ).toBeNull();
    expect(exactMountedEditorDraftReceipt(binding, { ...input, eol: "lf" })).toBeNull();
  });
  it("does not turn a missing, uncertain, foreign, disposed or recovery-pending binding into body proof", () => {
    const { binding, input } = fixture();
    for (const altered of [
      undefined,
      { ...binding, phase: "unknown" as const },
      { ...binding, pending: true },
      { ...binding, disposed: true },
      { ...binding, ownerEpoch: "foreign" },
      { ...binding, initializationDecisionRequired: true },
      { ...binding, error: new Error("lost ACK") },
    ]) {
      expect(exactMountedEditorDraftReceipt(altered, input)).toBeNull();
    }
    expect(exactMountedEditorDraftReceipt(binding, { ...input, origin: "remote" })).toBeNull();
    expect(exactMountedEditorDraftReceipt(binding, { ...input, origin: "web" })).toBeNull();
    expect(exactMountedEditorDraftReceipt(binding, { ...input, documentId: "other" })).toBeNull();
    expect(exactMountedEditorDraftReceipt(binding, { ...input, path: "/renamed.txt" })).toBeNull();
  });
  it("requires exact serialized separators for the acknowledged body", () => {
    const { binding, input } = fixture();
    const actual = binding.currentDraft!;
    const exact = actual.payload.text.replace(
      /\n/g,
      actual.payload.eol === "crlf" ? "\r\n" : actual.payload.eol === "cr" ? "\r" : "\n",
    );
    expect(
      exactMountedEditorDraftReceipt(binding, { ...input, serializedText: exact }),
    ).not.toBeNull();
    expect(
      exactMountedEditorDraftReceipt(binding, { ...input, serializedText: `${exact}\r` }),
    ).toBeNull();
  });
  it("requires current row metadata to match the ACK as well as its payload", () => {
    const { binding, input } = fixture();
    const current = binding.currentDraft!;
    const altered = {
      ...binding,
      currentDraft: { ...current, metadata: { ...current.metadata, storeInstance: "replacement" } },
    };
    expect(exactMountedEditorDraftReceipt(altered, input)).toBeNull();
    expect(
      exactMountedEditorDraftReceipt(
        {
          ...binding,
          currentDraft: { ...current, payload: { ...current.payload, documentId: "other" } },
        },
        input,
      ),
    ).toBeNull();
  });
});
