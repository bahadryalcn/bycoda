import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useContext, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { UserRound } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { PrivateEmail } from "../../../shared/ui/PrivateEmail";
import { RevealedSetting } from "../../../shared/ui/settings";
import {
  providerAccounts,
  saveTerminalProviderAccount,
  type ProviderAccountProvider,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";

type TerminalProfile = {
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

/** Discovery only reads local homes. Connecting stores a path, never credentials. */
export function TerminalProfileDiscovery({
  provider,
  disabled,
  autoDiscover = false,
  onConnected,
  showLabel = autoDiscover,
}: {
  provider: ProviderAccountProvider;
  disabled: boolean;
  autoDiscover?: boolean;
  onConnected?: (account: ProviderAccount) => void;
  showLabel?: boolean;
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
  const [error, setError] = useState<string | null>(null);
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
          setError(errorText(caught));
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
      if (current()) setError(errorText(caught));
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

  return (
    <span className="inline-flex">
      <Button
        ref={trigger}
        iconOnly={!showLabel}
        label={t("Terminal account profiles")}
        size="sm"
        variant="ghost"
        aria-expanded={openPopover}
        aria-haspopup="dialog"
        aria-controls={`${settingId}-popover`}
        onClick={() => setOpenPopover((current) => !current)}
      >
        <UserRound className="icon-md" strokeWidth={1.75} aria-hidden />
        {showLabel
          ? providerProfiles
            ? t("Profiles ({p0})", { p0: providerProfiles.length })
            : t("Account profiles")
          : null}
      </Button>
      {openPopover ? (
        <Popover
          id={`${settingId}-popover`}
          kind="dialog"
          aria-label={t("Terminal account profiles")}
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
            aria-label={t("Terminal account profiles")}
            aria-busy={busy}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                aria-label={t("Find terminal profiles")}
                loading={activeOperation === "find"}
                disabled={disabled || busy}
                disabledReason={
                  disabled
                    ? t(
                        "Wait for the current account operation to finish, then discover or connect a terminal profile.",
                      )
                    : undefined
                }
                onClick={() =>
                  void run("find", async (current) => {
                    const found = await invoke<TerminalProfile[]>("provider_terminal_profiles", {
                      provider,
                    });
                    if (current()) setProfiles(found);
                  })
                }
              >
                {activeOperation === "find" ? t("Working…") : t("Find terminal profiles")}
              </Button>
              <Button
                loading={activeOperation === "choose"}
                disabled={disabled || busy}
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
            </div>
            {providerProfiles?.length === 0 ? (
              <SettingsFeedback state="empty">
                {t(
                  "No terminal profiles found. Choose a profile folder or sign in from the terminal first.",
                )}
              </SettingsFeedback>
            ) : null}
            <ScrollArea gutter="stable" className="max-h-[min(55vh,20rem)]">
              <ul className="min-w-0 list-none p-0">
                {providerProfiles?.map((profile) => {
                  const connected = connectedIds.has(profile.id);
                  const label =
                    storedAccounts.find((account) => account.id === profile.id)?.label ||
                    profile.label;
                  const email = profile.identity?.email?.trim();
                  return (
                    <li key={profile.id} className="flex min-w-0 items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        {/* The path tells same-named profiles apart; it stays readable, never hover-only. */}
                        <Text as="p" size="secondary" weight="medium" wrap="anywhere">
                          {label}
                        </Text>
                        {email ? (
                          <Text as="p" size="caption" tone="secondary" wrap="anywhere">
                            <PrivateEmail email={email} wrap />
                          </Text>
                        ) : null}
                        <Text as="p" size="caption" tone="secondary" wrap="anywhere">
                          {profile.path}
                        </Text>
                      </div>
                      <Button
                        disabled={(connected && !onConnected) || disabled || busy}
                        loading={activeOperation === profile.id}
                        onClick={() =>
                          void run(profile.id, (current) => connect(profile.path, current))
                        }
                      >
                        {onConnected ? t("Use account") : connected ? t("Connected") : t("Connect")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
            {message ? <SettingsFeedback state="success">{message}</SettingsFeedback> : null}
            {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
          </div>
        </Popover>
      ) : null}
    </span>
  );
}
