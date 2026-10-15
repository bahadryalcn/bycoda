/**
 * The stored form of the app lock password: a salted PBKDF2 hash, never the
 * password. The record carries its own parameters, so raising the cost later
 * keeps older records verifiable.
 */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 256;

const RECORD_VERSION = 1;
const ALGORITHM = "PBKDF2-SHA256";
export const PBKDF2_ITERATIONS = 600_000;
// A record read from storage must not be able to stall the app for minutes.
const MAX_ITERATIONS = 5_000_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordRecord = {
  v: typeof RECORD_VERSION;
  alg: typeof ALGORITHM;
  iterations: number;
  /** Base64 of the random salt. */
  salt: string;
  /** Base64 of the derived key. */
  hash: string;
};

/** Derives `HASH_BYTES` bytes. Injectable so tests can skip the real cost. */
export type Kdf = (password: string, salt: Uint8Array, iterations: number) => Promise<Uint8Array>;

export const webCryptoKdf: Kdf = async (password, salt, iterations) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is not available");
  const key = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
};

export type PasswordProblem = "short" | "long";

export function passwordProblem(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "short";
  if (password.length > PASSWORD_MAX_LENGTH) return "long";
  return null;
}

export async function createPasswordRecord(
  password: string,
  kdf: Kdf = webCryptoKdf,
  random: (bytes: number) => Uint8Array = randomBytes,
): Promise<PasswordRecord> {
  const salt = random(SALT_BYTES);
  const hash = await kdf(password, salt, PBKDF2_ITERATIONS);
  return {
    v: RECORD_VERSION,
    alg: ALGORITHM,
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
}

export async function verifyPassword(
  password: string,
  record: PasswordRecord,
  kdf: Kdf = webCryptoKdf,
): Promise<boolean> {
  const derived = await kdf(password, fromBase64(record.salt), record.iterations);
  return constantTimeEqual(derived, fromBase64(record.hash));
}

/** Compares every byte, so timing does not reveal where two hashes differ. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

/** A record from storage, or `null` when it is missing or malformed. */
export function parsePasswordRecord(value: unknown): PasswordRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PasswordRecord>;
  if (raw.v !== RECORD_VERSION || raw.alg !== ALGORITHM) return null;
  if (
    typeof raw.iterations !== "number" ||
    !Number.isInteger(raw.iterations) ||
    raw.iterations < 1 ||
    raw.iterations > MAX_ITERATIONS
  ) {
    return null;
  }
  if (typeof raw.salt !== "string" || typeof raw.hash !== "string") return null;
  try {
    if (fromBase64(raw.salt).length < 8 || fromBase64(raw.hash).length < 16) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    v: RECORD_VERSION,
    alg: ALGORITHM,
    iterations: raw.iterations,
    salt: raw.salt,
    hash: raw.hash,
  };
}

function randomBytes(count: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
