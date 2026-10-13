import { t, useLocale } from "../../../shared/i18n";
import { ask } from "@tauri-apps/plugin-dialog";
import { Loader, Pencil, Plus, Trash2 } from "../../../shared/ui/icons";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

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

import { Group } from "./settingsControls";
import { AntigravityAccountSettings } from "./AntigravityAccountSettings";
import { TerminalProfileDiscovery } from "./TerminalProfileDiscovery";

export type AccountEditor = {
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
};

export function ProviderAccountsSettings() {
  useLocale();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const pendingAccount = useRef<ProviderAccount | null>(null);

  const begin = (key: string) => {
    if (busy.current) return false;
    busy.current = true;
    setWorking(key);
    setError(null);
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

  const identities = useProviderAccountIdentities(
    PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts),
    version,
  );
  const usage = useProviderAccountUsage(version);

  return (
    <Group
      id="provider-accounts"
      layout="full"
      title={t("Accounts")}
      description={t(
        "Separate sign-ins per provider. New conversations use the default account; each conversation can pick its own account from the composer.",
      )}
      action={
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
      }
    >
      <div
        className="max-h-[460px] overflow-y-auto"
        aria-busy={Boolean(working) || usage.refreshing}
      >
        {PROVIDER_ACCOUNT_PROVIDERS.map((provider) => {
          const accounts = providerAccounts(provider);
          const adding = editor?.provider === provider && !editor.accountId;
          const duplicates = duplicateAccountSignIns(accounts, identities);
          return (
            <div key={provider} className="border-b border-content/5 last:border-b-0">
              <div className="flex items-center gap-4 px-4 py-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
                    <HarnessIcon harness={provider} className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-content">
                      {HARNESS_TITLE[provider]}
                    </div>
                    <div className="mt-0.5 text-[11px] text-content/40">
                      {accounts.length} {accounts.length === 1 ? t("account") : t("accounts")}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={Boolean(working)}
                  onClick={() => startAdd(provider)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 py-1 text-[12px] text-content/70 motion-safe:transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
                >
                  <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
                  {t("Add account")}
                </button>
              </div>
              <TerminalProfileDiscovery provider={provider} disabled={Boolean(working)} />
              <div className="border-t border-content/5 bg-content/[0.015] pl-10">
                {accounts.map((account) => {
                  const editing = editor?.provider === provider && editor.accountId === account.id;
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
                      className="flex min-h-12 flex-wrap items-center gap-3 border-b border-content/5 px-4 py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <AccountColorPicker account={account} disabled={Boolean(working)} />
                          <span className="truncate text-[12px] text-content/85">
                            {account.label}
                          </span>
                          {account.isDefault ? (
                            <span className="shrink-0 rounded bg-accent/15 px-1 text-[9px] font-medium uppercase leading-4 tracking-wide text-accent">
                              {t("Default")}
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
                            <span className="inline-flex shrink-0 items-center gap-1.5 text-amber-600 dark:text-amber-300">
                              <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
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
                                ? "Provider CLI profile"
                                : "Isolated profile"
                            }
                            className="truncate text-content/30"
                          />
                        </div>
                        {duplicateOf ? (
                          <p
                            className="mt-1 truncate text-[10px] leading-4 text-amber-600 dark:text-amber-300"
                            role="note"
                          >
                            {t("Same sign-in as ")}
                            {duplicateOf.label}
                            {t(". Remove this account if you do not need it separately.")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex min-w-24 shrink-0 items-center justify-end gap-1">
                        {signingIn || !limits || canSignIn(limits) ? (
                          <button
                            type="button"
                            disabled={Boolean(working)}
                            aria-label={t("Sign in to {p0}", {
                              p0: account.label,
                            })}
                            onClick={() => void signInAccount(account)}
                            className={`mr-1 flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] motion-safe:transition-transform duration-150 active:scale-[0.97] disabled:cursor-default disabled:opacity-40 ${
                              signedOut
                                ? "border-amber-400/40 bg-amber-400/10 text-amber-700 hover:bg-amber-400/20 dark:text-amber-300"
                                : "border-content/10 text-content/70 hover:bg-content/10 hover:text-content"
                            }`}
                          >
                            {signingIn ? (
                              <Loader className="size-3 motion-safe:animate-spin" aria-hidden />
                            ) : null}
                            {signingIn ? t("Signing in…") : t("Sign in")}
                          </button>
                        ) : null}
                        {account.isDefault ? null : (
                          <button
                            type="button"
                            disabled={Boolean(working)}
                            aria-label={t("Use {p0} by default", {
                              p0: account.label,
                            })}
                            onClick={() => makeDefault(account)}
                            className="rounded-md border border-content/10 px-2 py-1 text-[11px] text-content/60 hover:bg-content/10 hover:text-content disabled:opacity-35"
                          >
                            {t("Make default")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(working)}
                          aria-label={t("Rename {p0}", { p0: account.label })}
                          title={t("Rename account")}
                          onClick={() => startRename(account)}
                          className="grid size-7 place-items-center rounded-md text-content/40 motion-safe:transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.96] disabled:opacity-35"
                        >
                          <Pencil className="size-3.5" strokeWidth={1.75} />
                        </button>
                        {
                          <button
                            type="button"
                            disabled={Boolean(working)}
                            aria-label={t("Remove {p0}", { p0: account.label })}
                            title={t("Remove account")}
                            onClick={() => void removeAccount(account)}
                            className="grid size-7 place-items-center rounded-md text-content/35 motion-safe:transition-transform duration-150 hover:bg-red-400/10 hover:text-red-400 active:scale-[0.96] disabled:opacity-35"
                          >
                            {removing ? (
                              <Loader className="size-3.5 motion-safe:animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" strokeWidth={1.75} />
                            )}
                          </button>
                        }
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
      <AntigravityAccountSettings embedded />
      {error ? (
        <p
          className="border-t border-content/5 px-4 py-2.5 text-[11px] leading-4 text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Group>
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
      className="flex h-12 items-center border-b border-content/5 px-4 py-2 last:border-b-0"
      onSubmit={onSubmit}
    >
      <div
        data-provider-account-editor-field
        className="flex items-center pr-1 h-8 min-w-0 flex-1 overflow-hidden rounded-md border border-content/10 bg-content/[0.04] focus-within:border-accent/45"
      >
        <label className="h-full min-w-0 flex-1">
          <span className="sr-only">{t("Account name")}</span>
          <input
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
            className="h-full w-full bg-transparent px-2.5 text-[12px] text-content outline-none placeholder:text-content/25 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={working}
          onClick={onCancel}
          className="flex h-6 shrink-0 items-center rounded-[4.5px] bg-content/[0.05] px-2.5 text-[11px] text-content/45 motion-safe:transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.97] disabled:opacity-40"
        >
          {t("Cancel")}
        </button>
        <button
          type="submit"
          disabled={working || !editor.label.trim()}
          className="ml-1 flex h-6 shrink-0 items-center gap-1.5 rounded-[4.5px] bg-content px-2.5 text-[11px] font-medium text-background-base motion-safe:transition-transform duration-150 hover:bg-content/85 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          {working ? <Loader className="size-3 motion-safe:animate-spin" /> : null}
          {adding ? (working ? t("Waiting for browser…") : t("Sign in and add")) : t("Save")}
        </button>
      </div>
    </form>
  );
}
