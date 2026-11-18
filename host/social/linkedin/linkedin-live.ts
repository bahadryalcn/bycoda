import {
  LINKEDIN_LIVE_CONFIRM,
  LINKEDIN_LIVE_EVENT_ID,
  LINKEDIN_LIVE_STUDIO,
  type LinkedInLiveStatus,
} from "../../../src/integrations/social/live-linkedin";
import type { SocialAccount } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SecretValueStore } from "../../secrets/secret-store";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, finite, hash, str } from "../core/social-helpers";

type Destination = {
  version: 1;
  binding: string;
  eventId: string;
  storedAt: number;
  streamUrl: string;
  streamKey: string;
};

/** Account-bound vault ref. The URL can itself contain signed credentials. */
const vaultRef = (accountId: string) => `social.linkedin.live.${hash(accountId)}`;
const eventIdPattern = LINKEDIN_LIVE_EVENT_ID;

function vault(ctx: SocialActionContext): SecretValueStore {
  if (!ctx.emailSecrets) throw new Error("LinkedIn Live credential store unavailable.");
  return ctx.emailSecrets;
}

async function accountFor(ctx: SocialActionContext, accountId: string) {
  const account = await ctx.service.access(ctx.principal, accountId, "read");
  if (account.platform !== "linkedin" || !["member", "organization"].includes(account.accountType))
    throw new SocialPlatformError("unsupported");
  return account;
}

async function connectionBinding(ctx: SocialActionContext, account: SocialAccount) {
  if (!account.connected || !account.platformId) return undefined;
  const epoch = await ctx.service.setting(`connectionEpoch:${account.id}`);
  return hash(JSON.stringify([account.connection, account.accountType, account.platformId, epoch]));
}

function parseDestination(raw: string): Destination {
  try {
    const item = JSON.parse(raw) as Destination;
    if (
      item.version === 1 &&
      typeof item.binding === "string" &&
      typeof item.eventId === "string" &&
      eventIdPattern.test(item.eventId) &&
      Number.isSafeInteger(item.storedAt) &&
      typeof item.streamUrl === "string" &&
      typeof item.streamKey === "string"
    )
      return item;
  } catch {
    // JSON parser errors may include fragments of the stored secret.
  }
  throw new Error("LinkedIn Live credentials could not be read.");
}

/** Accept the documented LinkedIn API and Live Studio ingest host families. */
function parseStreamUrl(raw: unknown) {
  const value = str(raw, "LinkedIn stream URL", 4096);
  const url = URL.parse(value);
  if (
    !url ||
    !["rtmps:", "rtmp:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    /[\s\\]/u.test(value) ||
    !(
      url.hostname === "live-ingest.linkedin.com" ||
      /^[a-z0-9-]+\.live-input-li\.bitcod\.in$/i.test(url.hostname) ||
      /^[a-z0-9-]+\.channel\.media\.azure\.net$/i.test(url.hostname)
    ) ||
    (url.port &&
      !(url.protocol === "rtmps:" ? ["443", "2935", "2936"] : ["1935", "1936"]).includes(url.port))
  )
    throw new Error("Enter the RTMP or RTMPS URL from LinkedIn Live Studio.");
  return value;
}

const result = (state: "missing" | "reconnect"): LinkedInLiveStatus => ({
  state,
  studioUrl: LINKEDIN_LIVE_STUDIO,
});

function stored(destination: Destination): LinkedInLiveStatus {
  return {
    state: "stored",
    studioUrl: LINKEDIN_LIVE_STUDIO,
    eventId: destination.eventId,
    storedAt: destination.storedAt,
  };
}

async function status(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["accountId"]);
  const accountId = str(input.accountId, "account");
  const account = await accountFor(ctx, accountId);
  const binding = await connectionBinding(ctx, account);
  if (!binding) return result("reconnect");
  const raw = await vault(ctx)
    .get(vaultRef(accountId))
    .catch(() => {
      throw new Error("LinkedIn Live credentials could not be read.");
    });
  const current = await accountFor(ctx, accountId);
  if ((await connectionBinding(ctx, current)) !== binding) return result("reconnect");
  if (!raw) return result("missing");
  const destination = parseDestination(raw);
  return destination.binding === binding ? stored(destination) : result("missing");
}

async function save(ctx: SocialActionContext, input: Record<string, unknown>) {
  ctx.service.owner(ctx.principal);
  exact(input, ["accountId", "eventId", "streamUrl", "streamKey", "confirm"]);
  if (input.confirm !== LINKEDIN_LIVE_CONFIRM)
    throw new Error("Confirm saving the LinkedIn Live destination.");
  const accountId = str(input.accountId, "account");
  const account = await accountFor(ctx, accountId);
  const binding = await connectionBinding(ctx, account);
  if (!binding) throw new SocialPlatformError("expired");
  const eventId = str(input.eventId, "LinkedIn event ID", 25);
  if (!eventIdPattern.test(eventId)) throw new Error("Enter a numeric LinkedIn event ID.");
  const destination: Destination = {
    version: 1,
    binding,
    eventId,
    storedAt: ctx.now(),
    streamUrl: parseStreamUrl(input.streamUrl),
    streamKey: str(input.streamKey, "LinkedIn stream key", 4096),
  };
  if (!/^[\x21-\x7e]+$/.test(destination.streamKey))
    throw new Error("Enter the stream key from LinkedIn Live Studio.");
  await vault(ctx)
    .set(vaultRef(accountId), JSON.stringify(destination))
    .catch(() => {
      throw new Error("LinkedIn Live credentials could not be saved.");
    });
  const current = await accountFor(ctx, accountId);
  return (await connectionBinding(ctx, current)) === binding
    ? stored(destination)
    : result("reconnect");
}

async function clear(ctx: SocialActionContext, input: Record<string, unknown>) {
  ctx.service.owner(ctx.principal);
  exact(input, ["accountId"]);
  const accountId = str(input.accountId, "account");
  await accountFor(ctx, accountId);
  await vault(ctx)
    .delete(vaultRef(accountId))
    .catch(() => {
      throw new Error("LinkedIn Live credentials could not be cleared.");
    });
  return { cleared: true };
}

async function comments(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["accountId", "eventId", "offset"]);
  const accountId = str(input.accountId, "account");
  const eventId = str(input.eventId, "LinkedIn Live event ID", 25);
  const offset = finite(input.offset ?? 0, "comment offset", 0, 100_000);
  if (!eventIdPattern.test(eventId) || !Number.isInteger(offset))
    throw new SocialPlatformError("rejected");
  const account = await accountFor(ctx, accountId);
  if (account.connection !== "oauth" || account.accountType !== "organization")
    throw new SocialPlatformError("unsupported");
  const binding = await connectionBinding(ctx, account);
  if (!binding) throw new SocialPlatformError("expired");
  const adapter = ctx.service.adapterFor(account);
  if (!adapter.linkedinLiveComments) throw new SocialPlatformError("unsupported");
  const credential = await ctx.service.credentialFor(accountId);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  const verify = async () => {
    const current = await accountFor(ctx, accountId);
    if ((await connectionBinding(ctx, current)) !== binding)
      throw new SocialPlatformError("denied");
    return current;
  };
  const current = await verify();
  const result = await adapter.linkedinLiveComments(
    current,
    credential.accessToken,
    eventId,
    offset,
  );
  await verify();
  return result;
}

export const linkedinLiveActions: SocialActionModule = {
  "linkedin.live.comments.read": { readOnly: true, ownerOnly: true, run: comments },
  "linkedin.live.status": { readOnly: true, ownerOnly: false, tool: true, run: status },
  "linkedin.live.credentials.save": { readOnly: false, ownerOnly: true, run: save },
  "linkedin.live.credentials.clear": { readOnly: false, ownerOnly: true, run: clear },
};
