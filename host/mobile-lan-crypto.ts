import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
} from "node:crypto";
import {
  lanContext,
  readLanEnvelope,
  type MobileLanEnvelope,
} from "../src/integrations/mobile-lan";

export function createLanIdentity(encoded?: string) {
  const privateKey = encoded
    ? createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" })
    : generateKeyPairSync("x25519").privateKey;
  if (privateKey.asymmetricKeyType !== "x25519") throw new Error("Invalid mobile LAN identity.");
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");
  return {
    privateKey,
    publicKey,
    encoded: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

/** Each fresh ephemeral exchange derives separate request/response AES keys. */
export function openLanRequest(
  value: unknown,
  identity: { privateKey: KeyObject; publicKey: string },
  environmentId: string,
) {
  const envelope = readLanEnvelope(value);
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b656e032100", "hex"),
      Buffer.from(envelope.publicKey, "hex"),
    ]),
    format: "der",
    type: "spki",
  });
  const secret = diffieHellman({ privateKey: identity.privateKey, publicKey });
  const context = (direction: "request" | "response") =>
    Buffer.from(
      lanContext(environmentId, identity.publicKey, envelope.publicKey, envelope.id, direction),
    );
  const key = (direction: "request" | "response") =>
    Buffer.from(
      hkdfSync("sha256", secret, Buffer.from(envelope.id, "hex"), context(direction), 32),
    );
  const bytes = Buffer.from(envelope.data, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key("request"), Buffer.alloc(12));
  decipher.setAAD(context("request"));
  decipher.setAuthTag(bytes.subarray(-16));
  const input = JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString("utf8"),
  );
  return {
    envelope,
    input,
    seal(result: unknown): MobileLanEnvelope {
      const cipher = createCipheriv("aes-256-gcm", key("response"), Buffer.alloc(12));
      cipher.setAAD(context("response"));
      const data = Buffer.concat([
        cipher.update(JSON.stringify(result), "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("hex");
      secret.fill(0);
      return { ...envelope, data };
    },
  };
}
