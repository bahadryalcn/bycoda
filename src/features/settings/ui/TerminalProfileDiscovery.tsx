import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useContext, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { FolderOpen, RefreshCw, UserRound } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { RevealedSetting } from "../../../shared/ui/settings";
import { prettyCwd } from "../../../shared/lib/paths";
import {
  providerAccounts,
  saveTerminalProviderAccount,
  type ProviderAccountProvider,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";

export type TerminalProfile = {
  id: string;
  provider: ProviderAccountProvider;
  label: string;
  path: string;
  identity?: { email?: string; organization?: string };
};

const profilePriority = (profile: { id: string }, connectedIds: ReadonlySet<string>) =>
  connectedIds.has(profile.id)
    ? 0
    : profile.id === "default"
      ? 1
      : profile.id.startsWith("account-")
        ? 2
        : 3;

/** One row per signed-in identity (email + organization); profiles without an email stay separate. */
export function dedupeTerminalProfiles<T extends Pick<TerminalProfile, "id" | "identity">>(
  profiles: readonly T[],
  connectedIds: ReadonlySet<string> = new Set(),
): T[] {
  const best = new Map<string, T>();
  const order: (string | T)[] = [];
  for (const profile of profiles) {
    const email = profile.identity?.email?.trim().toLowerCase();
    if (!email) {
      order.push(profile);
      continue;
    }
    const key = `${email}\n${profile.identity?.organization?.trim().toLowerCase() ?? ""}`;
    const current = best.get(key);
    if (!current) order.push(key);
    if (
      !current ||
      profilePriority(profile, connectedIds) < profilePriority(current, connectedIds)
    ) {
      best.set(key, profile);
    }
  }
  return order.map((entry) => (typeof entry === "string" ? best.get(entry)! : entry));
}

/** Readable folder for a discovered profile: no Windows verbatim prefix, home shown as `~`. */
export function profileFolderLabel(path: string): string {
  return prettyCwd(path.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, ""));
}

// Folders the app creates are named by a random account id, which tells the user nothing.
const GENERATED_ACCOUNT_LABEL = /^account-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Discovery only reads local homes. Connecting stores a path, never credentials. */
export function TerminalProfileDiscovery({
  provider,
  disabled,
  autoDiscover = false,
  onConnected,
  onAdd,
}: {
  provider: ProviderAccountProvider;
  disabled: boolean;
  autoDiscover?: boolean;
  onConnected?: (account: ProviderAccount) => void;
  /** Settings: hand the validated profile to the caller, which asks for its name, kind and colour before saving. */
  onAdd?: (profile: TerminalProfile, trigger: HTMLButtonElement | null) => void;
}) {
  useLocale();
  const revealedSetting = useContext(RevealedSetting);
  const settingId =
    provider === "claude" ? "terminal-account-profiles" : `terminal-account-profiles-${provider}`;
  const revealProfiles =
    revealedSetting === settingId || revealedSetting === "terminal-account-profiles";
  const [profiles, setProfiles] = useState<TerminalProfile[] | null>(null);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const busy = activeOperation !== null;
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openPopover, setOpenPopover] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const lastHandledTerminalReveal = useRef(false);
  const providerRevision = useRef(0);
  const operationBusy = useRef(false);
  const discoveryRevision = useRef(0);
  const shouldDiscover = autoDiscover || openPopover;

  // Callers key this control by provider; unmounting retires in-flight operations.
  useEffect(() => {
    const revision = providerRevision;
    return () => {
      revision.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!shouldDiscover || disabled) return;
    let cancelled = false;
    const revision = ++discoveryRevision.current;
    void invoke<TerminalProfile[]>("provider_terminal_profiles", { provider }).then(
      (found) => {
        if (!cancelled && revision === discoveryRevision.current) setProfiles(found);
      },
      (caught: unknown) => {
        if (!cancelled && revision === discoveryRevision.current) {
          setProfiles(null);
          setError({ title: t("Could not find terminal profiles."), detail: errorText(caught) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [provider, shouldDiscover, disabled]);

  useEffect(() => {
    if (!revealProfiles) {
      lastHandledTerminalReveal.current = false;
      return;
    }
    if (!lastHandledTerminalReveal.current) {
      lastHandledTerminalReveal.current = true;
      setOpenPopover(true);
    }
  }, [revealProfiles, provider]);

  useEffect(() => {
    if (openPopover && revealProfiles) {
      const frame = requestAnimationFrame(() =>
        (
          content.current?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
          content.current
        )?.focus(),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [openPopover, revealProfiles, provider]);

  const run = async (key: string, action: (current: () => boolean) => Promise<void>) => {
    if (operationBusy.current) return;
    operationBusy.current = true;
    if (key === "find") discoveryRevision.current += 1;
    const revision = providerRevision.current;
    const current = () => providerRevision.current === revision;
    setActiveOperation(key);
    setError(null);
    setMessage(null);
    try {
      await action(current);
    } catch (caught) {
      if (current())
        setError({
          title:
            key === "find"
              ? t("Could not find terminal profiles.")
              : t("Could not choose a terminal profile folder."),
          detail: errorText(caught),
        });
    } finally {
      if (current()) {
        operationBusy.current = false;
        setActiveOperation(null);
      }
    }
  };

  const connect = async (path: string, current: () => boolean) => {
    const profile = await invoke<TerminalProfile>("provider_terminal_profile_connect", {
      provider,
      path,
    });
    if (!current()) return;
    if (profile.provider !== provider) {
      throw new Error("The discovered terminal profile belongs to another provider");
    }
    if (onAdd) {
      if (providerAccounts(provider).some((account) => account.id === profile.id)) {
        setMessage(t("This account is already added."));
        return;
      }
      setOpenPopover(false);
      onAdd(profile, trigger.current);
      return;
    }
    saveTerminalProviderAccount(profile);
    onConnected?.(profile);
    setMessage(
      onConnected
        ? t("Account selected for new conversations.")
        : t(
            "Terminal profile connected. Select it for a conversation or make it the default account.",
          ),
    );
  };

  const closePopover = (restoreFocus = false) => {
    setOpenPopover(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };

  const storedAccounts = providerAccounts(provider);
  const connectedIds = new Set(storedAccounts.map((account) => account.id));
  const providerProfiles = profiles
    ? dedupeTerminalProfiles(
        profiles.filter((profile) => profile.provider === provider),
        connectedIds,
      )
    : undefined;
  // Settings lists only accounts that can still be added; setup may pick an added one again.
  const addableProfiles = onConnected
    ? providerProfiles
    : providerProfiles?.filter((profile) => !connectedIds.has(profile.id));
  const disabledReason = disabled
    ? t(
        "Wait for the current account operation to finish, then discover or connect a terminal profile.",
      )
    : t("Wait for the current operation to finish");

  return (
    <span className="inline-flex">
      <Button
        ref={trigger}
        size="sm"
        aria-expanded={openPopover}
        aria-haspopup="dialog"
        aria-controls={`${settingId}-popover`}
        onClick={() => setOpenPopover((current) => !current)}
      >
        <UserRound className="icon-sm" strokeWidth={1.75} aria-hidden />
        {t("Add existing account")}
      </Button>
      {openPopover ? (
        <Popover
          id={`${settingId}-popover`}
          kind="dialog"
          aria-label={t("Accounts on this computer")}
          anchor={trigger}
          side="bottom"
          align="end"
          width={360}
          variant="panel"
          onDismiss={(reason) => closePopover(reason === "escape")}
        >
          <div
            ref={content}
            id={`setting-${settingId}`}
            data-setting-id={settingId}
            tabIndex={-1}
            className="min-w-0 space-y-2"
            role="group"
            aria-label={t("Accounts on this computer")}
            aria-busy={busy}
          >
            <div className="flex min-w-0 items-start gap-2">
              <Text as="p" size="caption" tone="secondary" className="min-w-0 flex-1">
                {t(
                  "Accounts already signed in on this computer. Adding one reuses that sign-in without copying credentials.",
                )}
              </Text>
              <Button
                iconOnly
                size="sm"
                variant="ghost"
                label={t("Find terminal profiles")}
                loading={activeOperation === "find"}
                disabled={disabled || busy}
                disabledReason={disabledReason}
                onClick={() =>
                  void run("find", async (current) => {
                    const found = await invoke<TerminalProfile[]>("provider_terminal_profiles", {
                      provider,
                    });
                    if (current()) setProfiles(found);
                  })
                }
              >
                <RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />
              </Button>
            </div>
            {providerProfiles === undefined && !error ? (
              <SettingsFeedback state="loading">{t("Searching…")}</SettingsFeedback>
            ) : providerProfiles?.length === 0 ? (
              <SettingsFeedback state="empty">
                {t(
                  "No terminal profiles found. Choose a profile folder or sign in from the terminal first.",
                )}
              </SettingsFeedback>
            ) : addableProfiles?.length === 0 ? (
              <SettingsFeedback state="empty">
                {t("Every account signed in on this computer is already added.")}
              </SettingsFeedback>
            ) : null}
            <ScrollArea gutter="stable" className="max-h-[min(55vh,20rem)]">
              <ul className="min-w-0 list-none p-0">
                {addableProfiles?.map((profile) => {
                  const email = profile.identity?.email?.trim();
                  const stored = storedAccounts.find((account) => account.id === profile.id)?.label;
                  const title =
                    stored ||
                    (email && GENERATED_ACCOUNT_LABEL.test(profile.label)
                      ? undefined
                      : profile.label);
                  return (
                    <li key={profile.id} className="flex min-w-0 items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        {/* The folder tells same-named profiles apart; it stays readable, never hover-only. */}
                        {title ? (
                          <Text as="p" size="secondary" weight="medium" wrap="anywhere">
                            {title}
                          </Text>
                        ) : null}
                        {email ? (
                          <Text
                            as="p"
                            size={title ? "caption" : "secondary"}
                            weight={title ? undefined : "medium"}
                            tone={title ? "secondary" : undefined}
                            wrap="anywhere"
                          >
                            <PrivateEmail email={email} wrap />
                          </Text>
                        ) : null}
                        <Text as="p" size="caption" tone="secondary" wrap="anywhere">
                          {profileFolderLabel(profile.path)}
                        </Text>
                      </div>
                      <Button
                        size="sm"
                        disabled={disabled || busy}
                        disabledReason={disabledReason}
                        loading={activeOperation === profile.id}
                        onClick={() =>
                          void run(profile.id, (current) => connect(profile.path, current))
                        }
                      >
                        {onConnected ? t("Use account") : t("Add")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
            <Button
              size="sm"
              variant="ghost"
              startIcon={<FolderOpen className="icon-sm" strokeWidth={1.75} aria-hidden />}
              loading={activeOperation === "choose"}
              disabled={disabled || busy}
              disabledReason={disabledReason}
              onClick={() =>
                void run("choose", async (current) => {
                  const path = await open({
                    directory: true,
                    multiple: false,
                    title: t("Choose terminal folder"),
                  });
                  if (current() && typeof path === "string") await connect(path, current);
                })
              }
            >
              {t("Choose profile folder")}
            </Button>
            {message ? <SettingsFeedback state="success">{message}</SettingsFeedback> : null}
            {error ? (
              <SettingsFeedback state="error" extra={<ErrorDetails detail={error.detail} />}>
                {error.title}
              </SettingsFeedback>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </span>
  );
}
