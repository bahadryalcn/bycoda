import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes as systemRandomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * Pure end-to-end sealing for account-based phone connect. The cloud relays `sealed` but cannot
 * read it. Shared by the desktop and the mobile app; mobile passes `nativeRandomBytes`.
 * Box: X25519 ECDH -> HKDF-SHA256 (info `bycoda-account-pair-v1`) -> AES-256-GCM, 12-byte
 * random nonce prefixed to the ciphertext, all base64url.
 */
export const ACCOUNT_PAIR_INFO = "bycoda-account-pair-v1";
export type PairRandomBytes = (size: number) => Uint8Array | Promise<Uint8Array>;
export type PairKeypair = { privateKey: Uint8Array; publicKey: string };
export type SealedPairTicket = { desktopPublicKey: string; sealed: string };

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const NONCE_BYTES = 12;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1)
    throw new Error("Invalid base64url.");
  const out = new Uint8Array(Math.floor((value.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const char of value) {
    acc = (acc << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 255;
    }
  }
  return out;
}

function publicKeyBytes(publicKey: string): Uint8Array {
  const bytes = base64UrlToBytes(publicKey);
  if (bytes.length !== 32 || bytesToBase64Url(bytes) !== publicKey)
    throw new Error("Invalid public key.");
  return bytes;
}

/** Fresh ephemeral X25519 keypair. Keep `privateKey` in memory only and zero it after use. */
export async function generatePairKeypair(
  randomBytes: PairRandomBytes = systemRandomBytes,
): Promise<PairKeypair> {
  const privateKey = Uint8Array.from(await randomBytes(32));
  return {
    privateKey,
    publicKey: bytesToBase64Url(x25519.getPublicKey(privateKey)),
  };
}

function boxKey(secret: Uint8Array, desktopPublicKey: string, phonePublicKey: string) {
  const salt = concatBytes(publicKeyBytes(desktopPublicKey), publicKeyBytes(phonePublicKey));
  return hkdf(sha256, secret, salt, utf8ToBytes(ACCOUNT_PAIR_INFO), 32);
}

/** Desktop side. `aad` binds the box to the request, for example `requestId|phoneDeviceId|desktopDeviceId|environmentId`. */
export async function sealPairTicket(
  ticketJson: string,
  phonePublicKey: string,
  aad: string,
  randomBytes: PairRandomBytes = systemRandomBytes,
): Promise<SealedPairTicket> {
  const ephemeral = await generatePairKeypair(randomBytes);
  try {
    const secret = x25519.getSharedSecret(ephemeral.privateKey, publicKeyBytes(phonePublicKey));
    const key = boxKey(secret, ephemeral.publicKey, phonePublicKey);
    const nonce = Uint8Array.from(await randomBytes(NONCE_BYTES));
    const box = gcm(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(ticketJson));
    return {
      desktopPublicKey: ephemeral.publicKey,
      sealed: bytesToBase64Url(concatBytes(nonce, box)),
    };
  } finally {
    ephemeral.privateKey.fill(0);
  }
}

/** Phone side. Throws when the key, the AAD or any byte of the box does not match. */
export function openPairTicket(
  ticket: SealedPairTicket,
  phonePrivateKey: Uint8Array,
  aad: string,
): string {
  const phonePublicKey = bytesToBase64Url(x25519.getPublicKey(phonePrivateKey));
  const secret = x25519.getSharedSecret(phonePrivateKey, publicKeyBytes(ticket.desktopPublicKey));
  const key = boxKey(secret, ticket.desktopPublicKey, phonePublicKey);
  const bytes = base64UrlToBytes(ticket.sealed);
  if (bytes.length < NONCE_BYTES + 16) throw new Error("Sealed ticket is too short.");
  const plain = gcm(key, bytes.slice(0, NONCE_BYTES), utf8ToBytes(aad)).decrypt(
    bytes.slice(NONCE_BYTES),
  );
  return new TextDecoder().decode(plain);
}

/** Six-digit code both screens show so the owner can spot a swapped key. */
export function pairSasCode(requestId: string, phonePublicKey: string): string {
  const digest = sha256(
    concatBytes(utf8ToBytes(requestId), new Uint8Array([0]), publicKeyBytes(phonePublicKey)),
  );
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0);
  return String(value % 1_000_000).padStart(6, "0");
}
