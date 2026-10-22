import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { HostStore } from "./store";

export type DesktopReviewScope = {
  environmentId: string; projectId: string; sessionId: string;
  feature?: "worktree-removal" | "ssh-workspace" | "pty-mobile" | "provider-management";
};
export type DesktopResourceRole = "workspace" | "terminal" | "epoch" | "lease";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const invalid = () => new Error("The reviewed operation does not belong to this device or has expired.");
export function desktopReviewSecret(store: Pick<HostStore, "db">): string {
  store.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('desktopReviewSecret.v1', ?)").run(randomBytes(32).toString("base64url"));
  const value = store.db.prepare("SELECT value FROM metadata WHERE key='desktopReviewSecret.v1'").get()?.value;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Desktop review authorization unavailable.");
  return value;
}
const signature = (secret: string, token: string, scope: DesktopReviewScope, parts: readonly unknown[]) =>
  createHmac("sha256", secret).update(JSON.stringify([`bycoda:${scope.feature ?? "worktree-removal"}:v1`, createHash("sha256").update(token).digest("hex"), scope.environmentId, scope.projectId, scope.sessionId, ...parts])).digest("base64url");

/** Trusted registry partition. Never accept this value from an RPC caller. */
export function desktopActorId(secret: string, token: string, scope: DesktopReviewScope): string {
  return signature(secret, token, scope, ["actor"]);
}

/** Handles identify resources; the canonical owner still checks lifecycle and access. */
export function sealDesktopResource(secret: string, token: string, scope: DesktopReviewScope, role: DesktopResourceRole, id: unknown): string {
  if (typeof id !== "string" || !uuid.test(id)) throw invalid();
  return `h1.${id}.${signature(secret, token, scope, ["resource", role, id])}`;
}

export function openDesktopResource(secret: string, token: string, scope: DesktopReviewScope, role: DesktopResourceRole, value: unknown): string {
  if (typeof value !== "string" || value.length > 200) throw invalid();
  const [version, id, mac, ...extra] = value.split(".");
  if (extra.length || version !== "h1" || !uuid.test(id ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(mac ?? "")) throw invalid();
  const expected = Buffer.from(signature(secret, token, scope, ["resource", role, id]));
  const supplied = Buffer.from(mac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw invalid();
  return id;
}

export function sealDesktopReview(secret: string, token: string, scope: DesktopReviewScope, id: unknown, expiresAt: unknown, now = Date.now()): string {
  if (typeof id !== "string" || !uuid.test(id) || !Number.isSafeInteger(expiresAt) || Number(expiresAt) <= now || Number(expiresAt) > now + 120_000) throw invalid();
  return `v1.${id}.${expiresAt}.${signature(secret, token, scope, ["review", id, expiresAt])}`;
}

export function openDesktopReview(secret: string, token: string, scope: DesktopReviewScope, value: unknown, now = Date.now()): string {
  if (typeof value !== "string" || value.length > 200) throw invalid();
  const [version, id, expiry, mac, ...extra] = value.split(".");
  const expiresAt = Number(expiry);
  if (extra.length || version !== "v1" || !uuid.test(id ?? "") || !/^\d{13}$/.test(expiry ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(mac ?? "") || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120_000) throw invalid();
  const expected = Buffer.from(signature(secret, token, scope, ["review", id, expiresAt]));
  const supplied = Buffer.from(mac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw invalid();
  return id;
}

/** Stable after a host restart, distinct for every paired credential and source scope. */
export function desktopOperationId(secret: string, token: string, scope: DesktopReviewScope, id: unknown): string {
  if (typeof id !== "string" || !id || id.length > 200 || /[\0\r\n]/.test(id)) throw invalid();
  return signature(secret, token, scope, ["operation", id]);
}
