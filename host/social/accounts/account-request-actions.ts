import { randomUUID } from "node:crypto";
import type { SocialAccountRequest } from "../../../src/features/social/model/accountRequests";
import {
  SOCIAL_BROWSER_ACCOUNT_TYPES,
  SOCIAL_PLATFORM_NAMES,
  SOCIAL_PLATFORMS,
  type SocialAccount,
  type SocialPlatform,
} from "../../../src/features/social/model/social";
import { SOCIAL_BROWSER_SITES } from "../../../src/features/social/model/socialBrowser";
import type { SocialActionContext, SocialActionModule } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";

const REASON_MAX = 500;
const NAME_MAX = 100;
const USERNAME_MAX = 50;
const PAGE = 200;

const optional = (value: unknown, field: string, max: number) =>
  value === undefined ? undefined : str(value, field, max);

function linkedinConnectionReady(account: SocialAccount, now: number): boolean {
  return account.connected && (account.expiresAt === undefined || account.expiresAt > now);
}

async function allRequests(ctx: SocialActionContext): Promise<SocialAccountRequest[]> {
  const items: SocialAccountRequest[] = [];
  let cursor: string | undefined;
  do {
    const page = await ctx.store.listRecords("account-request", { cursor, limit: PAGE });
    items.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return items;
}

async function request(ctx: SocialActionContext, id: string): Promise<SocialAccountRequest> {
  const found = await ctx.store.getRecord("account-request", id);
  if (!found) throw new Error("Account request not found.");
  return found;
}

/** Files a request. It creates nothing on any platform; only the owner can approve it. */
async function file(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<SocialAccountRequest> {
  exact(input, [
    "projectId",
    "platform",
    "accountType",
    "reason",
    "suggestedName",
    "suggestedUsername",
    "accountId",
  ]);
  const platform = input.platform as SocialPlatform;
  if (!(SOCIAL_PLATFORMS as readonly unknown[]).includes(platform))
    throw new Error("Unsupported social platform.");
  const label = SOCIAL_PLATFORM_NAMES[platform];
  const types = SOCIAL_BROWSER_ACCOUNT_TYPES[platform] as readonly string[];
  if (!SOCIAL_BROWSER_SITES[platform].origins.length)
    throw new Error(`${label} accounts cannot be opened in browser mode.`);
  const projectId = str(input.projectId, "project", 200);
  // Owner or the project's own session; another project's data is refused here.
  await ctx.service.project(ctx.principal, projectId);
  const reason = str(input.reason, "reason", REASON_MAX);
  const suggestedName = optional(input.suggestedName, "suggested name", NAME_MAX);
  const suggestedUsername = optional(input.suggestedUsername, "suggested username", USERNAME_MAX);

  // LinkedIn reconnect keeps the original OAuth or browser account and its project grants.
  const requestedAccountId = optional(input.accountId, "account", 200);
  const reconnect = requestedAccountId
    ? await ctx.service.access(ctx.principal, requestedAccountId, "read")
    : undefined;
  if (reconnect) {
    if (platform !== "linkedin" || reconnect.platform !== "linkedin")
      throw new Error("Account reconnect requests are supported for LinkedIn.");
    if (!reconnect.grants[projectId]?.includes("read"))
      throw new Error("This project has no permission for this social account.");
    if (input.accountType !== undefined && input.accountType !== reconnect.accountType)
      throw new Error("The request must use the LinkedIn account's existing type.");
    if (linkedinConnectionReady(reconnect, ctx.now()))
      throw new Error("This LinkedIn account is already connected.");
  }
  const accountType = (reconnect?.accountType ??
    input.accountType ??
    types[0]) as SocialAccount["accountType"];
  if (!types.includes(accountType))
    throw new Error(`Choose a ${label} account type: ${types.join(", ")}.`);

  const existing = (await ctx.service.accounts(ctx.principal)).find(
    (account) =>
      !reconnect &&
      account.platform === platform &&
      (platform !== "linkedin" || account.accountType === accountType) &&
      account.connected &&
      account.grants[projectId]?.length,
  );
  if (existing)
    throw new Error(
      `This project already has a connected ${label} account (${existing.name}). Use it instead of requesting another.`,
    );

  return await ctx.store.transaction(async () => {
    const open = (await allRequests(ctx)).find(
      (item) =>
        item.projectId === projectId &&
        item.platform === platform &&
        item.accountType === accountType &&
        item.requestedAccountId === requestedAccountId &&
        (item.status === "pending" || item.status === "approved"),
    );
    if (open) return open;
    const now = ctx.now();
    const { provider, actorId, sessionId } = ctx.principal;
    const created: SocialAccountRequest = {
      id: randomUUID(),
      projectId,
      platform,
      accountType,
      reason,
      ...(suggestedName ? { suggestedName } : {}),
      ...(suggestedUsername ? { suggestedUsername: suggestedUsername.replace(/^@/, "") } : {}),
      ...(requestedAccountId ? { requestedAccountId } : {}),
      requestedBy: { provider, actorId, ...(sessionId ? { sessionId } : {}) },
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    return await ctx.store.putRecord("account-request", created.id, created);
  });
}

/** Newest first, with the project name. Approved requests whose account connected become fulfilled. */
async function list(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<{ items: SocialAccountRequest[] }> {
  exact(input, ["projectId"]);
  const projectId = optional(input.projectId, "project", 200);
  const names = new Map<string, string | undefined>();
  const items: SocialAccountRequest[] = [];
  for (const item of await allRequests(ctx)) {
    if (projectId && item.projectId !== projectId) continue;
    let current = item;
    if (item.status === "approved" && item.accountId) {
      const account = await ctx.service.account(item.accountId).catch(() => undefined);
      if (
        account &&
        (item.platform === "linkedin"
          ? linkedinConnectionReady(account, ctx.now())
          : account.connected)
      )
        current = await ctx.store.putRecord("account-request", item.id, {
          ...item,
          status: "fulfilled",
          updatedAt: ctx.now(),
        });
    }
    if (!names.has(item.projectId))
      names.set(
        item.projectId,
        (await ctx.service.project(ctx.principal, item.projectId).catch(() => undefined))?.name,
      );
    const projectName = names.get(item.projectId);
    items.push(projectName ? { ...current, projectName } : current);
  }
  return { items: items.sort((a, b) => b.createdAt - a.createdAt) };
}

/** Creates the browser account record and grants the requesting project, through accounts.create. */
async function approve(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<{ request: SocialAccountRequest; accountId: string }> {
  exact(input, ["id", "mode", "name"]);
  if (input.mode !== "create" && input.mode !== "signin") throw new Error("Invalid mode.");
  const mode = input.mode;
  const found = await request(ctx, str(input.id, "request", 200));
  if (found.status === "approved" && found.accountId)
    return { request: found, accountId: found.accountId };
  if (found.status !== "pending") throw new Error("This request is no longer open.");
  const project = await ctx.service.project(ctx.principal, found.projectId);
  if (found.requestedAccountId) {
    if (mode !== "signin")
      throw new Error("Use sign in to reconnect an existing LinkedIn account.");
    const account = await ctx.service.access(ctx.principal, found.requestedAccountId, "read");
    if (
      account.platform !== "linkedin" ||
      account.accountType !== found.accountType ||
      !account.grants[project.id]?.includes("read")
    )
      throw new Error("The original LinkedIn account is no longer shared with this project.");
    const saved = await ctx.store.putRecord("account-request", found.id, {
      ...found,
      status: "approved",
      mode,
      accountId: account.id,
      updatedAt: ctx.now(),
    });
    return { request: saved, accountId: account.id };
  }
  const name =
    optional(input.name, "name", 200) ??
    found.suggestedName ??
    `${SOCIAL_PLATFORM_NAMES[found.platform]} - ${project.name}`;
  const account = (await ctx.service.call(ctx.principal, "accounts.create", {
    platform: found.platform,
    name,
    accountType: found.accountType,
    connection: "browser",
    projectIds: [found.projectId],
  })) as SocialAccount;
  const saved = await ctx.store.putRecord("account-request", found.id, {
    ...found,
    status: "approved",
    mode,
    accountId: account.id,
    updatedAt: ctx.now(),
  });
  return { request: saved, accountId: account.id };
}

async function dismiss(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<SocialAccountRequest> {
  exact(input, ["id"]);
  const found = await request(ctx, str(input.id, "request", 200));
  if (found.status !== "pending") throw new Error("This request is no longer open.");
  return await ctx.store.putRecord("account-request", found.id, {
    ...found,
    status: "dismissed",
    updatedAt: ctx.now(),
  });
}

/** LinkedIn request status for the requesting project. Never return profile fields or provider text. */
async function linkedInSetupStatus(ctx: SocialActionContext, input: Record<string, unknown>) {
  exact(input, ["id"]);
  const found = await ctx.store.getRecord("account-request", str(input.id, "request", 200));
  if (
    found?.platform !== "linkedin" ||
    (ctx.principal.kind !== "owner" && ctx.principal.projectId !== found.projectId)
  )
    throw new Error("Account request not found.");
  await ctx.service.project(ctx.principal, found.projectId);
  if (!found.accountId) return { status: found.status };
  const account = await ctx.service.access(ctx.principal, found.accountId, "read");
  const connected = linkedinConnectionReady(account, ctx.now());
  const signup =
    found.mode === "create" ? await ctx.store.latestBrowserSignup(account.id) : undefined;
  return {
    status: connected ? "fulfilled" : found.status,
    mode: found.mode,
    accountId: account.id,
    connection: connected ? "connected" : "needs_sign_in",
    ...(signup?.platform === "linkedin"
      ? {
          signup: {
            status:
              (signup.status === "queued" || signup.status === "awaiting_owner") &&
              signup.expiresAt <= ctx.now()
                ? "expired"
                : signup.status,
            ...(signup.registration
              ? {
                  registrationStatus: signup.registration.status,
                  step: signup.registration.step,
                  blockers: signup.registration.blockers,
                }
              : {}),
            ...(signup.registrationSubmission
              ? { submission: signup.registrationSubmission.state }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Project-driven account requests. The AI files one (`tool`), the owner approves or dismisses it;
 * approval is the only step that creates an account record, and it never contacts a platform.
 */
export const accountRequestActions: SocialActionModule = {
  "accounts.request": { readOnly: false, ownerOnly: false, tool: true, run: file },
  "accounts.requests.list": { readOnly: true, ownerOnly: true, run: list },
  "accounts.requests.approve": { readOnly: false, ownerOnly: true, run: approve },
  "accounts.requests.dismiss": { readOnly: false, ownerOnly: true, run: dismiss },
  // LinkedIn account setup.
  "linkedin.accounts.setupStatus": {
    readOnly: true,
    ownerOnly: false,
    tool: true,
    run: linkedInSetupStatus,
  },
};
