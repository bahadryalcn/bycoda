import { invoke } from "@tauri-apps/api/core";

/** Public metadata only. A certificate's inspection is not trust, enrollment or
 * proof that a remote account accepts it. Never persist a raw certificate blob.
 */
export type SshCertificateMetadata = {
  certificateType: "user" | "host";
  fingerprint: string;
  signingCaFingerprint?: string;
  serial: string;
  validity: string;
  principals: string[];
};
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const fingerprint = (value: unknown): value is string =>
  typeof value === "string" && /^SHA256:[A-Za-z0-9+/=]{1,93}$/.test(value);

export function parseSshCertificateMetadata(value: unknown): SshCertificateMetadata {
  if (!value || typeof value !== "object") throw new Error("Invalid public certificate metadata");
  const raw = value as Record<string, unknown>;
  if (
    (raw.certificateType !== "user" && raw.certificateType !== "host") ||
    !fingerprint(raw.fingerprint) ||
    (raw.signingCaFingerprint != null && !fingerprint(raw.signingCaFingerprint)) ||
    !boundedText(raw.serial, 20) ||
    !/^\d+$/.test(raw.serial) ||
    BigInt(raw.serial) > 18_446_744_073_709_551_615n ||
    !boundedText(raw.validity, 160) ||
    !Array.isArray(raw.principals) ||
    raw.principals.length > 128 ||
    !raw.principals.every((principal) => boundedText(principal, 256))
  )
    throw new Error("Invalid public certificate metadata");
  return {
    certificateType: raw.certificateType,
    fingerprint: raw.fingerprint,
    ...(raw.signingCaFingerprint == null ? {} : { signingCaFingerprint: raw.signingCaFingerprint }),
    serial: raw.serial,
    validity: raw.validity,
    principals: [...raw.principals] as string[],
  };
}

/** Explicit user action only; importing the model does not read files or invoke native. */
export async function inspectSshCertificate(reference: string): Promise<SshCertificateMetadata> {
  if (!boundedText(reference, 4096)) throw new Error("Invalid public certificate reference");
  return parseSshCertificateMetadata(await invoke("ssh_certificate_inspect", { reference }));
}
