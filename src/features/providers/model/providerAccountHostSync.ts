import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  subscribeProviderAccounts,
} from "./providerAccounts";

type Styles = Record<string, Record<string, { label: string; color?: string }>>;

function currentStyles(): Styles {
  return Object.fromEntries(
    PROVIDER_ACCOUNT_PROVIDERS.map((provider) => [
      provider,
      Object.fromEntries(
        providerAccounts(provider).map((account) => [
          account.id,
          { label: account.label, ...(account.color ? { color: account.color } : {}) },
        ]),
      ),
    ]),
  );
}

/**
 * Publishes the account names and colours this desktop keeps to its own Host, which owns them
 * for every client (the phone lists accounts by these). Runs once on load, which migrates names
 * set before the Host kept them, then after each change. A failed push retries on the next change.
 */
export function startProviderAccountHostSync(): () => void {
  let sent = "";
  let running: Promise<void> | undefined;
  const push = () => {
    const styles = currentStyles();
    const body = JSON.stringify(styles);
    if (body === sent || running) return;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) return;
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { providerAccountStyles: styles },
        false,
        true,
      );
      sent = body;
    })()
      .catch((error) => console.warn("Publishing provider account names failed", error))
      .finally(() => {
        running = undefined;
        if (sent !== "" && JSON.stringify(currentStyles()) !== sent) push();
      });
  };
  push();
  return subscribeProviderAccounts(push);
}
