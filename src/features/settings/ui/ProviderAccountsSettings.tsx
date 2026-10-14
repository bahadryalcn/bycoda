import { t, useLocale } from "../../../shared/i18n";
import { ask } from "@tauri-apps/plugin-dialog";
import { Pencil, Plus, Trash2 } from "../../../shared/ui/icons";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { loginHarness } from "../../../integrations/harness/core/auth";

import { HARNESS_TITLE } from "../../sessions/model/session";

import {
  newProviderAccount,
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  renameProviderAccount,
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
import { AccountColorPicker } from "../../providers/ui/AccountColorPicker";

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
import { Button } from "../../../shared/ui/Button";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { TextField } from "../../../shared/ui/TextField";
import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import type { HarnessId } from "../../sessions/model/session";

const SETTINGS_HARNESSES: readonly HarnessId[] = [
  ...PROVIDER_ACCOUNT_PROVIDERS,
  "cursor",
  "grok",
  "antigravity",
];

export type AccountEditor = {
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
};

export function ProviderAccountsSettings({ harness }: { harness?: HarnessId }) {
  useLocale();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedSignIn, setCompletedSignIn] = useState<HarnessId | null>(null);
  const busy = useRef(false);
  const pendingAccount = useRef<ProviderAccount | null>(null);

  const supportedHarness = !harness || SETTINGS_HARNESSES.includes(harness);

  const begin = (key: string) => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(key);
    setError(null);
    setCompletedSignIn(null);
    return true;
  };
  const finish = () => {
    busy.current = false;
    setWorking(null);
  };

  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);

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
        if (!renameProviderAccount(editor.provider, editor.accountId, editor.label))
          throw new Error("Account no longer exists");
      } else {
        const account = pendingAccount.current ?? newProviderAccount(editor.provider, editor.label);
        account.label = editor.label;
        pendingAccount.current = account;
        await registerProviderAccount(account);
        pendingAccount.current = null;
      }
      setEditor(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this account");
    } finally {
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

  const removeAccount = async (account: ProviderAccount) => {
    const key = `remove:${account.provider}:${account.id}`;
    if (!begin(key)) return;
    try {
      const confirmed = await ask(
        account.id.startsWith("terminal-")
          ? `Disconnect “${account.label}”? Running turns for this account will stop. Its terminal sign-in, settings and conversation history stay intact.`
          : account.id === DEFAULT_PROVIDER_ACCOUNT_ID
            ? `Remove “${account.label}”? This signs out of the shared ${HARNESS_TITLE[account.provider]} CLI profile and stops its running turns. CLI settings and conversation history stay on disk.`
            : `Remove “${account.label}”? Its stored credentials will be deleted and any running turns for this account will stop. Existing conversations stay in history, but cannot continue until you switch accounts.`,
        {
          get title() {
            return t("Remove {p0} account", {
              p0: HARNESS_TITLE[account.provider],
            });
          },
          kind: "warning",
          okLabel: "Remove account",
          get cancelLabel() {
            return t("Cancel");
          },
        },
      );
      if (!confirmed) return;
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
      setCompletedSignIn(provider);
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
    PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts),
    version,
  );
  const usage = useProviderAccountUsage(version);
  const standaloneHarness = harness === "cursor" || harness === "grok" ? harness : null;
  const accountProvider = harness
    ? supportsProviderAccounts(harness)
      ? harness
      : null
    : PROVIDER_ACCOUNT_PROVIDERS[0];

  return (
    <div hidden={!supportedHarness}>
      <section
        id="setting-provider-accounts"
        data-setting-id="provider-accounts"
        tabIndex={-1}
        aria-label={t(harness === "cursor" || harness === "grok" ? "Sign in" : "Accounts")}
        className="min-w-0"
      >
        <div
          className="flex h-8 items-center gap-1.5 border-b border-content/5 px-2"
          aria-busy={Boolean(working) || usage.refreshing}
        >
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-content/75">
            {t(harness === "cursor" || harness === "grok" ? "Sign in" : "Accounts")}
          </span>
          {accountProvider ? (
            <>
              <Button
                size="sm"
                disabled={Boolean(working)}
                onClick={() => startAdd(accountProvider)}
              >
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
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
              <TerminalProfileDiscovery provider={accountProvider} disabled={Boolean(working)} />
            </>
          ) : null}
        </div>
        <div className="min-w-0">
          {PROVIDER_ACCOUNT_PROVIDERS.map((provider) => {
            const accounts = providerAccounts(provider);
            const adding = editor?.provider === provider && !editor.accountId;
            const duplicates = duplicateAccountSignIns(accounts, identities);
            return (
              <div
                key={provider}
                hidden={Boolean(harness && provider !== harness)}
                className="min-w-0"
              >
                <div className="min-w-0">
                  {accounts.map((account) => {
                    const autoDefaultLabel =
                      account.id === DEFAULT_PROVIDER_ACCOUNT_ID &&
                      account.label === "Default account";
                    const displayLabel = autoDefaultLabel ? t("Default account") : account.label;
                    const editing =
                      editor?.provider === provider && editor.accountId === account.id;
                    const removing = working === `remove:${provider}:${account.id}`;
                    const signingIn = working === `signin:${provider}:${account.id}`;
                    const identity = identities[identityKey(account)];
                    const orgTag = identityOrganizationTag(identity);
                    const limits = usage.usage[accountUsageKey(account)];
                    const signedOut = Boolean(limits && canSignIn(limits));
                    const duplicateOf = duplicates[identityKey(account)];
                    return editing ? (
                      <ProviderAccountEditor
                        key={account.id}
                        editor={editor}
                        working={Boolean(working)}
                        onLabel={(label) =>
                          setEditor((current) => (current ? { ...current, label } : current))
                        }
                        onCancel={() => setEditor(null)}
                        onSubmit={submitEditor}
                      />
                    ) : (
                      <div
                        key={account.id}
                        className="flex min-h-11 flex-wrap items-center gap-2 border-b border-content/5 px-3 py-1.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <AccountColorPicker account={account} disabled={Boolean(working)} />
                            <span
                              title={account.label}
                              className="break-words text-[12px] text-content/85"
                            >
                              {displayLabel}
                            </span>
                            {account.isDefault && !autoDefaultLabel ? (
                              <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium leading-4 text-accent">
                                {t("Default account")}
                              </span>
                            ) : null}
                            {orgTag ? (
                              <span className="max-w-[8rem] shrink-0 truncate rounded bg-content/[0.07] px-1 text-[9px] leading-4 text-content/50">
                                {orgTag}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-2.5 text-[10px]">
                            {signedOut ? (
                              <span className="inline-flex shrink-0 items-center gap-1.5 text-warning dark:text-warning">
                                <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                                {t("Signed out")}
                              </span>
                            ) : (
                              <AccountStatusLabel
                                status={accountStatus(limits, usage.now)}
                                className="shrink-0"
                              />
                            )}
                            <ProviderAccountSubtitle
                              identity={identity}
                              fallback={
                                isTerminalProviderAccount(account.id)
                                  ? t("Provider CLI profile")
                                  : account.id === DEFAULT_PROVIDER_ACCOUNT_ID
                                    ? t("Shared CLI profile")
                                    : t("Isolated profile")
                              }
                              className="truncate text-content/30"
                            />
                          </div>
                          {duplicateOf ? (
                            <p
                              className="mt-1 truncate text-[10px] leading-4 text-warning dark:text-warning"
                              role="note"
                            >
                              {t("Same sign-in as ")}
                              {duplicateOf.label}
                              {t(". Remove this account if you do not need it separately.")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {signingIn || !limits || canSignIn(limits) ? (
                            <Button
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
                          {account.isDefault ? null : (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={Boolean(working)}
                              aria-label={t("Use {p0} by default", {
                                p0: account.label,
                              })}
                              onClick={() => makeDefault(account)}
                            >
                              {t("Make default")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            iconOnly
                            label={t("Rename {p0}", { p0: account.label })}
                            tooltip={t("Rename account")}
                            disabled={Boolean(working)}
                            onClick={() => startRename(account)}
                          >
                            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            iconOnly
                            label={t("Remove {p0}", { p0: account.label })}
                            tooltip={t("Remove account")}
                            loading={removing}
                            disabled={Boolean(working)}
                            onClick={() => void removeAccount(account)}
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  {accounts.length === 0 ? (
                    <p className="px-4 py-3 text-[12px] text-content/50">
                      {t("No accounts. Add an account to sign in.")}
                    </p>
                  ) : null}
                  {adding && editor ? (
                    <ProviderAccountEditor
                      editor={editor}
                      working={Boolean(working)}
                      onLabel={(label) =>
                        setEditor((current) => (current ? { ...current, label } : current))
                      }
                      onCancel={() => setEditor(null)}
                      onSubmit={submitEditor}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div
          hidden={harness !== "cursor" && harness !== "grok"}
          className="flex flex-wrap items-center gap-2 border-t border-content/5 px-3 py-2.5"
        >
          <span className="min-w-[12rem] flex-1 text-[11px] text-content/45">
            {harness === "cursor"
              ? t("Use the Cursor CLI sign-in on this machine.")
              : t("Use the Grok Build CLI sign-in on this machine.")}
          </span>
          {standaloneHarness &&
          hasProbedHarnessAvailability() &&
          !isHarnessAvailable(standaloneHarness) ? (
            <span className="text-[11px] text-content/45">
              {t("Install the CLI first, then sign in.")}
            </span>
          ) : (
            <>
              {completedSignIn === standaloneHarness ? (
                <span role="status" className="text-[11px] text-success">
                  {t("CLI sign-in completed")}
                </span>
              ) : null}
              <Button
                variant="secondary"
                disabled={Boolean(working)}
                loading={working === `signin:${standaloneHarness}`}
                aria-label={t("Sign in to {p0}", {
                  p0: standaloneHarness ? HARNESS_TITLE[standaloneHarness] : "",
                })}
                onClick={() => {
                  if (standaloneHarness) void signInStandaloneProvider(standaloneHarness);
                }}
              >
                {working === `signin:${standaloneHarness}` ? t("Signing in…") : t("Sign in")}
              </Button>
            </>
          )}
        </div>
        <div hidden={Boolean(harness && harness !== "antigravity")}>
          <AntigravityAccountSettings embedded />
        </div>
        {error ? (
          <p
            className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-4 text-danger"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** Sign-in can fix this account; a missing CLI needs an install first. */
export function canSignIn(limits: ProviderRateLimits): boolean {
  return providerAccountSignedOut(limits);
}

export function ProviderAccountEditor({
  editor,
  working,
  onLabel,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  onLabel: (label: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  useLocale();
  const adding = !editor.accountId;
  return (
    <form
      className="flex min-h-11 items-center border-b border-content/5 px-3 py-1.5 last:border-b-0"
      onSubmit={onSubmit}
    >
      <div data-provider-account-editor-field className="flex min-w-0 flex-1 items-center gap-1.5">
        <TextField
          label={t("Account name")}
          hideLabel
          autoFocus
          type="text"
          maxLength={48}
          value={editor.label}
          disabled={working}
          placeholder={t("Work or Personal")}
          aria-label={t(adding ? "New {p1} account" : "Rename {p1} account", {
            p1: HARNESS_TITLE[editor.provider],
          })}
          onChange={(event) => onLabel(event.target.value)}
          className="min-w-0 flex-1"
          fieldClassName="min-w-0 flex-1"
        />
        <SecondaryButton disabled={working} onClick={onCancel}>
          {t("Cancel")}
        </SecondaryButton>
        <Button
          type="submit"
          variant="secondary"
          loading={working}
          disabled={working || !editor.label.trim()}
        >
          {adding ? (working ? t("Waiting for browser…") : t("Sign in and add")) : t("Save")}
        </Button>
      </div>
    </form>
  );
}
