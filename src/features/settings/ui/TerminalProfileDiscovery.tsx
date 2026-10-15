import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { FolderOpen } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { RevealedSetting } from "./settingsControls";
import {
  providerAccounts,
  saveTerminalProviderAccount,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";

type TerminalProfile = {
  id: string;
  provider: ProviderAccountProvider;
  label: string;
  path: string;
};

/** Discovery only reads local homes. Connecting stores a path, never credentials. */
export function TerminalProfileDiscovery({
  provider,
  disabled,
}: {
  provider: ProviderAccountProvider;
  disabled: boolean;
}) {
  useLocale();
  const revealedSetting = useContext(RevealedSetting);
  const settingId =
    provider === "claude" ? "terminal-account-profiles" : `terminal-account-profiles-${provider}`;
  const revealProfiles =
    revealedSetting === settingId || revealedSetting === "terminal-account-profiles";
  const [profiles, setProfiles] = useState<TerminalProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openPopover, setOpenPopover] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const lastHandledTerminalReveal = useRef(false);
  const providerRevision = useRef(0);
  const operationBusy = useRef(false);

  useLayoutEffect(() => {
    providerRevision.current += 1;
    operationBusy.current = false;
    setOpenPopover(false);
    setBusy(false);
    setProfiles(null);
    setError(null);
    setMessage(null);
  }, [provider]);

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

  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (operationBusy.current) return;
    operationBusy.current = true;
    const revision = providerRevision.current;
    const current = () => providerRevision.current === revision;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action(current);
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (current()) {
        operationBusy.current = false;
        setBusy(false);
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
    setMessage(
      t("Terminal profile connected. Select it for a conversation or make it the default account."),
    );
  };

  const closePopover = (restoreFocus = false) => {
    setOpenPopover(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };

  const providerProfiles = profiles?.filter((profile) => profile.provider === provider);

  return (
    <span className="inline-flex">
      <Button
        ref={trigger}
        iconOnly
        label={t("Terminal account profiles")}
        tooltip={t("Terminal account profiles")}
        size="sm"
        variant="ghost"
        aria-expanded={openPopover}
        aria-haspopup="dialog"
        aria-controls={`${settingId}-popover`}
        onClick={() => setOpenPopover((current) => !current)}
      >
        <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
      {openPopover ? (
        <Popover
          id={`${settingId}-popover`}
          role="dialog"
          aria-label={t("Terminal account profiles")}
          anchor={trigger}
          side="bottom"
          align="end"
          width={360}
          className="p-2"
          autoFocus
          onDismiss={(reason) => closePopover(reason === "escape")}
        >
          <div
            ref={content}
            id={`setting-${settingId}`}
            data-setting-id={settingId}
            tabIndex={-1}
            className="max-h-[min(65vh,24rem)] min-w-0 space-y-2 overflow-y-auto outline-none"
            role="group"
            aria-label={t("Terminal account profiles")}
            aria-busy={busy}
          >
            <p className="text-[11px] leading-relaxed text-content/55">
              {t(
                "Accounts on this machine. The default account belongs to its provider; it does not select the default provider or model.",
              )}
            </p>
            <p className="text-[11px] leading-relaxed text-content/55">
              {t(
                "Separate sign-ins per provider. New conversations use the default account; each conversation can pick its own account from the composer.",
              )}
            </p>
            <p className="text-[10px] leading-relaxed text-content/40">
              {t(
                "Uses existing CLI sign-ins. Finds standard and named home profiles; choose a folder for other locations.",
              )}
            </p>
            <p className="text-[10px] leading-relaxed text-content/40">
              {t(
                "Discovery reads profile folders on this computer. Connecting stores a path, not credentials.",
              )}
            </p>
            {disabled ? (
              <p role="status" className="text-[10px] leading-relaxed text-content/45">
                {t(
                  "Wait for the current account operation to finish, then discover or connect a terminal profile.",
                )}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                aria-label={t("Find terminal profiles")}
                loading={busy}
                disabled={disabled || busy}
                onClick={() =>
                  void run(async (current) => {
                    const found = await invoke<TerminalProfile[]>("provider_terminal_profiles", {
                      provider,
                    });
                    if (current()) setProfiles(found);
                  })
                }
              >
                {busy ? t("Working…") : t("Find terminal profiles")}
              </Button>
              <Button
                disabled={disabled || busy}
                onClick={() =>
                  void run(async (current) => {
                    const path = await open({
                      directory: true,
                      multiple: false,
                      title: t("Select terminal profile directory"),
                    });
                    if (current() && typeof path === "string") await connect(path, current);
                  })
                }
              >
                {t("Choose profile folder")}
              </Button>
            </div>
            {providerProfiles?.length === 0 ? (
              <p role="status">
                {t(
                  "No terminal profiles found. Choose a profile folder or sign in from the terminal first.",
                )}
              </p>
            ) : null}
            <ul className="min-w-0 list-none p-0">
              {providerProfiles?.map((profile) => {
                const connected = providerAccounts(provider).some(
                  (account) => account.id === profile.id,
                );
                return (
                  <li key={profile.id} className="mbs-2 flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <span>{profile.label}</span>
                      <p className="break-all text-content/40">{profile.path}</p>
                    </div>
                    <Button
                      disabled={connected || disabled || busy}
                      onClick={() => void run((current) => connect(profile.path, current))}
                    >
                      {connected ? t("Connected") : t("Connect")}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {message ? (
              <p role="status" className="mbs-2">
                {message}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mbs-2 text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </span>
  );
}
