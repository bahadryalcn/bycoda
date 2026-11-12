import {
  updatedLabel,
  usageErrorMessage,
  usageWindows,
  type UsageWindowEntry,
} from "./usageProviderLabels";
import { UsageWindowStat } from "./UsageWindowStat";
import { Text } from "../../shared/ui/Text";
import { motionAttributes } from "../../shared/ui/Motion";
import { Progress } from "../../shared/ui/Progress";
import { TextField } from "../../shared/ui/TextField";
import { useDismissPopover } from "../../shared/hooks/useDismissPopover";
import { useFormat, useLocale, useT } from "../../shared/i18n";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  clampUsedPercent,
  formatResetCountdownWith,
  formatResetDuration,
  formatUsagePercent,
  formatWindowLabel,
  rateLimitWindowTooltipWith,
  type ProviderRateLimits,
  type RateLimitResetCredit,
  type RateLimitWindow,
} from "../../features/providers/model/rateLimits";
import type { CodexRateLimitResetOutcome } from "../../features/providers/model/rateLimitsFetch";
import {
  FULL_DATE_TIME,
  isResetOutcome,
  resetOutcomeLabel,
  type ResetActionState,
} from "./usageResetModel";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { projectMascot } from "../../features/projects/model/projectMascots";
import { projectKey, projectName } from "../../shared/lib/paths";
import { HARNESS_TITLE, type HarnessId } from "../../features/sessions/model/session";
import {
  useTabGroupColors,
  useTabGroupCustomColors,
  useTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import { HarnessIcon } from "../../features/sessions/ui/HarnessIcon";
import { ArrowLeft, Check, ChevronRight, Plus, RefreshCw } from "../../shared/ui/icons";
import { Popover } from "../../shared/ui/Popover";
import { Badge } from "../../shared/ui/Badge";
import { InlineError } from "../../shared/ui/InlineError";
import { Spinner } from "../../shared/ui/Spinner";
import { Heading } from "../../shared/ui/Heading";
import { SectionLabel } from "../../shared/ui/SectionLabel";
import { surfaceAttributes, Surface } from "../../shared/ui/Surface";
import { Tooltip } from "../../shared/ui/Tooltip";
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
  meterWindowsWith,
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
type UsageProviderChipProps = {
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
};
export function UsageProviderChip(props: UsageProviderChipProps) {
  const { limits, now, accounts = [], accountId, presentation } = props;
  const t = useT();
  const format = useFormat();
  const showRemaining = useShowRemainingUsage();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Browsing usage never changes the account pinned to a conversation.
  const [usageAccountId, setUsageAccountId] = useState<string | null>(null);
  const loading =
    limits.status === "idle" ||
    (limits.status === "fetching" && !limits.session && !limits.weekly && !limits.monthly);
  const disconnected = limits.status === "unavailable";
  const windows = usageWindows(limits);
  const tooltip = windows
    .map((entry) => rateLimitWindowTooltipWith(entry.window, now, showRemaining, t, format))
    .join(" · ");
  const providerLabel = presentation?.label ?? HARNESS_TITLE[limits.provider];
  const iconHarness = presentation?.harness ?? limits.provider;
  const activeAccount = accounts.find((account) => account.id === accountId);
  const dismiss = useDismissPopover(setOpen, trigger);
  return (
    <>
      <Button
        variant="ghost"
        motion="none"
        ref={trigger}
        type="button"
        size="sm"
        className="min-w-0 shrink-0 gap-1.5 whitespace-nowrap"
        aria-label={t("{p0} usage details", { p0: providerLabel })}
        aria-expanded={open}
        aria-haspopup="dialog"
        tooltip={
          tooltip ||
          limits.error ||
          (disconnected ? t("Not connected") : loading ? t("Loading usage…") : t("Usage details"))
        }
        onClick={() => setOpen((value) => !value)}
      >
        <HarnessIcon harness={iconHarness} className="icon-sm shrink-0" />
        {accounts.length > 1 && activeAccount ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <AccountColorDot account={activeAccount} className="size-1.5" />
            <Text size="inherit" tone="secondary" truncate className="max-w-24">
              {activeAccount.label}
            </Text>
          </span>
        ) : null}
        {loading ? (
          <UnknownUsageBar label={t("Loading usage…")} loading />
        ) : disconnected ? (
          <Text size="inherit" tone="secondary">
            {t("not connected")}
          </Text>
        ) : windows.length === 0 ? (
          <UnknownUsageBar label={limits.error ?? t("Usage unavailable")} />
        ) : (
          <span className="flex min-w-0 items-center gap-2 tabular-nums">
            {windows.map((entry, index) => (
              <Fragment key={entry.key}>
                {index > 0 ? (
                  <Text aria-hidden="true" size="inherit" tone="secondary">
                    ·
                  </Text>
                ) : null}
                <UsageWindowStat window={entry.window} now={now} />
              </Fragment>
            ))}
          </span>
        )}
      </Button>
      {open ? (
        <UsageProviderDetails
          {...props}
          trigger={trigger}
          dismiss={dismiss}
          close={() => setOpen(false)}
          usageAccountId={usageAccountId}
          setUsageAccountId={setUsageAccountId}
        />
      ) : null}
    </>
  );
}
/**
 * Popover body: view, reset and sign-in state start fresh on each open, without a reset effect.
 */
function UsageProviderDetails({
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
  trigger,
  dismiss,
  close,
  usageAccountId,
  setUsageAccountId,
}: UsageProviderChipProps & {
  trigger: RefObject<HTMLButtonElement | null>;
  dismiss: (reason: string) => void;
  close: () => void;
  usageAccountId: string | null;
  setUsageAccountId: (accountId: string | null) => void;
}) {
  const t = useT();
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
    if (usageOnly && viewingOtherAccount) {
      void loadRateLimits(limits.provider, detailAccountId);
    }
  }, [usageOnly, viewingOtherAccount, limits.provider, detailAccountId]);
  const [accountView, setAccountView] = useState<"usage" | "accounts" | "add">("usage");
  const [resetAction, setResetAction] = useState<ResetActionState>("idle");
  const [activeResetKey, setActiveResetKey] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [reconnectState, setReconnectState] = useState<ProviderSignInState>("idle");
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const loginView = Boolean(
    onReconnect &&
    !viewingOtherAccount &&
    detailWindows.length === 0 &&
    (needsProviderLogin(detailLimits) || reconnectState !== "idle"),
  );
  const providerLabel = presentation?.label ?? HARNESS_TITLE[limits.provider];
  const iconHarness = presentation?.harness ?? limits.provider;
  const activeAccount = accounts.find((account) => account.id === accountId);
  const canManageAccounts = !usageOnly && Boolean(onSelectAccount && onAddAccount);
  const activeAccountLabel = activeAccount?.label ?? t("Removed account");
  const identities = useProviderAccountIdentities(
    accounts,
    `${limits.updatedAt}:${reconnectState}`,
  );
  const activeIdentity = activeAccount ? identities[identityKey(activeAccount)] : null;
  const accountProvider = supportsProviderAccounts(limits.provider) ? limits.provider : undefined;
  const otherAccounts = accounts.filter((account) => account.id !== accountId);
  const accountUsage = useProviderAccountUsage(accounts.map((account) => account.id).join("|"), {
    provider: accountProvider,
    enabled: !usageOnly && Boolean(accountProvider) && otherAccounts.length > 0,
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
  const mascotName = resolveTabGroupMascot(appearanceKey, useTabGroupMascots());
  const mascotColor = resolveTabGroupColor(
    appearanceKey,
    useTabGroupColors(),
    useTabGroupCustomColors(),
    mascotProject,
  );
  const useReset = async (credit: RateLimitResetCredit | undefined, rowKey: string) => {
    if (!onConsumeReset || viewingOtherAccount) return;
    setActiveResetKey(rowKey);
    setResetAction("using");
    setResetError(null);
    const creditId = credit?.id;
    try {
      setResetAction(await onConsumeReset(creditId));
    } catch (error) {
      setResetError(usageErrorMessage(error, "Could not use this reset"));
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
      setReconnectError(usageErrorMessage(error, "Could not complete sign-in"));
      setReconnectState("error");
    }
  };
  return (
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
      className={`overflow-y-auto ${accountView === "usage" && loginView && !canBrowseUsage ? "" : "p-2.5"}`}
    >
      <Text as="div" size="inherit" tone="primary">
        {canBrowseUsage ? (
          <div role="group" aria-label={t("Accounts")} className="mbe-2 flex flex-wrap gap-1">
            {accounts.map((account) => (
              <Button
                key={account.id}
                variant="tab"
                aria-pressed={account.id === detailAccountId}
                tooltip={account.label}
                tooltipWhen="overflow"
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
                <Text size="inherit" tone="inherit" truncate className="min-w-0">
                  {account.label}
                </Text>
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
                    close();
                    onManageAccounts();
                  }
                : undefined
            }
            onSelect={(nextAccountId) => {
              onSelectAccount?.(nextAccountId);
              close();
            }}
          />
        ) : accountView === "add" ? (
          <AddProviderAccount
            providerLabel={providerLabel}
            onBack={() => setAccountView("accounts")}
            onAdd={onAddAccount}
            onComplete={() => close()}
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
            <div className="flex items-start gap-2 px-1 pb-2 pt-0.5">
              <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-(--ui-surface-muted) ring-1 ring-inset ring-(--color-stroke)">
                <HarnessIcon harness={iconHarness} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <Heading size="item" level={2}>
                  {providerLabel}
                  {t(" usage")}
                </Heading>
                <Text as="p" size="caption" tone="secondary" className="mt-0.5">
                  {updatedLabel(detailLimits, now, t)}
                </Text>
                {presentation?.sourceLabel ? (
                  <Text as="p" size="caption" tone="secondary" className="mt-0.5">
                    {presentation.sourceLabel}
                  </Text>
                ) : null}
                {canManageAccounts ? (
                  <Text
                    as="div"
                    size="caption"
                    tone="secondary"
                    {...surfaceAttributes(
                      { radius: "sm" },
                      "pointer-events-none relative mt-1 -ml-1 inline-flex max-w-full items-center gap-1 px-1 py-0.5",
                    )}
                  >
                    {/* Keep account switching separate from email revelation. */}
                    <Button
                      variant="ghost"
                      motion="none"
                      type="button"
                      className="pointer-events-auto absolute inset-0"
                      aria-label={t("Switch {p0} account", { p0: providerLabel })}
                      onClick={() => setAccountView("accounts")}
                    />
                    {activeAccount ? (
                      <AccountColorDot account={activeAccount} className="size-1.5" />
                    ) : null}
                    <Text size="inherit" tone="inherit" truncate className="max-w-[60%] shrink-0">
                      {activeAccountLabel}
                    </Text>
                    <ProviderAccountSubtitle
                      key={activeAccount && identityKey(activeAccount)}
                      identity={activeIdentity}
                      tone="secondary"
                    />
                    <ChevronRight className="size-2.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  </Text>
                ) : null}
              </div>
              {detailLimits.status === "fetching" ? (
                <Text
                  size="caption"
                  tone="secondary"
                  className="mt-0.5 inline-flex items-center gap-1"
                >
                  <RefreshCw
                    className="size-2.5 motion-safe:animate-spin"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {t("Updating")}
                </Text>
              ) : null}
            </div>
            {detailLimits.status === "error" && detailWindows.length > 0 ? (
              <Text
                as="p"
                size="caption"
                tone="warning"
                className="mb-2 rounded-(--ui-radius-card) bg-(--ui-tone-warning-subtle) px-2.5 py-2"
              >
                {t("Couldn’t refresh. Showing the last available snapshot.")}
              </Text>
            ) : null}
            {detailWindows.length > 0 ? (
              <div className="flex flex-col gap-2.5">
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
                  close();
                }}
              />
            ) : null}
            {limits.provider === "codex" || limits.provider === "claude" ? (
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
                // Claude resets are spent with /limit-reset in Claude Code, not from here.
                canUse={
                  limits.provider === "codex" && !viewingOtherAccount && Boolean(onConsumeReset)
                }
              />
            ) : null}
          </>
        )}
      </Text>
    </Popover>
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
  const t = useT();
  return (
    <div className="px-2.5 pt-2.5">
      <Button
        variant="ghost"
        motion="none"
        type="button"
        className="flex w-full items-center gap-2"
        aria-label={t("Switch account from {p0}", { p0: accountLabel })}
        onClick={onClick}
      >
        {account ? <AccountColorDot account={account} /> : null}
        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {accountLabel}
        </Text>
        <Text size="caption" tone="secondary">
          {t("Switch account")}
        </Text>
        <ChevronRight className="icon-xs shrink-0" tone="secondary" aria-hidden />
      </Button>
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
  const t = useT();
  const statusId = useId();
  return (
    <div>
      <div className="flex h-7 items-center gap-1">
        <Button
          iconOnly
          label={t("Back to usage")}
          variant="ghost"
          motion="none"
          type="button"
          className="grid place-items-center"
          aria-label={t("Back to usage")}
          onClick={onBack}
        >
          <ArrowLeft className="icon-sm" aria-hidden />
        </Button>
        <Heading size="item" level={2}>
          {providerLabel}
          {t(" accounts")}
        </Heading>
      </div>
      <Text as="p" size="caption" tone="secondary" className="mt-1 px-1">
        {t("Applies to this conversation only; new ones use the default account.")}
      </Text>
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
          const meters = meterWindowsWith(usage, t);
          return (
            <Text
              as="div"
              key={account.id}
              size="micro"
              tone={selected ? "primary" : "secondary"}
              {...motionAttributes(
                { transition: "colors", duration: "standard" },
                `pointer-events-none relative flex w-full items-center gap-3 rounded-(--ui-radius-card) px-2.5 py-2 text-left ring-1 ring-inset ${
                  selected
                    ? "bg-(--ui-surface-selected) ring-(--ui-tone-accent-border)"
                    : "bg-(--ui-surface-muted) ring-(--color-stroke)"
                }`,
              )}
            >
              {/* A sibling target keeps the email button out of the selection button. */}
              <Button
                variant="ghost"
                motion="none"
                type="button"
                aria-pressed={selected}
                aria-label={account.label}
                aria-describedby={`${statusId}-${account.id}`}
                className="pointer-events-auto absolute inset-0"
                onClick={() => onSelect(account.id)}
              />
              <span className="min-w-0 flex-1 py-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <AccountColorDot account={account} />
                  <Text size="inherit" tone="inherit" truncate className="shrink-0">
                    {account.label}
                  </Text>
                  <ProviderAccountSubtitle identity={identity} size="caption" tone="secondary" />
                  {orgTag ? (
                    <Badge size="xs" truncate className="max-w-24 shrink-0">
                      {orgTag}
                    </Badge>
                  ) : null}
                </span>
                <Text
                  size="caption"
                  tone="inherit"
                  className="mt-1 flex min-w-0 items-center gap-3"
                >
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
                </Text>
              </span>
              {selected ? <Check className="icon-sm shrink-0" tone="accent" aria-hidden /> : null}
            </Text>
          );
        })}
      </div>
      <Button
        variant="ghost"
        motion="none"
        type="button"
        className="mt-2 flex w-full items-center gap-2"
        onClick={onAdd}
      >
        <Plus className="icon-sm" aria-hidden />
        {t("Add account")}
      </Button>
      {onManage ? (
        <Button
          variant="ghost"
          motion="none"
          type="button"
          className="mt-0.5 flex w-full items-center gap-2"
          onClick={() => {
            onManage();
          }}
        >
          {t("Manage accounts…")}
        </Button>
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
  const t = useT();
  return (
    <Surface variant="outline" padding="md" as="section" className="mt-2 flex items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <Text as="p" size="caption" tone="secondary">
          {exhausted ? t("Out of usage") : t("Running low")}
          {t(" · switch to")}
        </Text>
        <Text as="p" size="micro" tone="inherit" className="mt-0.5 flex min-w-0 items-center gap-2">
          <AccountColorDot account={account} />
          <Text size="inherit" tone="inherit" weight="medium" truncate className="min-w-0">
            {account.label}
          </Text>
          <AccountStatusLabel status={accountStatus(limits, now)} size="caption" />
        </Text>
      </div>
      <Button variant="ghost" motion="none" type="button" className="shrink-0" onClick={onSwitch}>
        {t("Switch account")}
      </Button>
    </Surface>
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
  const t = useT();
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
        <Button
          iconOnly
          label={t("Back to accounts")}
          variant="ghost"
          motion="none"
          type="button"
          className="grid place-items-center"
          aria-label={t("Back to accounts")}
          disabled={running}
          onClick={onBack}
        >
          <ArrowLeft className="icon-sm" aria-hidden />
        </Button>
        <Heading size="item" level={2}>
          {t("Add ")}
          {providerLabel}
          {t(" account")}
        </Heading>
      </div>
      <Text as="p" size="caption" tone="secondary" className="mt-1 px-1">
        {t("Give this account a local name, then finish sign-in in your browser.")}
      </Text>
      <TextField
        fieldClassName="mt-3 min-w-0 flex-1"
        label={t("Account name")}
        autoFocus
        type="text"
        maxLength={48}
        value={label}
        disabled={running}
        placeholder={t("Work or Personal")}
        className="w-full"
        onChange={(event) => setLabel(event.target.value)}
      />
      <Button
        variant="ghost"
        motion="none"
        type="submit"
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5"
        disabled={running || !label.trim()}
      >
        {running ? <Spinner /> : null}
        {running ? t("Waiting for browser…") : t("Sign in and add account")}
      </Button>
      {error ? (
        <InlineError live="polite" className="mt-2">
          {error}
        </InlineError>
      ) : null}
    </form>
  );
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
  const t = useT();
  const format = useFormat();
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
    <section className="px-1">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel as="h3" size="micro">
          {t(title)}
        </SectionLabel>
      </div>
      <Progress
        showValue
        valuePlacement="inside"
        valueLabel={`${formatUsagePercent(shown)} ${showRemaining ? t("remaining") : t("used")}`}
        className="mbs-1.5"
        aria-label={`${title} ${showRemaining ? "remaining" : "used"}`}
        value={Math.round(shown)}
        tone={pct >= 90 ? "danger" : pct >= 80 ? "warning" : "neutral"}
      />
      <Text
        as="div"
        size="caption"
        tone="secondary"
        className="mbs-1.5 flex items-center justify-between gap-3"
      >
        <span className="tabular-nums">
          {formatUsagePercent(showRemaining ? pct : remaining)}{" "}
          {showRemaining ? t("used") : t("remaining")}
        </span>
        <Tooltip
          label={
            window.resetsAt == null ? undefined : format.formatDate(window.resetsAt, FULL_DATE_TIME)
          }
        >
          <Text size="inherit" tone="inherit" truncate className="text-right tabular-nums">
            {window.resetsAt == null
              ? t("{p0} window", { p0: formatWindowLabel(window.windowMinutes) })
              : formatResetCountdownWith(window.resetsAt - now, t, format)}
          </Text>
        </Tooltip>
      </Text>
    </section>
  );
}
function EmptyUsageState({ limits, loading }: { limits: ProviderRateLimits; loading: boolean }) {
  const t = useT();
  return (
    <Surface variant="outline" className="flex flex-col gap-2" role="status">
      <Text size="micro" tone="inherit" weight="medium">
        {loading
          ? t("Loading usage…")
          : limits.status === "unavailable"
            ? t("Not connected")
            : t("Usage unavailable")}
      </Text>
      <UnknownUsageBar
        label={loading ? t("Loading usage…") : t("Usage unavailable")}
        loading={loading}
      />
      {limits.error ? <InlineError live="off">{limits.error}</InlineError> : null}
    </Surface>
  );
}
function UnknownUsageBar({ label, loading = false }: { label: string; loading?: boolean }) {
  return (
    <Tooltip label={label}>
      <Text
        aria-label={label}
        size="caption"
        tone="secondary"
        {...surfaceAttributes(
          { radius: "sm" },
          "inline-flex h-4 min-w-12 items-center justify-center border border-dashed border-(--color-stroke) bg-(--ui-surface-muted) px-1",
        )}
      >
        {loading ? "···" : "?"}
      </Text>
    </Tooltip>
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
  const t = useT();
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
  // Provider titles only stay when they tell different kinds of reset apart.
  const showTitles = new Set(rows.map((credit) => credit?.title?.trim() ?? "")).size > 1;
  const refreshing = limits.status === "fetching";
  return (
    <section {...surfaceAttributes({ frame: "stroke", edge: "top" }, "mbs-2 pbs-1.5")}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <SectionLabel as="h3" size="micro">
            {t("Banked resets")}
          </SectionLabel>
          <Badge
            variant="count"
            size="xs"
            tone="neutral"
            label={t("{p0} available", { p0: count })}
          >
            {count}
          </Badge>
          {refreshing ? (
            <Text
              size="caption"
              tone="secondary"
              className="inline-flex items-center gap-1"
              role="status"
            >
              <Spinner size="xs" />
              {t("Checking…")}
            </Text>
          ) : null}
        </div>
        <BankedResetMascot project={mascotProject} name={mascotName} color={mascotColor} />
      </div>
      <div
        className="mt-0.5 max-h-56 overflow-y-auto overscroll-contain"
        role="list"
        aria-label={t("Available banked resets")}
      >
        <div className="flex flex-col divide-y divide-stroke">
          {rows.map((credit, index) => {
            const rowKey = credit?.id ?? `unlisted-${index}`;
            const selected = activeResetKey === rowKey;
            return (
              <BankedResetRow
                key={rowKey}
                credit={credit}
                showTitle={showTitles}
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
      className="grid size-5 shrink-0 place-items-center"
      data-reset-mascot-mood="happy"
      data-mascot-name={mascot.name}
      style={{ color }}
      aria-hidden
    >
      <ProjectMascot project={project} name={name} color={color} className="size-5" />
    </div>
  );
}
function BankedResetRow({
  credit,
  showTitle,
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
  showTitle: boolean;
  now: number;
  action: ResetActionState;
  error: string | null;
  disabled: boolean;
  canUse: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUse: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const outcome = isResetOutcome(action) || action === "error";
  const retryable = action === "error";
  return (
    <article role="listitem" className="px-1 py-0.5">
      {showTitle && credit?.title ? <SectionLabel as="h4">{credit.title}</SectionLabel> : null}
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Tooltip
          label={
            credit?.expiresAt == null
              ? undefined
              : format.formatDate(credit.expiresAt, FULL_DATE_TIME)
          }
        >
          <Text as="p" size="caption" tone="secondary" truncate className="min-w-0 tabular-nums">
            {credit?.expiresAt == null
              ? t("Expiry not provided")
              : credit.expiresAt <= now
                ? t("Expired")
                : t("Expires in {p0}", { p0: formatResetDuration(credit.expiresAt - now) })}
          </Text>
        </Tooltip>
        {action === "using" ? (
          <Text
            size="caption"
            tone="secondary"
            className="inline-flex shrink-0 items-center gap-1.5"
          >
            <Spinner size="xs" />
            {t("Applying…")}
          </Text>
        ) : canUse && action !== "confirming" && (!outcome || retryable) ? (
          <Button
            variant="ghost"
            motion="none"
            type="button"
            className="shrink-0 disabled:pointer-events-none"
            disabled={disabled}
            onClick={onConfirm}
          >
            {retryable ? t("Try again") : t("Use reset")}
          </Button>
        ) : null}
      </div>
      {outcome ? (
        <Text
          as="p"
          size="caption"
          tone={action === "reset" ? "success" : "secondary"}
          className="mt-0.5 break-words"
          role="status"
        >
          {action === "error" ? error : resetOutcomeLabel(action, t)}
        </Text>
      ) : null}
      {action === "confirming" ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <Text as="p" size="caption" tone="secondary">
            {t("Spend this reset now?")}
          </Text>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" motion="none" type="button" className="" onClick={onCancel}>
              {t("Cancel")}
            </Button>
            <Button variant="ghost" motion="none" type="button" className="" onClick={onUse}>
              {t("Confirm")}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
