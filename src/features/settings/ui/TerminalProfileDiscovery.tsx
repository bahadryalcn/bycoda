import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { t } from "../../../shared/i18n";
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

const buttonStyle =
  "rounded-md border border-content/10 px-2.5 py-1 text-xs text-content/70 hover:bg-content/10 active:bg-content/15 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40";

/** Discovery only reads local homes. Connecting stores a path, never credentials. */
export function TerminalProfileDiscovery({
  provider,
  disabled,
}: {
  provider: ProviderAccountProvider;
  disabled: boolean;
}) {
  const [profiles, setProfiles] = useState<TerminalProfile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const connect = async (path: string) => {
    const profile = await invoke<TerminalProfile>("provider_terminal_profile_connect", {
      provider,
      path,
    });
    saveTerminalProviderAccount(profile);
    setMessage(
      t("Terminal profile connected. Select it for a conversation or make it the default account."),
    );
  };

  return (
    <div className="border-t border-content/5 px-4 py-3 text-xs" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonStyle}
          disabled={disabled || busy}
          onClick={() =>
            void run(async () => {
              setProfiles(
                await invoke<TerminalProfile[]>("provider_terminal_profiles", {
                  provider,
                }),
              );
            })
          }
        >
          {busy ? t("Working…") : t("Find terminal profiles")}
        </button>
        <button
          type="button"
          className={buttonStyle}
          disabled={disabled || busy}
          onClick={() =>
            void run(async () => {
              const path = await open({
                directory: true,
                multiple: false,
                title: t("Select terminal profile directory"),
              });
              if (typeof path === "string") await connect(path);
            })
          }
        >
          {t("Choose profile folder")}
        </button>
      </div>
      <p className="mbs-2 text-content/40">
        {t(
          "Uses existing CLI sign-ins. Finds standard and named home profiles; choose a folder for other locations.",
        )}
      </p>
      {profiles?.length === 0 && (
        <p role="status">
          {t(
            "No terminal profiles found. Choose a profile folder or sign in from the terminal first.",
          )}
        </p>
      )}
      {profiles?.map((profile) => {
        const connected = providerAccounts(provider).some((account) => account.id === profile.id);
        return (
          <div key={profile.id} className="mbs-2 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <span>{profile.label}</span>
              <p className="break-all text-content/40">{profile.path}</p>
            </div>
            <button
              type="button"
              className={buttonStyle}
              disabled={connected || disabled || busy}
              onClick={() => void run(() => connect(profile.path))}
            >
              {connected ? t("Connected") : t("Connect")}
            </button>
          </div>
        );
      })}
      {message && (
        <p role="status" className="mbs-2">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mbs-2 text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
