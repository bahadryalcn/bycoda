import { useDismissPopover } from "../../shared/hooks/useDismissPopover";
import { t, useLocale, getLocale } from "../../shared/i18n";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  clampUsedPercent,
  formatRateLimitWindowChipLabel,
  formatResetCountdown,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  rateLimitWindowTooltip,
  type ProviderRateLimits,
  type RateLimitResetCredit,
  type RateLimitWindow,
} from "../../features/providers/model/rateLimits";
import type { CodexRateLimitResetOutcome } from "../../features/providers/model/rateLimitsFetch";
import { projectMascot } from "../../features/projects/model/projectMascots";
import { projectKey, projectName } from "../../shared/lib/paths";
import { HARNESS_TITLE, type HarnessId } from "../../features/sessions/model/session";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { ArrowLeft, Check, ChevronRight, Plus, RefreshCw } from "../../shared/ui/icons";
import { Popover } from "../../shared/ui/Popover";
import { Button } from "../../shared/ui/Button";
import {
  ProviderSignInPanel,
  type ProviderSignInState,
} from "../../features/sessions/ui/ProviderSignInPanel";
import {
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../features/providers/model/providerAccounts";
import {
  accountStatus,
  accountUsageKey,
  bestAlternativeAccount,
  needsProviderLogin,
  useProviderAccountUsage,
} from "../../features/providers/model/accountUsage";
import {
  AccountStatusLabel,
  barClass,
  meterWindows,
  UsageMeter,
} from "../../features/providers/ui/ProviderAccountUsage";
import {
  identityKey,
  identityOrganizationTag,
  useProviderAccountIdentities,
  type ProviderAccountIdentity,
} from "../../features/providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../features/providers/ui/ProviderAccountSubtitle";
import { AccountColorDot } from "../../features/providers/ui/AccountColorDot";
import { useShowRemainingUsage } from "../../features/settings/model/displayPrefs";
import {
  loadRateLimits,
  useCachedRateLimits,
} from "../../features/providers/model/rateLimitsCache";

type UsageWindowEntry = {
  key: "session" | "weekly" | "monthly";
  window: RateLimitWindow;
};

type ResetActionState = "idle" | "confirming" | "using" | CodexRateLimitResetOutcome | "error";

export function UsageProviderChip({
  limits,
  now,
  project,
  accounts = [],
  accountId,
  onSelectAccount,
  onSelectUsageAccount,
  onAddAccount,
  onManageAccounts,
  onConsumeReset,
  onReconnect,
  presentation,
  usageOnly = false,
}: {
  limits: ProviderRateLimits;
  usageOnly?: boolean;
  now: number;
  presentation?: { harness: HarnessId; label: string; sourceLabel?: string };
  project?: string;
  accounts?: ProviderAccount[];
  accountId?: string;
  onSelectAccount?: (accountId: string) => void;
  onSelectUsageAccount?: (accountId: string) => void;
  onAddAccount?: (label: string) => Promise<ProviderAccount>;
  onManageAccounts?: () => void;
  onConsumeReset?: (creditId?: string) => Promise<CodexRateLimitResetOutcome>;
  onReconnect?: () => Promise<void>;
}) {
  useLocale();
  const showRemaining = useShowRemainingUsage();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Browsing usage never changes the account pinned to a conversation.
  const [usageAccountId, setUsageAccountId] = useState<string | null>(null);
  const usageAccount =
    usageOnly && !onSelectUsageAccount
      ? accounts.find((account) => account.id === usageAccountId)
      : undefined;
  const detailAccountId = usageAccount?.id ?? accountId;
  const viewingOtherAccount = detailAccountId !== accountId;
  const cachedDetails = useCachedRateLimits(limits.provider, detailAccountId);
  const detailLimits = viewingOtherAccount ? cachedDetails : limits;
  const detailWindows = usageWindows(detailLimits);
  const detailLoading =
    detailLimits.status === "idle" ||
    (detailLimits.status === "fetching" && detailWindows.length === 0);
  const canBrowseUsage = usageOnly && accounts.length > 1;

  useEffect(() => {
    if (open && usageOnly && viewingOtherAccount) {
      void loadRateLimits(limits.provider, detailAccountId);
    }
  }, [open, usageOnly, viewingOtherAccount, limits.provider, detailAccountId]);
  const [accountView, setAccountView] = useState<"usage" | "accounts" | "add">("usage");
  const [resetAction, setResetAction] = useState<ResetActionState>("idle");
  const [activeResetKey, setActiveResetKey] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [reconnectState, setReconnectState] = useState<ProviderSignInState>("idle");
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const loading =
    limits.status === "idle" ||
    (limits.status === "fetching" && !limits.session && !limits.weekly && !limits.monthly);
  const disconnected = limits.status === "unavailable";
  const windows = usageWindows(limits);
  const loginView = Boolean(
    onReconnect &&
    !viewingOtherAccount &&
    detailWindows.length === 0 &&
    (needsProviderLogin(detailLimits) || reconnectState !== "idle"),
  );
  const tightest = windows.reduce<RateLimitWindow | null>((best, entry) => {
    if (!best || entry.window.usedPercent > best.usedPercent) {
      return entry.window;
    }
    return best;
  }, null);
  const tooltip = windows
    .map((entry) => rateLimitWindowTooltip(entry.window, now, showRemaining))
    .join(" · ");
  const providerLabel = presentation?.label ?? HARNESS_TITLE[limits.provider];
  const iconHarness = presentation?.harness ?? limits.provider;
  const activeAccount = accounts.find((account) => account.id === accountId);
  const canManageAccounts = !usageOnly && Boolean(onSelectAccount && onAddAccount);
  const activeAccountLabel = activeAccount?.label ?? "Removed account";
  const identities = useProviderAccountIdentities(
    accounts,
    `${open}:${limits.updatedAt}:${reconnectState}`,
  );
  const activeIdentity = activeAccount ? identities[identityKey(activeAccount)] : null;
  const accountProvider = supportsProviderAccounts(limits.provider) ? limits.provider : undefined;
  const otherAccounts = accounts.filter((account) => account.id !== accountId);
  const accountUsage = useProviderAccountUsage(accounts.map((account) => account.id).join("|"), {
    provider: accountProvider,
    enabled: !usageOnly && open && Boolean(accountProvider) && otherAccounts.length > 0,
  });
  // The footer's own snapshot is fresher for the active account.
  const usageFor = (account: ProviderAccount) =>
    account.id === accountId ? limits : accountUsage.usage[accountUsageKey(account)];
  const activeStatus = accountStatus(limits, now);
  const suggestion =
    activeStatus.tone === "exhausted" || activeStatus.tone === "low"
      ? bestAlternativeAccount(otherAccounts, usageFor, now)
      : null;
  const mascotProject = project ? projectName(project) : providerLabel;
  const appearanceKey = project ? projectKey(project) : mascotProject;
  const mascotName = resolveTabGroupMascot(appearanceKey, loadTabGroupMascots());
  const mascotColor = resolveTabGroupColor(
    appearanceKey,
    loadTabGroupColors(),
    loadTabGroupCustomColors(),
    mascotProject,
  );

  useEffect(() => {
    if (open) return;
    setResetAction("idle");
    setActiveResetKey(null);
    setResetError(null);
    setReconnectState("idle");
    setReconnectError(null);
    setAccountView("usage");
  }, [open]);

  const dismiss = useDismissPopover(setOpen, trigger);

  const useReset = async (credit: RateLimitResetCredit | undefined, rowKey: string) => {
    if (!onConsumeReset || viewingOtherAccount) return;
    setActiveResetKey(rowKey);
    setResetAction("using");
    setResetError(null);
    try {
      setResetAction(await onConsumeReset(credit?.id));
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Could not use this reset");
      setResetAction("error");
    }
  };

  const reconnect = async () => {
    if (!onReconnect) return;
    setReconnectState("running");
    setReconnectError(null);
    try {
      await onReconnect();
      setReconnectState("complete");
    } catch (error) {
      setReconnectError(error instanceof Error ? error.message : "Could not complete sign-in");
      setReconnectState("error");
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="-mx-1 inline-flex h-5 min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1 text-content/55 motion-safe:transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.97]"
        aria-label={t("{p0} usage details", { p0: providerLabel })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          tooltip ||
          limits.error ||
          (disconnected ? t("Not connected") : loading ? t("Loading usage…") : t("Usage details"))
        }
        onClick={() => setOpen((value) => !value)}
      >
        <HarnessIcon harness={iconHarness} className="size-3 shrink-0" />
        {accounts.length > 1 && activeAccount ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <AccountColorDot account={activeAccount} className="size-1.5" />
            <span className="max-w-24 truncate text-content/45">{activeAccount.label}</span>
          </span>
        ) : null}
        {loading ? (
          <span className="animate-pulse text-content/35">···</span>
        ) : disconnected ? (
          <span className="text-content/35">{t("not connected")}</span>
        ) : windows.length === 0 ? (
          <span className="text-content/35">{emptyUsageLabel(limits)}</span>
        ) : (
          <>
            {tightest ? <MiniBar usedPct={tightest.usedPercent} /> : null}
            <span className="flex min-w-0 items-center gap-1 tabular-nums">
              {windows.map((entry, index) => (
                <span key={entry.key} className="inline-flex items-center gap-1">
                  {index > 0 ? <span className="text-content/25">·</span> : null}
                  <span>
                    {formatUsagePercent(
                      showRemaining
                        ? 100 - clampUsedPercent(entry.window.usedPercent)
                        : entry.window.usedPercent,
                    )}{" "}
                    {formatRateLimitWindowChipLabel(entry.window, now)}
                  </span>
                </span>
              ))}
            </span>
          </>
        )}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="start"
          gap={7}
          width={accountView === "accounts" ? 340 : 300}
          maxHeight={460}
          autoFocus
          onDismiss={dismiss}
          role="dialog"
          aria-label={t("{p0} usage details", { p0: providerLabel })}
          tabIndex={-1}
          className={`overflow-y-auto text-content ${accountView === "usage" && loginView && !canBrowseUsage ? "" : "p-2.5"}`}
        >
          {canBrowseUsage ? (
            <div role="group" aria-label={t("Accounts")} className="mbe-2 flex flex-wrap gap-1">
              {accounts.map((account) => (
                <Button
                  key={account.id}
                  variant="tab"
                  aria-pressed={account.id === detailAccountId}
                  title={account.label}
                  className="min-w-0 max-w-full gap-1.5"
                  onClick={() => {
                    setResetAction("idle");
                    setActiveResetKey(null);
                    setResetError(null);
                    setReconnectState("idle");
                    setReconnectError(null);
                    if (onSelectUsageAccount) onSelectUsageAccount(account.id);
                    else setUsageAccountId(account.id);
                  }}
                  disabled={resetAction === "using" || reconnectState === "running"}
                >
                  <AccountColorDot account={account} className="size-1.5" />
                  <span className="min-w-0 truncate">{account.label}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {accountView === "accounts" ? (
            <ProviderAccountPicker
              providerLabel={providerLabel}
              accounts={accounts}
              identities={identities}
              accountId={accountId ?? ""}
              usageFor={usageFor}
              now={now}
              onBack={() => setAccountView("usage")}
              onAdd={() => setAccountView("add")}
              onManage={
                onManageAccounts
                  ? () => {
                      setOpen(false);
                      onManageAccounts();
                    }
                  : undefined
              }
              onSelect={(nextAccountId) => {
                onSelectAccount?.(nextAccountId);
                setOpen(false);
              }}
            />
          ) : accountView === "add" ? (
            <AddProviderAccount
              providerLabel={providerLabel}
              onBack={() => setAccountView("accounts")}
              onAdd={onAddAccount}
              onComplete={() => setOpen(false)}
            />
          ) : loginView ? (
            <>
              {canManageAccounts ? (
                <AccountSwitchRow
                  account={activeAccount}
                  accountLabel={activeAccountLabel}
                  onClick={() => setAccountView("accounts")}
                />
              ) : null}
              <ProviderSignInPanel
                harness={limits.provider}
                state={reconnectState}
                error={reconnectError}
                onSignIn={() => void reconnect()}
              />
            </>
          ) : (
            <>
              <div className="flex items-start gap-2.5 px-1 pb-2.5 pt-0.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.06] ring-1 ring-inset ring-content/[0.07]">
                  <HarnessIcon harness={iconHarness} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[13px] font-medium leading-4">
                    {providerLabel}
                    {t(" usage")}
                  </h2>
                  <p className="mt-0.5 text-[10px] leading-4 text-content/40">
                    {updatedLabel(detailLimits, now)}
                  </p>
                  {presentation?.sourceLabel ? (
                    <p className="mt-0.5 text-[10px] leading-4 text-content/55">
                      {presentation.sourceLabel}
                    </p>
                  ) : null}
                  {canManageAccounts ? (
                    <div className="pointer-events-none relative mt-1 -ml-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] text-content/55">
                      {/* Keep account switching separate from email revelation. */}
                      <button
                        type="button"
                        className="pointer-events-auto absolute inset-0 rounded hover:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
                        aria-label={t("Switch {p0} account", { p0: providerLabel })}
                        onClick={() => setAccountView("accounts")}
                      />
                      {activeAccount ? (
                        <AccountColorDot account={activeAccount} className="size-1.5" />
                      ) : null}
                      <span className="max-w-[60%] shrink-0 truncate">{activeAccountLabel}</span>
                      <ProviderAccountSubtitle
                        key={activeAccount && identityKey(activeAccount)}
                        identity={activeIdentity}
                        className="text-content/35"
                      />
                      <ChevronRight className="size-2.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    </div>
                  ) : null}
                </div>
                {detailLimits.status === "fetching" ? (
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-content/40">
                    <RefreshCw
                      className="size-2.5 motion-safe:animate-spin"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {t("Updating")}
                  </span>
                ) : null}
              </div>

              {detailLimits.status === "error" && detailWindows.length > 0 ? (
                <p className="mb-2 rounded-lg bg-warning/10 px-2.5 py-2 text-[10px] leading-4 text-warning dark:text-warning">
                  {t("Couldn’t refresh. Showing the last available snapshot.")}
                </p>
              ) : null}

              {detailWindows.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {detailWindows.map((entry) => (
                    <UsageWindowCard
                      key={entry.key}
                      kind={entry.key}
                      window={entry.window}
                      now={now}
                    />
                  ))}
                </div>
              ) : (
                <EmptyUsageState limits={detailLimits} loading={detailLoading} />
              )}

              {!usageOnly && suggestion && onSelectAccount ? (
                <SwitchSuggestion
                  account={suggestion}
                  limits={usageFor(suggestion)}
                  exhausted={activeStatus.tone === "exhausted"}
                  now={now}
                  onSwitch={() => {
                    onSelectAccount(suggestion.id);
                    setOpen(false);
                  }}
                />
              ) : null}

              {limits.provider === "codex" ? (
                <BankedResets
                  limits={detailLimits}
                  now={now}
                  action={viewingOtherAccount ? "idle" : resetAction}
                  activeResetKey={viewingOtherAccount ? null : activeResetKey}
                  error={viewingOtherAccount ? null : resetError}
                  mascotProject={mascotProject}
                  mascotName={mascotName}
                  mascotColor={mascotColor}
                  onConfirm={(creditId) => {
                    setActiveResetKey(creditId);
                    setResetAction("confirming");
                  }}
                  onCancel={() => {
                    setActiveResetKey(null);
                    setResetAction("idle");
                  }}
                  onUse={useReset}
                  canUse={!viewingOtherAccount && Boolean(onConsumeReset)}
                />
              ) : null}
            </>
          )}
        </Popover>
      ) : null}
    </>
  );
}

function AccountSwitchRow({
  account,
  accountLabel,
  onClick,
}: {
  account?: ProviderAccount;
  accountLabel: string;
  onClick: () => void;
}) {
  useLocale();
  return (
    <div className="px-2.5 pt-2.5">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-lg bg-content/[0.045] px-2.5 text-left text-[11px] ring-1 ring-inset ring-content/[0.06] hover:bg-content/[0.08]"
        aria-label={t("Switch account from {p0}", { p0: accountLabel })}
        onClick={onClick}
      >
        {account ? <AccountColorDot account={account} /> : null}
        <span className="min-w-0 flex-1 truncate">{accountLabel}</span>
        <span className="text-[10px] text-content/40">{t("Switch account")}</span>
        <ChevronRight className="size-3 shrink-0 text-content/35" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

function ProviderAccountPicker({
  providerLabel,
  accounts,
  identities,
  accountId,
  usageFor,
  now,
  onBack,
  onAdd,
  onManage,
  onSelect,
}: {
  providerLabel: string;
  accounts: ProviderAccount[];
  identities: Record<string, ProviderAccountIdentity | null>;
  accountId: string;
  usageFor: (account: ProviderAccount) => ProviderRateLimits | undefined;
  now: number;
  onBack: () => void;
  onAdd: () => void;
  onManage?: () => void;
  onSelect: (accountId: string) => void;
}) {
  useLocale();
  const statusId = useId();
  return (
    <div>
      <div className="flex h-7 items-center gap-1">
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          aria-label={t("Back to usage")}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <h2 className="text-[13px] font-medium">
          {providerLabel}
          {t(" accounts")}
        </h2>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-4 text-content/40">
        {t("Applies to this conversation only; new ones use the default account.")}
      </p>
      <div
        className="mt-2 flex flex-col gap-1"
        role="group"
        aria-label={t("{p0} accounts", { p0: providerLabel })}
      >
        {accounts.map((account) => {
          const selected = account.id === accountId;
          const identity = identities[identityKey(account)];
          const orgTag = identityOrganizationTag(identity);
          const usage = usageFor(account);
          const meters = meterWindows(usage);
          return (
            <div
              key={account.id}
              className={`pointer-events-none relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[11px] ring-1 ring-inset transition-colors ${
                selected
                  ? "bg-accent/10 text-content ring-accent/20"
                  : "bg-content/[0.035] text-content/70 ring-content/[0.06]"
              }`}
            >
              {/* A sibling target keeps the email button out of the selection button. */}
              <button
                type="button"
                aria-pressed={selected}
                aria-label={account.label}
                aria-describedby={`${statusId}-${account.id}`}
                className="pointer-events-auto absolute inset-0 rounded-lg hover:bg-content/[0.04] focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => onSelect(account.id)}
              />
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <AccountColorDot account={account} />
                  <span className="shrink-0 truncate">{account.label}</span>
                  <ProviderAccountSubtitle
                    identity={identity}
                    className="text-[10px] text-content/35"
                  />
                  {orgTag ? (
                    <span className="max-w-[6rem] shrink-0 truncate rounded bg-content/[0.07] px-1 text-[9px] leading-4 text-content/50">
                      {orgTag}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-3 text-[10px]">
                  <span
                    id={`${statusId}-${account.id}`}
                    // Without meters, a long "unknown" reason truncates.
                    className={meters.length > 0 ? "shrink-0" : "min-w-0"}
                  >
                    <AccountStatusLabel status={accountStatus(usage, now)} className="min-w-0" />
                  </span>
                  {meters.length > 0 ? (
                    <span className="flex min-w-0 flex-1 gap-2.5">
                      {meters.map((entry) => (
                        // Short "5h" / "wk" titles, as on the footer chip.
                        <UsageMeter
                          key={entry.title}
                          title={formatWindowLabel(entry.window.windowMinutes)}
                          window={entry.window}
                          now={now}
                          className="min-w-0 flex-1"
                        />
                      ))}
                    </span>
                  ) : null}
                </span>
              </span>
              {selected ? (
                <Check className="size-3.5 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="mt-2 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] text-content/55 hover:bg-content/[0.07] hover:text-content"
        onClick={onAdd}
      >
        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
        {t("Add account")}
      </button>
      {onManage ? (
        <button
          type="button"
          className="mt-0.5 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] text-content/45 hover:bg-content/[0.07] hover:text-content"
          onClick={() => {
            onManage();
          }}
        >
          {t("Manage accounts…")}
        </button>
      ) : null}
    </div>
  );
}

function SwitchSuggestion({
  account,
  limits,
  exhausted,
  now,
  onSwitch,
}: {
  account: ProviderAccount;
  limits: ProviderRateLimits | undefined;
  exhausted: boolean;
  now: number;
  onSwitch: () => void;
}) {
  useLocale();
  return (
    <section className="mt-2 flex items-center gap-2.5 rounded-lg bg-content/[0.045] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] leading-4 text-content/45">
          {exhausted ? t("Out of usage") : t("Running low")}
          {t(" · switch to")}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px]">
          <AccountColorDot account={account} />
          <span className="min-w-0 truncate font-medium">{account.label}</span>
          <AccountStatusLabel status={accountStatus(limits, now)} className="text-[10px]" />
        </p>
      </div>
      <button
        type="button"
        className="h-7 shrink-0 rounded-md bg-content px-2.5 text-[11px] font-medium text-background-base motion-safe:transition-transform duration-150 hover:bg-content/85 active:scale-[0.97]"
        onClick={onSwitch}
      >
        {t("Switch account")}
      </button>
    </section>
  );
}

function AddProviderAccount({
  providerLabel,
  onBack,
  onAdd,
  onComplete,
}: {
  providerLabel: string;
  onBack: () => void;
  onAdd?: (label: string) => Promise<ProviderAccount>;
  onComplete: () => void;
}) {
  useLocale();
  const [label, setLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!onAdd || !label.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      await onAdd(label);
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this account");
      setRunning(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="flex h-7 items-center gap-1">
        <button
          type="button"
          className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          aria-label={t("Back to accounts")}
          disabled={running}
          onClick={onBack}
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
        <h2 className="text-[13px] font-medium">
          {t("Add ")}
          {providerLabel}
          {t(" account")}
        </h2>
      </div>
      <p className="mt-1 px-1 text-[10px] leading-4 text-content/40">
        {t("Give this account a local name, then finish sign-in in your browser.")}
      </p>
      <label className="mt-3 block text-[10px] font-medium text-content/55">
        {t("Account name")}
        <input
          autoFocus
          type="text"
          maxLength={48}
          value={label}
          disabled={running}
          placeholder={t("Work or Personal")}
          className="mt-1.5 h-8 w-full rounded-lg border border-content/10 bg-content/[0.04] px-2.5 text-[11px] text-content outline-none placeholder:text-content/25 focus:border-accent/45 disabled:opacity-55"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <button
        type="submit"
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-content px-3 text-[11px] font-medium text-background-base hover:bg-content/85 disabled:cursor-default disabled:opacity-45"
        disabled={running || !label.trim()}
      >
        {running ? <RefreshCw className="size-3.5 motion-safe:animate-spin" aria-hidden /> : null}
        {running ? t("Waiting for browser…") : t("Sign in and add account")}
      </button>
      {error ? (
        <p className="mt-2 text-[10px] leading-4 text-danger" role="status">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function usageWindows(limits: ProviderRateLimits): UsageWindowEntry[] {
  return [
    limits.session ? ({ key: "session", window: limits.session } as const) : null,
    limits.weekly ? ({ key: "weekly", window: limits.weekly } as const) : null,
    limits.monthly ? ({ key: "monthly", window: limits.monthly } as const) : null,
  ].filter((entry): entry is UsageWindowEntry => entry != null);
}

function UsageWindowCard({
  kind,
  window,
  now,
}: {
  kind: UsageWindowEntry["key"];
  window: RateLimitWindow;
  now: number;
}) {
  useLocale();
  const showRemaining = useShowRemainingUsage();
  const pct = clampUsedPercent(window.usedPercent);
  const remaining = 100 - pct;
  const shown = showRemaining ? remaining : pct;
  const title =
    kind === "session"
      ? "5-hour limit"
      : kind === "weekly"
        ? "Weekly limit"
        : kind === "monthly"
          ? "Monthly limit"
          : `${formatWindowLabel(window.windowMinutes)} limit`;
  return (
    <section className="rounded-lg bg-content/[0.045] px-3 py-2.5 ring-1 ring-inset ring-content/[0.06]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-medium text-content/65">{title}</h3>
        <span className="shrink-0 text-[11px] font-medium tabular-nums">
          {formatUsagePercent(shown)} {showRemaining ? t("remaining") : t("used")}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-label={`${title} ${showRemaining ? "remaining" : "used"}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
      >
        <span
          className={`block h-full rounded-full ${barClass(pct)}`}
          style={{ width: `${shown}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] leading-4 text-content/40">
        <span className="tabular-nums">
          {formatUsagePercent(showRemaining ? pct : remaining)}{" "}
          {showRemaining ? t("used") : t("remaining")}
        </span>
        <span
          className="truncate text-right tabular-nums"
          title={
            window.resetsAt == null
              ? undefined
              : new Date(window.resetsAt).toLocaleString(getLocale())
          }
        >
          {window.resetsAt == null
            ? t("{p0} window", { p0: formatWindowLabel(window.windowMinutes) })
            : formatResetCountdown(window.resetsAt - now)}
        </span>
      </div>
    </section>
  );
}

function BankedResets({
  limits,
  now,
  action,
  activeResetKey,
  error,
  mascotProject,
  mascotName,
  mascotColor,
  onConfirm,
  onCancel,
  onUse,
  canUse,
}: {
  limits: ProviderRateLimits;
  now: number;
  action: ResetActionState;
  activeResetKey: string | null;
  error: string | null;
  mascotProject: string;
  mascotName: string | null;
  mascotColor: string;
  onConfirm: (rowKey: string) => void;
  onCancel: () => void;
  onUse: (credit: RateLimitResetCredit | undefined, rowKey: string) => void;
  canUse: boolean;
}) {
  useLocale();
  const count = limits.resetCredits?.availableCount ?? 0;
  if (count <= 0) return null;

  const detailedCredits = (limits.resetCredits?.credits ?? []).filter(
    (credit) => credit.status === "available" || credit.status === "unknown",
  );
  const unlistedCount = Math.max(0, count - detailedCredits.length);
  const rows: Array<RateLimitResetCredit | null> = [
    ...detailedCredits,
    ...Array.from({ length: unlistedCount }, () => null),
  ];
  return (
    <section className="mt-2.5 border-t border-content/[0.08] pt-2.5">
      <div className="relative min-h-[78px] overflow-hidden rounded-lg bg-content/[0.04] px-3 py-3 pr-[84px] ring-1 ring-inset ring-content/[0.06]">
        <div className="relative z-10 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[11px] font-medium">{t("Banked resets")}</h3>
            <span className="rounded-full bg-content/[0.07] px-1.5 py-px text-[9px] font-medium tabular-nums text-content/65 ring-1 ring-inset ring-content/[0.07]">
              {count}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-4 text-content/40">
            {count} {count === 1 ? t("reset") : t("resets")}
            {t(" available")}
          </p>
        </div>
        <BankedResetMascot project={mascotProject} name={mascotName} color={mascotColor} />
      </div>

      <div
        className="mt-2 max-h-56 overflow-y-auto overscroll-contain"
        aria-label={t("Available banked resets")}
      >
        <div className="flex flex-col gap-1.5">
          {rows.map((credit, index) => {
            const rowKey = credit?.id ?? `unlisted-${index}`;
            const selected = activeResetKey === rowKey;
            return (
              <BankedResetRow
                key={rowKey}
                credit={credit}
                index={index}
                now={now}
                action={selected ? action : "idle"}
                error={selected ? error : null}
                disabled={action === "using" && !selected}
                canUse={canUse}
                onConfirm={() => onConfirm(rowKey)}
                onCancel={onCancel}
                onUse={() => onUse(credit ?? undefined, rowKey)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BankedResetMascot({
  project,
  name,
  color,
}: {
  project: string;
  name: string | null;
  color: string;
}) {
  useLocale();
  const mascot = projectMascot(project, name);
  return (
    <div
      className="grid size-14 shrink-0 place-items-center rounded-xl border border-current/20 bg-current/5"
      data-reset-mascot-mood="happy"
      data-mascot-name={mascot.name}
      style={{ color }}
      aria-hidden
    >
      <ProjectMascot project={project} name={name} color={color} className="size-8" />
    </div>
  );
}
function BankedResetRow({
  credit,
  index,
  now,
  action,
  error,
  disabled,
  canUse,
  onConfirm,
  onCancel,
  onUse,
}: {
  credit: RateLimitResetCredit | null;
  index: number;
  now: number;
  action: ResetActionState;
  error: string | null;
  disabled: boolean;
  canUse: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUse: () => void;
}) {
  useLocale();
  return (
    <article className="rounded-lg bg-content/[0.04] px-2.5 py-2 ring-1 ring-inset ring-content/[0.06]">
      <h4 className="text-[10px] font-medium leading-4 text-content/70">
        {credit?.title ?? t("Banked reset {p0}", { p0: index + 1 })}
      </h4>
      {credit?.description ? (
        <p className="mt-0.5 text-[10px] leading-4 text-content/45">{credit.description}</p>
      ) : null}
      <div className="mt-1.5 flex min-h-6 items-center justify-between gap-2">
        <p
          className="min-w-0 truncate text-[10px] tabular-nums text-content/40"
          title={
            credit?.expiresAt == null
              ? undefined
              : new Date(credit.expiresAt).toLocaleString(getLocale())
          }
        >
          {credit?.expiresAt == null
            ? t("Expiry not provided")
            : credit.expiresAt <= now
              ? t("Expires now")
              : t("Expires in {p0}", { p0: formatResetDuration(credit.expiresAt - now) })}
        </p>
        {action === "using" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] text-content/45">
            <RefreshCw className="size-3 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
            {t("Applying…")}
          </span>
        ) : isResetOutcome(action) || action === "error" ? (
          <span
            className={`shrink-0 text-[10px] ${
              action === "reset" ? "text-success dark:text-success" : "text-content/50"
            }`}
            role="status"
          >
            {action === "error" ? error : resetOutcomeLabel(action)}
          </span>
        ) : canUse && action !== "confirming" ? (
          <button
            type="button"
            className="h-6 shrink-0 rounded-md bg-content/[0.07] px-2.5 text-[10px] font-medium text-content/70 ring-1 ring-inset ring-content/[0.08] motion-safe:transition-[background-color,color,transform] duration-150 ease-out hover:bg-content/[0.11] hover:text-content active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35"
            disabled={disabled}
            onClick={onConfirm}
          >
            {t("Use reset")}
          </button>
        ) : null}
      </div>
      {action === "confirming" ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-content/[0.07] pt-2">
          <p className="text-[10px] leading-4 text-content/50">{t("Spend this reset now?")}</p>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="h-6 rounded-md px-2 text-[10px] text-content/50 hover:bg-content/10 hover:text-content"
              onClick={onCancel}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              className="h-6 rounded-md bg-content px-2.5 text-[10px] font-medium text-background-base motion-safe:transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={onUse}
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EmptyUsageState({ limits, loading }: { limits: ProviderRateLimits; loading: boolean }) {
  useLocale();
  return (
    <div className="rounded-lg bg-content/[0.04] px-3 py-4 text-center ring-1 ring-inset ring-content/[0.06]">
      <p className="text-[11px] font-medium text-content/65">
        {loading
          ? t("Loading usage…")
          : limits.status === "unavailable"
            ? t("Not connected")
            : t("Usage unavailable")}
      </p>
      {limits.error ? (
        <p className="mx-auto mt-1 max-w-[15rem] text-[10px] leading-4 text-content/40">
          {limits.error}
        </p>
      ) : null}
    </div>
  );
}

function updatedLabel(limits: ProviderRateLimits, now: number): string {
  if (limits.updatedAt <= 0) return t("Rate-limit details");
  const elapsedMinutes = Math.max(0, Math.floor((now - limits.updatedAt) / 60_000));
  if (elapsedMinutes === 0) return t("Updated just now");
  if (elapsedMinutes < 60) return t("Updated {p0}m ago", { p0: elapsedMinutes });
  return t("Updated {p0}h ago", { p0: Math.floor(elapsedMinutes / 60) });
}

function resetOutcomeLabel(outcome: CodexRateLimitResetOutcome): string {
  if (outcome === "reset") return t("Codex usage was reset.");
  if (outcome === "nothingToReset") return t("There’s no active usage to reset.");
  if (outcome === "noCredit") return t("No banked resets are available.");
  return t("That reset was already used.");
}

function isResetOutcome(value: ResetActionState): value is CodexRateLimitResetOutcome {
  return (
    value === "reset" ||
    value === "nothingToReset" ||
    value === "noCredit" ||
    value === "alreadyRedeemed"
  );
}

function emptyUsageLabel(limits: ProviderRateLimits): string {
  if (limits.status !== "error") return "—";
  const text = limits.error?.toLowerCase() ?? "";
  if (text.includes("expired") || text.includes("sign-in")) return "expired";
  return "—";
}

function MiniBar({ usedPct }: { usedPct: number }) {
  useLocale();
  const showRemaining = useShowRemainingUsage();
  const pct = clampUsedPercent(usedPct);
  return (
    <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-content/10" aria-hidden>
      <span
        className={`block h-full rounded-full ${barClass(pct)}`}
        style={{ width: `${showRemaining ? 100 - pct : pct}%` }}
      />
    </span>
  );
}
