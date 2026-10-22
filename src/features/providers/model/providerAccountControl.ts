import {
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  PROVIDER_ACCOUNT_COLORS,
  renameProviderAccount,
  setProviderAccountColor,
  setDefaultProviderAccount,
  type ProviderAccount,
  type ProviderAccountColor,
} from "./providerAccounts";
import {
  accountMetadataRevision,
  accountMetadataSignature,
  readProviderManagement,
  type ProviderManagementContext,
  type ProviderManagementSnapshot,
} from "./providerManagementControl";
import { refreshClaudeQuotaOnce } from "./rateLimitsCache";
export type ProviderAccountStatus = {
  state: "unknown" | "failed" | "applied";
  operationId: string;
  atomic: false;
  snapshot?: ProviderManagementSnapshot;
  message?: string;
};
type Deps = {
  accounts: () => ProviderAccount[];
  read: typeof readProviderManagement;
  rename: typeof renameProviderAccount;
  color: typeof setProviderAccountColor;
  default: typeof setDefaultProviderAccount;
  quotaRefresh?: typeof refreshClaudeQuotaOnce;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some((key) => !keys.includes(key)))
    throw Error("Invalid account metadata fields");
};
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function createProviderAccountControl(
  deps: Deps = {
    accounts: () => PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts),
    read: readProviderManagement,
    rename: renameProviderAccount,
    color: setProviderAccountColor,
    default: setDefaultProviderAccount,
    quotaRefresh: refreshClaudeQuotaOnce,
  },
) {
  const receipts = new Map<
    string,
    { scope: string; signature: string; status: ProviderAccountStatus }
  >();
  const assert = (context: ProviderManagementContext) => {
    if (
      !context.valid() ||
      !context.environmentId ||
      !context.sourceSessionId ||
      context.projectCwd.startsWith("remote://") ||
      context.workingCwd.startsWith("remote://")
    )
      throw Error("Account metadata source changed");
  };
  const scope = (context: ProviderManagementContext) =>
    JSON.stringify([
      context.environmentId,
      context.sourceSessionId,
      context.projectCwd,
      context.workingCwd,
    ]);
  return async (
    context: ProviderManagementContext,
    action: string,
    input: Record<string, unknown>,
  ): Promise<ProviderAccountStatus> => {
    assert(context);
    if (!id(input.operationId)) throw Error("Invalid account metadata operation");
    const operationId = input.operationId;
    if (action === "providerManagement.status") {
      exact(input, ["operationId"]);
      const receipt = receipts.get(operationId);
      if (!receipt || receipt.scope !== scope(context))
        return { state: "unknown", operationId, atomic: false };
      return receipt.status.state === "applied"
        ? { ...receipt.status, snapshot: await deps.read(context, {}) }
        : receipt.status;
    }
    const quota = action === "providerManagement.quotaRefresh";
    if (action !== "providerManagement.patch" && !quota)
      throw Error("Unsupported account metadata action");
    exact(input, [
      "operationId",
      "expectedAccountRevision",
      "provider",
      "accountId",
      quota ? "confirm" : "change",
    ]);
    if (quota && (input.provider !== "claude" || input.confirm !== "REFRESH_PROVIDER_QUOTA"))
      throw Error("Explicit Claude quota refresh confirmation required");
    if (
      typeof input.expectedAccountRevision !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expectedAccountRevision) ||
      !["claude", "codex"].includes(String(input.provider)) ||
      !id(input.accountId) ||
      (!quota && !record(input.change))
    )
      throw Error("Invalid account metadata review");
    const provider = input.provider as "claude" | "codex",
      accountId = input.accountId,
      change = (quota ? { kind: "quotaRefresh" } : input.change) as Record<string, unknown>;
    const beforeMetadata = accountMetadataSignature(deps.accounts());
    let save: () => unknown;
    if (quota) {
      if (!deps.quotaRefresh) throw Error("Explicit quota refresh unavailable");
      save = () =>
        deps.quotaRefresh!(
          accountId,
          () => context.valid() && accountMetadataSignature(deps.accounts()) === beforeMetadata,
        );
    } else if (change.kind === "rename") {
      exact(change, ["kind", "label"]);
      if (
        typeof change.label !== "string" ||
        !change.label.trim() ||
        change.label.trim().length > 160 ||
        /[\0\r\n]/.test(change.label)
      )
        throw Error("Invalid account label");
      const label = change.label.replace(/\s+/g, " ").trim();
      if (label.length > 48) throw Error("Account labels must be at most 48 characters");
      save = () => deps.rename(provider, accountId, label);
    } else if (change.kind === "color") {
      exact(change, ["kind", "color"]);
      if (change.color !== null && !PROVIDER_ACCOUNT_COLORS.some((row) => row.id === change.color))
        throw Error("Invalid account color");
      const color = change.color as ProviderAccountColor | null;
      save = () => deps.color(provider, accountId, color ?? undefined);
    } else if (change.kind === "default") {
      exact(change, ["kind", "confirm"]);
      if (change.confirm !== "DEFAULT_FOR_FUTURE_SESSIONS")
        throw Error("Future-session default confirmation required");
      save = () => {
        deps.default(provider, accountId);
        return true;
      };
    } else throw Error("Unsupported account metadata change");
    const signature = JSON.stringify([
      action,
      input.expectedAccountRevision,
      provider,
      accountId,
      change,
    ]);
    const previous = receipts.get(operationId);
    if (previous) {
      if (previous.scope !== scope(context) || previous.signature !== signature)
        throw Error("Account operation ID was already used");
      return previous.status;
    }
    if (receipts.size >= 128) throw Error("Account receipt capacity reached");
    const receipt = {
      scope: scope(context),
      signature,
      status: { state: "unknown", operationId, atomic: false } as ProviderAccountStatus,
    };
    receipts.set(operationId, receipt);
    let dispatched = false;
    try {
      const accounts = deps.accounts();
      const signatureBefore = accountMetadataSignature(accounts);
      if (
        accounts.length > 128 ||
        (await accountMetadataRevision(accounts)) !== input.expectedAccountRevision
      )
        throw Error("Account metadata changed; review it again");
      assert(context);
      if (
        accountMetadataSignature(deps.accounts()) !== signatureBefore ||
        !accounts.some((row) => row.provider === provider && row.id === accountId)
      )
        throw Error("Account metadata changed; review it again");
      dispatched = true;
      if (!(quota ? await save() : save())) throw Error("Account change could not be verified");
      if (quota && accountMetadataSignature(deps.accounts()) !== beforeMetadata)
        throw Error("Account metadata changed while refreshing quota");
      assert(context);
      const snapshot = await deps.read(context, {});
      assert(context);
      const target = snapshot.accounts.find(
        (row) => row.provider === provider && row.id === accountId,
      );
      const verified =
        !!target &&
        (quota ||
          (change.kind === "rename"
            ? target.label === (change.label as string).replace(/\s+/g, " ").trim()
            : change.kind === "color"
              ? target.color === change.color
              : target.isDefault));
      if (!verified) throw Error("Account change could not be verified");
      receipt.status = { state: "applied", operationId, atomic: false, snapshot };
    } catch {
      receipt.status = dispatched
        ? { state: "unknown", operationId, atomic: false }
        : {
            state: "failed",
            operationId,
            atomic: false,
            message:
              "Account metadata changed or the source is unavailable. Refresh and review again.",
          };
    }
    return receipt.status;
  };
}
export const handleProviderAccountControl = createProviderAccountControl();
