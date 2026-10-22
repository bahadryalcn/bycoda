import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { inspectSshCertificate, parseSshCertificateMetadata } from "./sshCertificate";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const metadata = {
  certificateType: "user",
  fingerprint: "SHA256:public123",
  signingCaFingerprint: "SHA256:ca123",
  serial: "18446744073709551615",
  validity: "forever",
  principals: ["alice"],
};
beforeEach(() => vi.mocked(invoke).mockReset());
it("invokes inspection only explicitly with a reference and projects public metadata", async () => {
  expect(invoke).not.toHaveBeenCalled();
  vi.mocked(invoke).mockResolvedValue({
    ...metadata,
    keyId: "private-label",
    comment: "private-comment",
    raw: "blob",
  });
  expect(await inspectSshCertificate("C:/keys/public certificate")).toEqual(metadata);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("ssh_certificate_inspect", {
    reference: "C:/keys/public certificate",
  });
});
it.each(["", "bad\npath", "x".repeat(4097)])(
  "rejects unsupported reference without native work",
  async (reference) => {
    await expect(inspectSshCertificate(reference)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  },
);
it.each([
  { ...metadata, certificateType: "private" },
  { ...metadata, fingerprint: "raw-key" },
  { ...metadata, signingCaFingerprint: "\u001bprivate" },
  { ...metadata, serial: "18446744073709551616" },
  { ...metadata, serial: "-1" },
  { ...metadata, validity: "bad\nvalue" },
  { ...metadata, principals: Array(129).fill("alice") },
  { ...metadata, principals: ["a".repeat(257)] },
  { ...metadata, principals: ["bad\u001bprincipal"] },
])("rejects malformed or unbounded public metadata %j", (value) => {
  expect(() => parseSshCertificateMetadata(value)).toThrow("Invalid public certificate metadata");
});
it("accepts host certificates and no principal restriction without claiming authentication", () => {
  expect(
    parseSshCertificateMetadata({
      ...metadata,
      certificateType: "host",
      principals: [],
      signingCaFingerprint: null,
    }),
  ).toEqual({
    ...metadata,
    certificateType: "host",
    principals: [],
    signingCaFingerprint: undefined,
  });
});
