import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { facebookEncoderUrl } from "../../../src/integrations/social/adapters/facebook-live";
import type { SocialServiceApi } from "../core/social-service-api";
import type { SocialCredentialStore } from "../social-credentials";

export type FacebookLivePhase =
  | "creating"
  | "unpublished"
  | "starting"
  | "live"
  | "ending"
  | "ended";

/** One durable current broadcast per account. The provider secret never goes in this receipt. */
export type FacebookLiveReceipt = {
  accountId: string;
  pageId: string;
  id?: string;
  title: string;
  phase: FacebookLivePhase;
  createdAt: number;
  encoderReady: boolean;
};

type Settings = Pick<SocialServiceApi, "setting" | "setSetting">;
const key = (accountId: string) => `facebook.live.receipt:${accountId}`;
export const liveSecretKey = (accountId: string, liveId: string) =>
  `facebook.live.encoder:${accountId}:${liveId}`;
const phases: ReadonlySet<unknown> = new Set([
  "creating",
  "unpublished",
  "starting",
  "live",
  "ending",
  "ended",
]);

export async function readLiveReceipt(service: Settings, accountId: string, pageId: string) {
  const raw = await service.setting(key(accountId));
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as FacebookLiveReceipt | null;
    if (value === null) return undefined;
    if (
      value.accountId !== accountId ||
      typeof value.pageId !== "string" ||
      typeof value.title !== "string" ||
      !phases.has(value.phase) ||
      !Number.isFinite(value.createdAt) ||
      typeof value.encoderReady !== "boolean" ||
      (value.phase === "creating"
        ? value.id !== undefined
        : typeof value.id !== "string" || !/^[1-9]\d{0,29}$/.test(value.id))
    )
      throw new Error();
    if (value.pageId !== pageId) throw new SocialPlatformError("denied");
    return value;
  } catch (error) {
    if (error instanceof SocialPlatformError) throw error;
    throw new Error(
      "Facebook Live receipt is unavailable. Review the broadcast in Meta before continuing.",
    );
  }
}

export async function writeLiveReceipt(
  service: Settings,
  accountId: string,
  receipt?: FacebookLiveReceipt,
) {
  await service.setSetting(key(accountId), JSON.stringify(receipt ?? null));
}

export async function readLiveEncoder(
  service: Settings,
  credentials: SocialCredentialStore,
  accountId: string,
  pageId: string,
  liveId: string,
) {
  const receipt = await readLiveReceipt(service, accountId, pageId);
  if (
    receipt?.id !== liveId ||
    !receipt.encoderReady ||
    !["unpublished", "starting", "live"].includes(receipt.phase)
  )
    throw new SocialPlatformError("denied");
  const credential = await credentials.get(liveSecretKey(accountId, liveId));
  const safe = facebookEncoderUrl(credential?.accessToken);
  if (!safe) throw new SocialPlatformError("expired");
  const url = new URL(safe);
  const separator = url.pathname.lastIndexOf("/");
  return {
    server: `${url.protocol}//${url.host}${url.pathname.slice(0, separator)}/`,
    streamKey: url.pathname.slice(separator + 1) + url.search,
  };
}
