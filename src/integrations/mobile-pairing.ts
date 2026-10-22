import { isLanAddress, isLanKey } from "./mobile-lan";

/** Shared, credential-free contract for the desktop-to-phone pairing QR. */
export const MOBILE_PAIRING_VERSION = 1 as const;
export const MOBILE_PAIRING_TTL_MS = 120_000;
export const MOBILE_PAIRING_MAX_BYTES = 4_096;

export type MobilePairingCode = {
  kind: "bycoda.mobile-pairing";
  version: typeof MOBILE_PAIRING_VERSION;
  endpoint: string;
  lanKey?: string;
  environmentId: string;
  name: string;
  ticket: string;
  expiresAt: string;
};

export type MobilePairingTicket = Pick<
  MobilePairingCode,
  "ticket" | "expiresAt" | "environmentId"
> & { pairingId: string };
export type MobilePairingStatus = {
  state: "pending" | "paired" | "expired" | "cancelled";
  deviceName?: string;
};
export type MobilePairingRedemption = {
  deviceId: string;
  token: string;
  environmentId: string;
};

export type MobilePairingCodeErrorKind = "invalid" | "expired" | "insecure-endpoint";

export class MobilePairingCodeError extends Error {
  constructor(readonly kind: MobilePairingCodeErrorKind) {
    super(kind);
    this.name = "MobilePairingCodeError";
  }
}

export function mobilePairingEndpoint(value: string, lanKey?: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MobilePairingCodeError("invalid");
  }
  if (
    lanKey !== undefined &&
    (!isLanKey(lanKey) || url.protocol !== "http:" || !isLanAddress(url.hostname))
  )
    throw new MobilePairingCodeError("insecure-endpoint");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLanAddress(url.hostname) && isLanKey(lanKey))
  )
    throw new MobilePairingCodeError("insecure-endpoint");
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new MobilePairingCodeError("invalid");
  }
  return url.origin;
}

export function parseMobilePairingCode(value: string, now = Date.now()): MobilePairingCode {
  if (value.length > MOBILE_PAIRING_MAX_BYTES) throw new MobilePairingCodeError("invalid");
  let decoded: unknown;
  try {
    decoded = JSON.parse(value.trim());
  } catch {
    throw new MobilePairingCodeError("invalid");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new MobilePairingCodeError("invalid");
  }
  const input = decoded as Record<string, unknown>;
  const { kind, version, endpoint, environmentId, name, ticket, expiresAt } = input;
  if (
    kind !== "bycoda.mobile-pairing" ||
    version !== MOBILE_PAIRING_VERSION ||
    typeof endpoint !== "string" ||
    endpoint.length > 1_024 ||
    typeof environmentId !== "string" ||
    !environmentId.trim() ||
    environmentId.length > 200 ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 120 ||
    typeof ticket !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
    typeof expiresAt !== "string"
  ) {
    throw new MobilePairingCodeError("invalid");
  }
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry > now + MOBILE_PAIRING_TTL_MS + 30_000) {
    throw new MobilePairingCodeError("invalid");
  }
  if (expiry <= now) throw new MobilePairingCodeError("expired");
  return {
    kind,
    version,
    endpoint: mobilePairingEndpoint(endpoint, input.lanKey as string | undefined),
    ...(input.lanKey !== undefined ? { lanKey: input.lanKey as string } : {}),
    environmentId,
    name: name.trim(),
    ticket,
    expiresAt,
  };
}

export function formatMobilePairingCode(code: MobilePairingCode): string {
  return JSON.stringify(parseMobilePairingCode(JSON.stringify(code)));
}
