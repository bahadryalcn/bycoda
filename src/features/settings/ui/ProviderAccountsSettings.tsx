import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import { Group, Row, SettingsFeedback } from "./settingsControls";
import { Badge } from "../../../shared/ui/Badge";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { MoreHorizontal, Plus, UserRound, Briefcase, Check } from "../../../shared/ui/icons";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";

import { loginHarness } from "../../../integrations/harness/core/auth";

import { HARNESS_TITLE, type HarnessId } from "../../sessions";

import {
  newProviderAccount,
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  editProviderAccount,
  setDefaultProviderAccount,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isTerminalProviderAccount,
  subscribeProviderAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import {
  removeProviderAccountCredentials,
  signOutProviderAccountCredentials,
} from "../../providers/model/providerAccountCredentials";
import {
  assertUniqueProviderAccount,
  registerProviderAccount,
} from "../../providers/model/providerAccountRegistration";
import {
  duplicateAccountSignIns,
  identityKey,
  identityOrganizationTag,
  useProviderAccountIdentities,
} from "../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../providers/ui/ProviderAccountSubtitle";
import { AccountColorPopover } from "../../providers/ui/AccountColorPicker";
import { AccountColorDot } from "../../providers/ui/AccountColorDot";
import { exhaustedExplanation, useGrokSignInState } from "../../providers/ui/providerStatus";

import {
  accountStatus,
  accountUsageKey,
  needsProviderLogin,
  providerAccountSignedOut,
  useProviderAccountUsage,
} from "../../providers/model/accountUsage";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import { clearCachedRateLimits, loadRateLimits } from "../../providers/model/rateLimitsCache";
import { AccountStatusLabel, AccountUsageRefresh } from "../../providers/ui/ProviderAccountUsage";

import { AntigravityAccountSettings } from "./AntigravityAccountSettings";
import { TerminalProfileDiscovery } from "./TerminalProfileDiscovery";
import { ProviderAccountEditor, type AccountEditor } from "./ProviderAccountEditor";
import { Button } from "../../../shared/ui/Button";
import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";

const SETTINGS_HARNESSES: readonly HarnessId[] = [
  ...PROVIDER_ACCOUNT_PROVIDERS,
  "cursor",
  "grok",
  "antigravity",
];

/** Serialized account list: changes whenever any provider's accounts change in this or another window. */
const providerAccountsSnapshot = () =>
  JSON.stringify(PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts));

export function ProviderAccountsSettings({
  harness,
  onBusyChange,
  onStandaloneSignIn,
}: {
  harness?: HarnessId;
  onBusyChange?: (busy: boolean) => void;
  onStandaloneSignIn?: (provider: HarnessId | null) => void;
}) {
  useLocale();
  const accountsRevision = useSyncExternalStore(
    subscribeProviderAccounts,
    providerAccountsSnapshot,
    providerAccountsSnapshot,
  );
  // Local refreshes cover sign-in and removal results the account list itself does not show.
  const [refreshes, setVersion] = useState(0);
  const version = `${refreshes}|${accountsRevision}`;
  const [editor, setEditorState] = useState<AccountEditor | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ProviderAccount | null>(null);
  // The overflow menu and the colour popover share the row's menu button as their anchor.
  const [menu, setMenu] = useState<{
    account: ProviderAccount;
    anchor: HTMLElement;
  } | null>(null);
  const [colorFor, setColorFor] = useState<{
    account: ProviderAccount;
    anchor: HTMLElement;
  } | null>(null);
  const busy = useRef(false);
  const pendingAccount = useRef<ProviderAccount | null>(null);
  const registrationAbort = useRef<AbortController | null>(null);
  const editorOpen = useRef(false);
  // The parent hears about busy where it changes: an operation starts or ends, or the editor opens or closes.
  const setEditor = (next: AccountEditor | null) => {
    editorOpen.current = next !== null;
    setEditorState(next);
    onBusyChange?.(busy.current || editorOpen.current);
  };
  useEffect(
    () => () => {
      registrationAbort.current?.abort();
      onBusyChange?.(false);
    },
    [onBusyChange],
  );

  const cancelEditor = () => {
    if (registrationAbort.current) {
      registrationAbort.current.abort();
      return;
    }
    if (!busy.current) setEditor(null);
  };

  const supportedHarness = !harness || SETTINGS_HARNESSES.includes(harness);

  const begin = (key: string) => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(key);
    onBusyChange?.(true);
    setError(null);
    onStandaloneSignIn?.(null);
    return true;
  };
  const finish = () => {
    busy.current = false;
    setWorking(null);
    onBusyChange?.(editorOpen.current);
  };

  const startAdd = (provider: ProviderAccountProvider) => {
    if (busy.current) return;
    pendingAccount.current = null;
    setError(null);
    setEditor({ provider, label: "" });
  };

  const startRename = (account: ProviderAccount) => {
    if (busy.current) return;
    setError(null);
    setEditor({
      provider: account.provider,
      accountId: account.id,
      label: account.label,
      color: account.color,
      kind: account.kind,
    });
  };

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !editor.label.trim()) return;
    const key = editor.accountId
      ? `rename:${editor.provider}:${editor.accountId}`
      : `add:${editor.provider}`;
    if (!begin(key)) return;
    try {
      if (editor.accountId) {
        if (!editProviderAccount(editor.provider, editor.accountId, editor))
          throw new Error("Account no longer exists");
      } else {
        const account = pendingAccount.current ?? newProviderAccount(editor.provider, editor.label);
        account.label = editor.label;
        pendingAccount.current = account;
        const controller = new AbortController();
        registrationAbort.current = controller;
        await registerProviderAccount(account, controller.signal);
        pendingAccount.current = null;
      }
      setEditor(null);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        pendingAccount.current = null;
        setEditor(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save this account");
      }
    } finally {
      registrationAbort.current = null;
      finish();
    }
  };

  const signInAccount = async (account: ProviderAccount) => {
    if (!begin(`signin:${account.provider}:${account.id}`)) return;
    try {
      await (account.id === DEFAULT_PROVIDER_ACCOUNT_ID
        ? loginHarness(account.provider)
        : loginHarness(account.provider, account.id));
      try {
        if (!isTerminalProviderAccount(account.id)) await assertUniqueProviderAccount(account);
      } catch (caught) {
        // A re-login can change the identity of an existing profile as well.
        await signOutProviderAccountCredentials(account.provider, account.id);
        clearCachedRateLimits(account.provider, account.id);
        throw caught;
      }
      setVersion((value) => value + 1);
      clearCachedRateLimits(account.provider, account.id);
      const limits = await loadRateLimits(account.provider, account.id, true);
      if (needsProviderLogin(limits)) {
        throw new Error(
          limits.error || `${HARNESS_TITLE[account.provider]} sign-in could not be verified`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete sign-in");
    } finally {
      setVersion((value) => value + 1);
      finish();
    }
  };

  const removeAccountMessage = (account: ProviderAccount) =>
    account.id.startsWith("terminal-")
      ? t(
          "Disconnect “{p0}”? Running turns for this account will stop. Its terminal sign-in, settings and conversation history stay intact.",
          { p0: account.label },
        )
      : account.id === DEFAULT_PROVIDER_ACCOUNT_ID
        ? t(
            "Remove “{p0}”? This signs out of the shared {p1} CLI profile and stops its running turns. CLI settings and conversation history stay on disk.",
            { p0: account.label, p1: HARNESS_TITLE[account.provider] },
          )
        : t(
            "Remove “{p0}”? Its stored credentials will be deleted and any running turns for this account will stop. Existing conversations stay in history, but cannot continue until you switch accounts.",
            { p0: account.label },
          );

  const removeAccount = async (account: ProviderAccount) => {
    const key = `remove:${account.provider}:${account.id}`;
    if (!begin(key)) return;
    try {
      await removeProviderAccountCredentials(account.provider, account.id);
      clearCachedRateLimits(account.provider, account.id);
      setVersion((value) => value + 1);
      removeProviderAccount(account.provider, account.id);
      if (editor?.provider === account.provider && editor.accountId === account.id) {
        setEditor(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove this account");
    } finally {
      finish();
    }
  };

  const makeDefault = (account: ProviderAccount) => {
    if (!begin(`default:${account.provider}:${account.id}`)) return;
    try {
      setDefaultProviderAccount(account.provider, account.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not set default account");
    } finally {
      finish();
    }
  };

  const signInStandaloneProvider = async (provider: "cursor" | "grok") => {
    if (!begin(`signin:${provider}`)) return;
    try {
      await loginHarness(provider);
      onStandaloneSignIn?.(provider);
      try {
        await probeHarnessAvailability({ force: true });
        await refreshHarnessCatalogs([provider], { force: true });
      } catch (refreshError) {
        console.debug(`[bycoda] ${provider} post-login refresh`, refreshError);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete sign-in");
    } finally {
      finish();
    }
  };

  const identities = useProviderAccountIdentities(
    harness
      ? supportsProviderAccounts(harness)
        ? providerAccounts(harness)
        : []
      : PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts),
    version,
  );
  const usage = useProviderAccountUsage(version, {
    provider: harness && supportsProviderAccounts(harness) ? harness : undefined,
    enabled: !harness || supportsProviderAccounts(harness),
  });
  const standaloneHarness = harness === "cursor" || harness === "grok" ? harness : null;
  const grokSignedIn =
    useGrokSignInState(harness === "grok" && isHarnessAvailable("grok")).tone === "ready";
  const standaloneSignedIn = standaloneHarness === "grok" && grokSignedIn;
  const accountProvider = harness
    ? supportsProviderAccounts(harness)
      ? harness
      : null
    : PROVIDER_ACCOUNT_PROVIDERS[0];

  const accountMenuItems = (account: ProviderAccount): DropdownMenuItem[] => [
    { kind: "item", id: "rename", label: t("Edit account") },
    ...(account.isDefault
      ? []
      : [{ kind: "item" as const, id: "default", label: t("Make default") }]),
    { kind: "item", id: "color", label: t("Color…") },
    { kind: "sep" },
    { kind: "item", id: "remove", label: t("Remove account…"), danger: true },
  ];

  return (
    <div hidden={!supportedHarness}>
      <div hidden={harness === "antigravity"}>
        <Group
          id="provider-accounts"
          layout="full"
          title={t(harness === "cursor" || harness === "grok" ? "Sign in" : "Accounts")}
          action={
            accountProvider ? (
              <div
                className="provider-accounts-actions"
                aria-busy={Boolean(working) || usage.refreshing}
              >
                <Button
                  size="sm"
                  disabled={Boolean(working)}
                  onClick={() => startAdd(accountProvider)}
                >
                  <Plus className="icon-sm" strokeWidth={1.75} aria-hidden />
                  {t("Add account")}
                </Button>
                <AccountUsageRefresh
                  usage={{
                    ...usage,
                    refreshing: usage.refreshing || Boolean(working),
                    refresh: () => {
                      setVersion((value) => value + 1);
                      usage.refresh();
                    },
                  }}
                />
                <TerminalProfileDiscovery
                  key={accountProvider}
                  provider={accountProvider}
                  disabled={Boolean(working)}
                />
              </div>
            ) : undefined
          }
          feedback={error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : undefined}
        >
          {PROVIDER_ACCOUNT_PROVIDERS.map((provider) => {
            const accounts = providerAccounts(provider);
            const adding = editor?.provider === provider && !editor.accountId;
            const duplicates = duplicateAccountSignIns(accounts, identities);
            return (
              <div
                key={provider}
                data-settings-part="account-list"
                hidden={Boolean(harness && provider !== harness)}
                {...surfaceAttributes(
                  { layout: "settings-account-list" },
                  "provider-accounts-body",
                )}
              >
                {accounts.map((account) => {
                  const autoDefaultLabel =
                    account.id === DEFAULT_PROVIDER_ACCOUNT_ID &&
                    account.label === "Default account";
                  const displayLabel = autoDefaultLabel ? t("Default account") : account.label;
                  const editing = editor?.provider === provider && editor.accountId === account.id;
                  const removing = working === `remove:${provider}:${account.id}`;
                  const signingIn = working === `signin:${provider}:${account.id}`;
                  const identity = identities[identityKey(account)];
                  const orgTag =
                    account.kind === "personal"
                      ? t("Personal")
                      : account.kind === "work"
                        ? t("Work")
                        : identityOrganizationTag(identity);
                  const limits = usage.usage[accountUsageKey(account)];
                  const signedOut = Boolean(limits && canSignIn(limits));
                  const duplicateOf = duplicates[identityKey(account)];
                  const status = accountStatus(limits, usage.now);
                  const exhausted = !signedOut && status.tone === "exhausted";
                  const menuOpen =
                    menu?.account.id === account.id && menu.account.provider === provider;
                  return editing ? (
                    <Modal
                      key={account.id}
                      size="sm"
                      title={t("Edit account")}
                      onClose={cancelEditor}
                    >
                      <ProviderAccountEditor
                        key={account.id}
                        editor={editor}
                        identity={identity}
                        existingLabels={accounts
                          .filter((other) => other.id !== account.id)
                          .map((other) => other.label)}
                        working={Boolean(working)}
                        onLabel={(label) =>
                          setEditorState((current) => (current ? { ...current, label } : current))
                        }
                        onMetadata={(metadata) =>
                          setEditorState((current) =>
                            current ? { ...current, ...metadata } : current,
                          )
                        }
                        onCancel={cancelEditor}
                        onSubmit={submitEditor}
                      />
                    </Modal>
                  ) : (
                    <ActionHost
                      key={account.id}
                      variant="settings"
                      className="provider-account-row"
                      data-settings-part="account"
                    >
                      <AccountColorDot account={account} className="size-2.5" />
                      <div className="provider-account-main">
                        <div className="provider-account-identity">
                          <OverflowTooltip label={account.label}>
                            <Text
                              as="span"
                              size="secondary"
                              tone="primary"
                              weight="medium"
                              leading="inherit"
                              truncate
                              className="provider-account-name"
                            >
                              {displayLabel}
                            </Text>
                          </OverflowTooltip>
                          {account.isDefault && !autoDefaultLabel ? (
                            <Tooltip label={t("Default account")}>
                              <Text
                                tone="accent"
                                className="inline-flex shrink-0"
                                role="img"
                                aria-label={t("Default account")}
                                tabIndex={0}
                              >
                                <Check className="icon-sm" aria-hidden />
                              </Text>
                            </Tooltip>
                          ) : null}
                        </div>
                        <Text
                          as="div"
                          size="caption"
                          tone="inherit"
                          leading="inherit"
                          className="provider-account-meta"
                        >
                          <ProviderAccountSubtitle
                            identity={identity}
                            fallback={
                              isTerminalProviderAccount(account.id)
                                ? t("Provider CLI profile")
                                : account.id === DEFAULT_PROVIDER_ACCOUNT_ID
                                  ? t("Shared CLI profile")
                                  : t("Isolated profile")
                            }
                            tone="secondary"
                            truncate
                          />
                          {orgTag ? (
                            <OverflowTooltip label={orgTag}>
                              <Text
                                size="caption"
                                tone="secondary"
                                truncate
                                className="inline-flex min-w-0 items-center gap-1"
                              >
                                {account.kind === "work" ||
                                (account.kind !== "personal" && orgTag !== t("Personal")) ? (
                                  <Briefcase className="icon-xs shrink-0" aria-hidden />
                                ) : (
                                  <UserRound className="icon-xs shrink-0" aria-hidden />
                                )}
                                {orgTag}
                              </Text>
                            </OverflowTooltip>
                          ) : null}
                        </Text>
                        {exhausted ? (
                          <Text
                            as="p"
                            size="caption"
                            tone="secondary"
                            leading="normal"
                            className="provider-account-note"
                            role="note"
                          >
                            {exhaustedExplanation(limits, usage.now)}
                          </Text>
                        ) : null}
                        {duplicateOf ? (
                          <Text
                            leading="normal"
                            as="p"
                            size="caption"
                            tone="warning"
                            className="provider-account-note"
                            role="note"
                          >
                            {t("Same sign-in as ")}
                            {duplicateOf.label}
                            {t(". Remove this account if you do not need it separately.")}
                          </Text>
                        ) : null}
                      </div>
                      <div className="provider-account-status">
                        {signedOut ? (
                          <Badge size="sm" tone="warning" className="shrink-0">
                            {t("Signed out")}
                          </Badge>
                        ) : (
                          <AccountStatusLabel status={status} className="shrink-0" />
                        )}
                      </div>
                      <div className="provider-account-actions">
                        {signingIn || !limits || canSignIn(limits) ? (
                          <Button
                            reserveLabels={[t("Signing in…")]}
                            size="sm"
                            variant="secondary"
                            loading={signingIn}
                            disabled={Boolean(working)}
                            aria-label={t("Sign in to {p0}", {
                              p0: account.label,
                            })}
                            onClick={() => void signInAccount(account)}
                          >
                            {signingIn ? t("Signing in…") : t("Sign in")}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          iconOnly
                          label={t("Actions for {p0}", { p0: account.label })}
                          tooltip={t("Account actions")}
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          loading={removing}
                          disabled={Boolean(working)}
                          onClick={(event) => {
                            const anchor = event.currentTarget;
                            setMenu((current) =>
                              current?.account.id === account.id &&
                              current.account.provider === provider
                                ? null
                                : { account, anchor },
                            );
                          }}
                        >
                          <MoreHorizontal className="icon-md" strokeWidth={1.75} aria-hidden />
                        </Button>
                      </div>
                    </ActionHost>
                  );
                })}
                {accounts.length === 0 ? (
                  <EmptyState
                    size="inline"
                    kind="empty"
                    className="provider-account-empty"
                    data-settings-part="account-empty"
                    description={t("No accounts. Add an account to sign in.")}
                  />
                ) : null}
                {adding && editor ? (
                  <ProviderAccountEditor
                    editor={editor}
                    working={Boolean(working)}
                    onLabel={(label) =>
                      setEditorState((current) => (current ? { ...current, label } : current))
                    }
                    onCancel={cancelEditor}
                    onSubmit={submitEditor}
                  />
                ) : null}
              </div>
            );
          })}
          {standaloneHarness ? (
            <Row
              label={
                standaloneHarness === "cursor"
                  ? t("Use the Cursor CLI sign-in on this machine.")
                  : standaloneSignedIn
                    ? t("Signed in with the Grok Build CLI on this machine.")
                    : t("Use the Grok Build CLI sign-in on this machine.")
              }
            >
              {hasProbedHarnessAvailability() && !isHarnessAvailable(standaloneHarness) ? (
                <Text size="micro" tone="secondary">
                  {t("Install the CLI first, then sign in.")}
                </Text>
              ) : (
                <>
                  <Button
                    reserveLabels={[t("Signing in…")]}
                    variant={standaloneSignedIn ? "ghost" : "secondary"}
                    disabled={Boolean(working)}
                    loading={working === `signin:${standaloneHarness}`}
                    aria-label={t("Sign in to {p0}", {
                      p0: HARNESS_TITLE[standaloneHarness],
                    })}
                    onClick={() => void signInStandaloneProvider(standaloneHarness)}
                  >
                    {working === `signin:${standaloneHarness}`
                      ? t("Signing in…")
                      : standaloneSignedIn
                        ? t("Sign in again")
                        : t("Sign in")}
                  </Button>
                </>
              )}
            </Row>
          ) : null}
        </Group>
      </div>
      <div hidden={harness !== "antigravity"}>
        <AntigravityAccountSettings embedded />
      </div>
      {menu ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Actions for {p0}", { p0: menu.account.label })}
          items={accountMenuItems(menu.account)}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const { account, anchor } = menu;
            setMenu(null);
            if (id === "rename") startRename(account);
            else if (id === "default") makeDefault(account);
            else if (id === "color") setColorFor({ account, anchor });
            else if (id === "remove") setConfirmRemove(account);
          }}
        />
      ) : null}
      {colorFor ? (
        <AccountColorPopover
          account={colorFor.account}
          anchor={colorFor.anchor}
          onDismiss={() => setColorFor(null)}
        />
      ) : null}
      {confirmRemove ? (
        <ConfirmDialog
          request={{
            title: t("Remove {p0} account", { p0: HARNESS_TITLE[confirmRemove.provider] }),
            message: removeAccountMessage(confirmRemove),
            confirmLabel: t("Remove account"),
          }}
          onSettle={(confirmed) => {
            const account = confirmRemove;
            setConfirmRemove(null);
            if (confirmed) void removeAccount(account);
          }}
        />
      ) : null}
    </div>
  );
}

/** Sign-in can fix this account; a missing CLI needs an install first. */
export function canSignIn(limits: ProviderRateLimits): boolean {
  return providerAccountSignedOut(limits);
}
