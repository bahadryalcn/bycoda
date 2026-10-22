import {
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  type ProviderAccount,
} from "./providerAccounts";
import { getCachedRateLimits } from "./rateLimitsCache";
import type { ProviderRateLimits, RateLimitWindow } from "./rateLimits";
import {
  getCachedMcpSettings,
  type McpSettingsSnapshot,
} from "../../settings/model/mcpSettingsCache";

export type ProviderManagementContext = {
  environmentId: string;
  sourceSessionId: string;
  projectCwd: string;
  workingCwd: string;
  valid: () => boolean;
};
type Deps = {
  accounts: () => ProviderAccount[];
  quota: (provider: "claude" | "codex", id: string) => ProviderRateLimits;
  mcp: (cwd: string) => McpSettingsSnapshot | undefined;
  now: () => number;
};
const owners: Deps = {
  accounts: () => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts),
  quota: getCachedRateLimits,
  mcp: getCachedMcpSettings,
  now: Date.now,
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value);
export function accountMetadataSignature(accounts: ProviderAccount[]) {
  return JSON.stringify(
    accounts.map(({ provider, id, label, color, isDefault }) => ({
      provider,
      id,
      label,
      color: color ?? null,
      isDefault: isDefault === true,
    })),
  );
}
export async function accountMetadataRevision(accounts: ProviderAccount[]) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(accountMetadataSignature(accounts)),
      ),
    ),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function windowView(value: RateLimitWindow | null) {
  return value &&
    Number.isFinite(value.usedPercent) &&
    value.usedPercent >= 0 &&
    value.usedPercent <= 100 &&
    Number.isFinite(value.windowMinutes) &&
    value.windowMinutes > 0 &&
    (value.resetsAt === null || (Number.isSafeInteger(value.resetsAt) && value.resetsAt >= 0))
    ? {
        usedPercent: value.usedPercent,
        windowMinutes: value.windowMinutes,
        resetsAt: value.resetsAt,
      }
    : null;
}
/** Metadata and already-observed cache only. This owner must never fetch, scan logs or launch a health CLI. */
export async function readProviderManagement(
  context: ProviderManagementContext,
  request: Record<string, unknown>,
  deps: Deps = owners,
) {
  const valid = () =>
    context.valid() &&
    [context.environmentId, context.sourceSessionId, context.projectCwd, context.workingCwd].every(
      (value) => text(value, 4096),
    ) &&
    !context.projectCwd.startsWith("remote://") &&
    !context.workingCwd.startsWith("remote://");
  if (Object.keys(request).length || !valid())
    throw new Error("Provider management source identity mismatch");
  const allAccounts = deps.accounts();
  const accountRevision = await accountMetadataRevision(allAccounts);
  const accounts = allAccounts.slice(0, 128).map((account) => {
    if (
      !["claude", "codex"].includes(account.provider) ||
      !text(account.id, 128) ||
      !text(account.label, 160)
    )
      throw new Error("Invalid account metadata");
    const cached = deps.quota(account.provider, account.id);
    const known =
      cached &&
      cached.provider === account.provider &&
      ["idle", "fetching", "ok", "error", "unavailable"].includes(cached.status);
    return {
      provider: account.provider,
      id: account.id,
      label: account.label,
      color: account.color ?? null,
      isDefault: account.isDefault === true,
      quota: {
        status: known ? cached.status : "unavailable",
        updatedAt:
          known && Number.isSafeInteger(cached.updatedAt) && cached.updatedAt >= 0
            ? cached.updatedAt
            : 0,
        session: known ? windowView(cached.session) : null,
        weekly: known ? windowView(cached.weekly) : null,
        monthly: known ? windowView(cached.monthly) : null,
        renewalPending: known && cached.renewalPending === true,
      },
    };
  });
  const cachedMcp = deps.mcp(context.workingCwd);
  const mcp = (cachedMcp?.servers ?? []).slice(0, 256).map((server) => {
    if (
      !["claude", "claude_desktop", "codex", "cursor", "opencode"].includes(server.provider) ||
      !text(server.name, 160) ||
      !["local", "project", "user"].includes(server.scope)
    )
      throw new Error("Invalid MCP metadata");
    return {
      provider: server.provider,
      name: server.name,
      scope: server.scope,
      transport: ["stdio", "sse", "http", "streamable-http"].includes(server.transport)
        ? server.transport
        : "unknown",
      enabled: server.enabled !== false,
    };
  });
  const coverage = {
    accountMetadata: "desktop-owner" as const,
    quotaSource: "desktop-cache" as const,
    mcpSource: cachedMcp ? ("desktop-cache" as const) : ("unavailable" as const),
    truncated: allAccounts.length > 128 || (cachedMcp?.servers.length ?? 0) > 256,
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ accounts, mcp, coverage }));
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (!valid()) throw new Error("Provider management source changed");
  return {
    environmentId: context.environmentId,
    sourceSessionId: context.sourceSessionId,
    projectCwd: context.projectCwd,
    workingCwd: context.workingCwd,
    sampledAt: deps.now(),
    revision,
    accountRevision,
    accounts,
    mcp,
    coverage,
  };
}
export type ProviderManagementSnapshot = Awaited<ReturnType<typeof readProviderManagement>>;
