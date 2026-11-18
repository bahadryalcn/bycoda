import { createHash } from "node:crypto";
import type { SocialAccount, SocialOperation } from "../../../src/features/social/model/social";
import { SocialHttp, SocialPlatformError } from "../../../src/integrations/social/adapter";
import { xGet } from "../../../src/integrations/social/adapters/x";
import {
  runXEngagement,
  type XEngagementAction,
} from "../../../src/integrations/social/adapters/x-engagement";
import { xReadInsights } from "../../../src/integrations/social/adapters/x-insights";
import {
  getXListMembers,
  getXOwnedLists,
  runXRelationship,
  type XRelationshipAction,
} from "../../../src/integrations/social/adapters/x-relationships";
import { xListOwnSpaces } from "../../../src/integrations/social/adapters/x-spaces";
import { xResourceId } from "../../../src/integrations/social/adapters/x-identifiers";
import { xHandoff } from "../../../src/integrations/social/x-handoff";
import { isoTimestamp } from "../../../src/shared/lib/time/timestamps";
import type { SocialActionContext, SocialActionModule } from "./social-actions";
import type { SocialServiceApi } from "./social-service-api";

type XWrite = XEngagementAction | XRelationshipAction | { kind: "deletePost"; postId: string };

function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Choose whether to enable the X action.");
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Enter text for the X action.");
  return value.trim();
}

function parseWrite(input: Record<string, unknown>): XWrite {
  switch (input.kind) {
    case "like":
    case "repost":
    case "bookmark":
    case "hideReply":
      return { kind: input.kind, postId: xResourceId(input.postId), enabled: flag(input.enabled) };
    case "deletePost":
      return { kind: input.kind, postId: xResourceId(input.postId) };
    case "follow":
    case "mute":
    case "block":
      return { kind: input.kind, userId: xResourceId(input.userId), enabled: flag(input.enabled) };
    case "addListMember":
    case "removeListMember":
      return {
        kind: input.kind,
        listId: xResourceId(input.listId),
        userId: xResourceId(input.userId),
      };
    case "createList":
    case "updateList": {
      const name = optionalText(input.name);
      const description = optionalText(input.description);
      const isPrivate = input.private === undefined ? undefined : flag(input.private);
      if (input.kind === "createList") {
        if (!name) throw new Error("Enter a name for the X list.");
        return { kind: input.kind, name, description, private: isPrivate };
      }
      return {
        kind: input.kind,
        listId: xResourceId(input.listId),
        name,
        description,
        private: isPrivate,
      };
    }
    case "deleteList":
      return { kind: input.kind, listId: xResourceId(input.listId) };
    default:
      throw new Error("Choose an X action.");
  }
}

async function xAccount(ctx: SocialActionContext, id: unknown): Promise<SocialAccount> {
  if (typeof id !== "string" || !id) throw new Error("Choose an X account.");
  const account = await ctx.service.access(ctx.principal, id, "read");
  if (account.platform !== "x") throw new Error("Choose an X account.");
  return account;
}

function assertPaid(account: SocialAccount) {
  if (account.connection === "browser" || !account.xApiProduct)
    throw new Error("The owner must enable a paid X API product.");
  if (!account.connected || !account.accessApproved || account.paused)
    throw new Error("Connect and enable this X API account first.");
}

async function paidRead(
  ctx: SocialActionContext,
  id: unknown,
  operation: SocialOperation,
  product?: SocialAccount["xApiProduct"],
) {
  const account = await xAccount(ctx, id);
  assertPaid(account);
  if (product && account.xApiProduct !== product)
    throw new Error("X historical post analytics requires Enterprise.");
  ctx.service.capability(account, operation);
  const token = await xToken(ctx, account.id);
  const current = await xAccount(ctx, account.id);
  assertPaid(current);
  ctx.service.capability(current, operation);
  if (current.platformId !== account.platformId || current.xApiProduct !== account.xApiProduct)
    throw new Error("The X account changed. Request the readout again.");
  return { account: current, token };
}

async function xToken(ctx: SocialActionContext, id: string) {
  const credential = await ctx.service.credentialFor(id);
  if (!credential || (credential.expiresAt !== undefined && credential.expiresAt <= ctx.now()))
    throw new SocialPlatformError("expired");
  return credential.accessToken;
}

const activeWrites = new WeakMap<SocialServiceApi, Set<string>>();

async function applyXWrite(
  http: SocialHttp,
  ctx: SocialActionContext,
  input: Record<string, unknown>,
) {
  ctx.service.owner(ctx.principal);
  const account = await xAccount(ctx, input.accountId);
  assertPaid(account);
  const action = parseWrite(input);
  if (input.confirm !== "APPLY_X_ACTION")
    throw new Error("Confirm the exact X action before sending.");
  if (typeof input.intentId !== "string" || !/^[a-f0-9-]{36}$/.test(input.intentId))
    throw new Error("An X action confirmation ID is required.");
  const inFlight = activeWrites.get(ctx.service) ?? new Set<string>();
  activeWrites.set(ctx.service, inFlight);
  if (inFlight.has(account.id)) throw new Error("Another X action is in progress.");
  inFlight.add(account.id);
  try {
    const signature = createHash("sha256").update(JSON.stringify(action)).digest("hex");
    const key = `x.write:${account.id}:${input.intentId}`;
    const receipt = await ctx.service.setting(key);
    if (receipt) {
      if (receipt === `review:${signature}`) return { status: "review" };
      const applied = `applied:${signature}:`;
      if (receipt.startsWith(applied))
        return { status: "applied", result: JSON.parse(receipt.slice(applied.length)) };
      throw new Error("This confirmation was used for another X action.");
    }
    if ("userId" in action)
      await ctx.service.assertSendable({ platform: "x", platformId: action.userId }, "comment");
    const token = await xToken(ctx, account.id);
    const platformId = await xWriteTarget(http, ctx, account, token, action);
    if (platformId) await ctx.service.assertSendable({ platform: "x", platformId }, "comment");
    await assertXWriteCurrent(ctx, account, token);
    const paceKey = `x.write.last:${account.id}`;
    if (ctx.now() - Number((await ctx.service.setting(paceKey)) ?? "-Infinity") < 10_000)
      throw new Error("Wait ten seconds between X actions on this account.");
    await ctx.service.setSetting(paceKey, String(ctx.now()));
    await ctx.service.setSetting(key, `review:${signature}`);
    await assertXWriteCurrent(ctx, account, token);
    if (platformId) await ctx.service.assertSendable({ platform: "x", platformId }, "comment");
    try {
      const result = await submitXWrite(http, ctx, account, token, action);
      await ctx.service.setSetting(key, `applied:${signature}:${JSON.stringify(result)}`);
      return { status: "applied", result };
    } catch (error) {
      if (error instanceof SocialPlatformError && error.code !== "unknown") throw error;
      return { status: "review" };
    }
  } finally {
    inFlight.delete(account.id);
  }
}

async function assertXWriteCurrent(
  ctx: SocialActionContext,
  account: SocialAccount,
  token: string,
) {
  const latestToken = await xToken(ctx, account.id);
  const latest = await xAccount(ctx, account.id);
  assertPaid(latest);
  if (
    latest.xApiProduct !== account.xApiProduct ||
    latest.platformId !== account.platformId ||
    latestToken !== token
  )
    throw new Error("Review the X action again. The account changed.");
  if (
    (await ctx.service.setting("sending")) !== "true" ||
    (await ctx.service.setting("stopped")) === "true"
  )
    throw new Error("Social sending is stopped.");
}

async function xWriteTarget(
  http: SocialHttp,
  ctx: SocialActionContext,
  account: SocialAccount,
  token: string,
  action: XWrite,
) {
  if (action.kind === "block" && account.xApiProduct !== "enterprise")
    throw new Error("Blocking through the X API requires Enterprise.");
  if (action.kind === "deletePost") {
    ctx.service.capability(account, "delete");
    return undefined;
  }
  if ("postId" in action) {
    const scope = {
      like: "like.write",
      repost: "tweet.write",
      bookmark: "bookmark.write",
      hideReply: "tweet.moderate.write",
    }[action.kind];
    if (!account.scopes.includes(scope))
      throw new Error("Reconnect X with the required permission.");
    const { value } = await xGet(
      http,
      account,
      `https://api.x.com/2/tweets/${action.postId}?tweet.fields=author_id`,
      token,
    );
    if (value.data?.id !== action.postId) throw new SocialPlatformError("rejected");
    return xResourceId(value.data?.author_id);
  }
  const scope =
    action.kind === "follow"
      ? "follows.write"
      : action.kind === "mute"
        ? "mute.write"
        : action.kind === "block"
          ? "block.write"
          : "list.write";
  if (!account.scopes.includes(scope)) throw new Error("Reconnect X with the required permission.");
  return "userId" in action ? action.userId : undefined;
}

async function submitXWrite(
  http: SocialHttp,
  ctx: SocialActionContext,
  account: SocialAccount,
  token: string,
  action: XWrite,
) {
  if (action.kind === "deletePost") {
    const remove = ctx.service.adapterFor(account).deletePost;
    if (!remove) throw new SocialPlatformError("unsupported");
    await remove(account, token, action.postId);
    return { postId: action.postId };
  }
  return "postId" in action
    ? await runXEngagement(http, account, token, action)
    : await runXRelationship(http, account, token, action);
}

export function createXActions(http = new SocialHttp()): SocialActionModule {
  return {
    "x.handoff": {
      ownerOnly: false,
      readOnly: true,
      tool: true,
      run: async (ctx, input) => {
        const account =
          input.accountId === undefined ? undefined : await xAccount(ctx, input.accountId);
        if (!account && input.destination !== "signup" && input.destination !== "connect")
          throw new Error("Choose an X account.");
        return xHandoff(input.destination, input.target, account?.platformId);
      },
    },
    "x.insights": {
      ownerOnly: false,
      readOnly: true,
      tool: true,
      run: async (ctx, input) => {
        const end = ctx.now();
        const startTime = isoTimestamp(end - 7 * 86_400_000);
        const endTime = isoTimestamp(end);
        if (!startTime || !endTime) throw new Error("The Host clock is unavailable.");
        const { account, token } = await paidRead(ctx, input.accountId, "analytics", "enterprise");
        return await xReadInsights(http, account, token, { startTime, endTime });
      },
    },
    "x.spaces": {
      ownerOnly: false,
      readOnly: true,
      tool: true,
      run: async (ctx, input) => {
        const { account, token } = await paidRead(ctx, input.accountId, "x.spaces");
        return await xListOwnSpaces(http, account, token);
      },
    },
    "x.lists": {
      ownerOnly: false,
      readOnly: true,
      tool: true,
      run: async (ctx, input) => {
        const { account, token } = await paidRead(ctx, input.accountId, "x.lists");
        const cursor = optionalText(input.cursor);
        return input.listId === undefined
          ? await getXOwnedLists(http, account, token, cursor)
          : await getXListMembers(http, account, token, xResourceId(input.listId), cursor);
      },
    },
    "x.apply": {
      ownerOnly: true,
      readOnly: false,
      run: (ctx, input) => applyXWrite(http, ctx, input),
    },
  };
}
