import { readProviderAccountIdentity } from "./providerAccountIdentity";
import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import type { RemoteMachine } from "../../connections";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  editProviderAccount,
  type ProviderAccountColor,
  subscribeProviderAccounts,
} from "./providerAccounts";

type Styles = Record<
  string,
  Record<
    string,
    {
      label: string;
      isDefault?: boolean;
      color?: string;
      kind?: "personal" | "work";
      derivedKind?: "personal" | "work";
    }
  >
>;

function currentStyles(): Styles {
  return Object.fromEntries(
    PROVIDER_ACCOUNT_PROVIDERS.map((provider) => [
      provider,
      Object.fromEntries(
        providerAccounts(provider).map((account) => [
          account.id,
          {
            label: account.label,
            isDefault: account.isDefault === true,
            ...(account.kind ? { kind: account.kind } : {}),
            ...(account.color ? { color: account.color } : {}),
          },
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
  let stopped = false;
  let applying = false;
  let reading = false;
  let running: Promise<void> | undefined;
  const push = () => {
    const styles = currentStyles();
    const body = JSON.stringify(styles);
    if (stopped || applying || body === sent || running) return;
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) return;
      const published = structuredClone(styles);
      for (const provider of PROVIDER_ACCOUNT_PROVIDERS) {
        for (const account of providerAccounts(provider)) {
          const identity = await readProviderAccountIdentity(provider, account.id);
          const organization = identity?.organization?.trim();
          if (organization)
            published[provider]![account.id]!.derivedKind = /['’]s Organization$/.test(organization)
              ? "personal"
              : "work";
        }
      }
      if (stopped || JSON.stringify(currentStyles()) !== body) return;
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { providerAccountStyles: published },
        false,
        true,
      );
      sent = body;
    })()
      .catch((error) => console.warn("Publishing provider account names failed", error))
      .finally(() => {
        running = undefined;
        if (!stopped && JSON.stringify(currentStyles()) !== body) push();
      });
  };
  const pull = async () => {
    if (stopped || running || reading) return;
    const before = JSON.stringify(currentStyles());
    if (before !== sent) {
      push();
      return;
    }
    reading = true;
    try {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine || stopped || running) return;
      const result = (await remoteRequest(machine.id, "host.settings.get", {}, false, true)) as {
        providerAccountStyles?: Styles;
      };
      if (
        stopped ||
        running ||
        JSON.stringify(currentStyles()) !== before ||
        !result.providerAccountStyles
      )
        return;
      applying = true;
      for (const provider of PROVIDER_ACCOUNT_PROVIDERS) {
        for (const account of providerAccounts(provider)) {
          const style = result.providerAccountStyles[provider]?.[account.id];
          if (
            !style ||
            (style.kind !== undefined && style.kind !== "personal" && style.kind !== "work")
          )
            continue;
          const next = {
            label: style.label || account.label,
            color: style.color as ProviderAccountColor | undefined,
            kind: style.kind,
          };
          if (
            JSON.stringify({ label: account.label, color: account.color, kind: account.kind }) !==
            JSON.stringify(next)
          )
            editProviderAccount(provider, account.id, next);
        }
      }
      sent = JSON.stringify(currentStyles());
    } catch (error) {
      console.warn("Reading provider account styles failed", error);
    } finally {
      applying = false;
      reading = false;
    }
  };
  push();
  const unsubscribe = subscribeProviderAccounts(push);
  const timer = setInterval(() => {
    void pull();
  }, 5000);
  return () => {
    stopped = true;
    clearInterval(timer);
    unsubscribe();
  };
}
