import "reflect-metadata";
import { createHash, createPrivateKey, randomBytes, webcrypto, X509Certificate } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { isIP } from "node:net";
import type { MobileTlsBootstrap } from "../../src/shared/model/host-contracts";
export type { MobileTlsBootstrap } from "../../src/shared/model/host-contracts";
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from "@peculiar/x509";

const crypto = webcrypto as unknown as Crypto;
const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const DAY = 86_400_000;
type SavedAuthority = {
  version: 1;
  environmentId: string;
  caGeneration: number;
  caCertificatePem: string;
  caPrivateKeyPem: string;
};
export type MobileTlsMaterial = {
  caCertificatePem: string;
  caSpkiPin: string;
  caGeneration: number;
  certificatePem: string;
  privateKeyPem: string;
  expiresAt: number;
};

/** Hash DER SubjectPublicKeyInfo, never the platform's raw EC point or the leaf certificate. */
export function mobileCaSpkiPin(certificatePem: string): string {
  const key = new X509Certificate(certificatePem).publicKey.export({ type: "spki", format: "der" });
  return `sha256/${createHash("sha256").update(key).digest("base64")}`;
}
const pem = (kind: string, bytes: ArrayBuffer) =>
  `-----BEGIN ${kind}-----\n${Buffer.from(bytes)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END ${kind}-----\n`;

/** Stable per-environment CA. Corrupt/expired trust material never silently regenerates. */
export class MobileTlsAuthority {
  private loading?: Promise<SavedAuthority>;
  private readonly leaves = new Map<string, MobileTlsMaterial>();
  private readonly issuing = new Map<string, Promise<MobileTlsMaterial>>();
  constructor(
    private readonly file: string,
    readonly environmentId: string,
    private readonly now = Date.now,
  ) {
    if (!environmentId || environmentId.length > 200)
      throw new Error("Invalid TLS environment identity.");
  }

  private async validate(value: unknown): Promise<SavedAuthority> {
    if (!value || typeof value !== "object")
      throw new Error("Saved mobile TLS authority is invalid.");
    const saved = value as SavedAuthority;
    if (
      saved.version !== 1 ||
      saved.environmentId !== this.environmentId ||
      !Number.isSafeInteger(saved.caGeneration) ||
      saved.caGeneration < 1 ||
      typeof saved.caCertificatePem !== "string" ||
      saved.caCertificatePem.length > 8192 ||
      typeof saved.caPrivateKeyPem !== "string" ||
      saved.caPrivateKeyPem.length > 8192
    )
      throw new Error("Saved mobile TLS identity changed; explicit trust recovery is required.");
    const certificate = new X509Certificate(saved.caCertificatePem);
    const privateKey = createPrivateKey(saved.caPrivateKeyPem);
    if (
      !certificate.ca ||
      !certificate.verify(certificate.publicKey) ||
      !certificate.checkPrivateKey(privateKey) ||
      certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      Date.parse(certificate.validFrom) > this.now() ||
      Date.parse(certificate.validTo) <= this.now() + DAY
    )
      throw new Error("Saved mobile TLS authority requires explicit trust recovery.");
    return saved;
  }

  private load(): Promise<SavedAuthority> {
    return (this.loading ??= (async () => {
      try {
        const text = await readFile(this.file, "utf8");
        if (Buffer.byteLength(text) > 32_768)
          throw new Error("Saved mobile TLS authority exceeds its limit.");
        return await this.validate(JSON.parse(text));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
      const name = `CN=bycoda mobile CA ${createHash("sha256").update(this.environmentId).digest("hex").slice(0, 16)}`;
      const certificate = await X509CertificateGenerator.createSelfSigned(
        {
          serialNumber: `01${randomBytes(15).toString("hex")}`,
          name,
          keys,
          signingAlgorithm: algorithm,
          notBefore: new Date(this.now() - 300_000),
          notAfter: new Date(this.now() + 1825 * DAY),
          extensions: [
            new BasicConstraintsExtension(true, 0, true),
            new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
          ],
        },
        crypto,
      );
      const saved: SavedAuthority = {
        version: 1,
        environmentId: this.environmentId,
        caGeneration: 1,
        caCertificatePem: `${certificate.toString("pem").trimEnd()}\n`,
        caPrivateKeyPem: pem(
          "PRIVATE KEY",
          await crypto.subtle.exportKey("pkcs8", keys.privateKey),
        ),
      };
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomBytes(16).toString("hex")}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(saved));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        // An exclusive hard link publishes a complete file without replacing another creator's CA.
        await link(temporary, this.file);
        if (process.platform !== "win32") {
          const directory = await open(dirname(this.file), "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(this.file, "utf8");
        return await this.validate(JSON.parse(existing));
      } finally {
        await unlink(temporary);
      }
      return saved;
    })());
  }

  issue(rawNames: readonly string[]): Promise<MobileTlsMaterial> {
    const names = [...new Set(rawNames)].sort();
    if (
      !names.length ||
      names.length > 16 ||
      names.some(
        (name) =>
          !isIP(name) &&
          (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(name) || name.includes("..")),
      )
    )
      return Promise.reject(new Error("Invalid mobile TLS hostname selection."));
    const key = JSON.stringify(names);
    const cached = this.leaves.get(key);
    if (cached && cached.expiresAt > this.now() + DAY) return Promise.resolve(cached);
    const pending = this.issuing.get(key);
    if (pending) return pending;
    if (this.issuing.size >= 4)
      return Promise.reject(new Error("Mobile TLS issuance capacity is busy."));
    const operation = (async () => {
      const saved = await this.load();
      const ca = new X509Certificate(saved.caCertificatePem);
      if (Date.parse(ca.validTo) <= this.now() + DAY)
        throw new Error("Saved mobile TLS authority requires explicit trust recovery.");
      const caDer = createPrivateKey(saved.caPrivateKeyPem).export({
        type: "pkcs8",
        format: "der",
      });
      const signingKey = await crypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(caDer),
        algorithm,
        false,
        ["sign"],
      );
      const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
      const expiresAt = Math.min(this.now() + 30 * DAY, Date.parse(ca.validTo) - DAY);
      const certificate = await X509CertificateGenerator.create(
        {
          serialNumber: `01${randomBytes(15).toString("hex")}`,
          subject: "CN=bycoda execution Host",
          issuer: ca.subject,
          publicKey: keys.publicKey,
          signingKey,
          signingAlgorithm: algorithm,
          notBefore: new Date(this.now() - 300_000),
          notAfter: new Date(expiresAt),
          extensions: [
            new BasicConstraintsExtension(false, undefined, true),
            new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
            new ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"]),
            new SubjectAlternativeNameExtension(
              names.map((value) => ({
                type: isIP(value) ? ("ip" as const) : ("dns" as const),
                value,
              })),
            ),
          ],
        },
        crypto,
      );
      const material: MobileTlsMaterial = {
        caCertificatePem: saved.caCertificatePem,
        caSpkiPin: mobileCaSpkiPin(saved.caCertificatePem),
        caGeneration: saved.caGeneration,
        certificatePem: `${certificate.toString("pem").trimEnd()}\n`,
        privateKeyPem: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
        expiresAt,
      };
      if (this.leaves.size >= 4) this.leaves.delete(this.leaves.keys().next().value!);
      this.leaves.set(key, material);
      return material;
    })();
    this.issuing.set(key, operation);
    void operation.then(
      () => this.issuing.delete(key),
      () => this.issuing.delete(key),
    );
    return operation;
  }

  async bootstrap(host: string, port: number): Promise<MobileTlsBootstrap> {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid mobile TLS port.");
    const material = await this.issue([host]);
    const authority = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
    return {
      version: 1,
      environmentId: this.environmentId,
      caGeneration: material.caGeneration,
      caCertificatePem: material.caCertificatePem,
      caSpkiPin: material.caSpkiPin,
      endpoint: `wss://${authority}/ws`,
      bulkBaseUrl: `https://${authority}/ws-bulk/`,
    };
  }
}
