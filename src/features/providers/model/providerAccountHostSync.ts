import { readProviderAccountIdentity } from "./providerAccountIdentity";
import { invoke } from "@tauri-apps/api/core";
import { remoteRequest } from "../../connections/public/connections";
import { retryOnLocalHostAvailable } from "../../connections/public/localHostRetry";
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

const PULL_MS = 5000;
const MAX_PULL_MS = 60_000;

/** Delay before the next Host read: doubles with each read that found nothing to apply. */
function nextPullDelay(quietReads: number): number {
  return Math.min(PULL_MS * 2 ** Math.min(quietReads, 16), MAX_PULL_MS);
}

type PullOutcome = "changed" | "unchanged" | "failed" | "skipped";

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
 * set before the Host kept them, then after each change. A push that finds the local Host missing
 * or failing retries on a short backoff and when the Host reports recovery; the periodic read
 * below also re-pushes while a change is unsent.
 *
 * The Host is read to pick up edits made from another client. Reads back off while they find
 * nothing new, stop while the window is hidden and run again at once when it becomes visible or
 * focused. A cheap change counter, not serialization, tells whether local edits are unsent or
 * changed during a read, so an idle read serializes nothing and a late read never overwrites a
 * newer local edit.
 */
export function startProviderAccountHostSync(): () => void {
  let sent = "";
  let stopped = false;
  let applying = false;
  let reading = false;
  let running: Promise<void> | undefined;
  // Bumped on every account change; `synced` is the count the Host is known to match.
  let changes = 0;
  let synced = -1;
  const retry = retryOnLocalHostAvailable(() => push());
  const push = () => {
    if (stopped || applying || running) return;
    const at = changes;
    const styles = currentStyles();
    const body = JSON.stringify(styles);
    if (body === sent) {
      synced = at;
      return;
    }
    running = (async () => {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) {
        retry.later();
        return;
      }
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
      if (stopped || changes !== at) return;
      await remoteRequest(
        machine.id,
        "host.settings.save",
        { providerAccountStyles: published },
        false,
        true,
      );
      sent = body;
      synced = at;
      retry.reset();
    })()
      .catch((error) => {
        console.warn("Publishing provider account names failed", error);
        retry.later();
      })
      .finally(() => {
        running = undefined;
        if (!stopped && changes !== at) push();
      });
  };
  const pull = async (): Promise<PullOutcome> => {
    if (stopped || running || reading) return "skipped";
    if (changes !== synced) {
      push();
      return "skipped";
    }
    const at = changes;
    reading = true;
    try {
      const machine = await invoke<RemoteMachine | null>("local_host_connect");
      if (!machine) return "failed";
      if (stopped || running) return "skipped";
      const result = (await remoteRequest(machine.id, "host.settings.get", {}, false, true)) as {
        providerAccountStyles?: Styles;
      };
      if (stopped || running || changes !== at) return "skipped";
      const remote = result.providerAccountStyles;
      if (!remote) return "unchanged";
      applying = true;
      let edited = false;
      for (const provider of PROVIDER_ACCOUNT_PROVIDERS) {
        for (const account of providerAccounts(provider)) {
          const style = remote[provider]?.[account.id];
          if (
            !style ||
            (style.kind !== undefined && style.kind !== "personal" && style.kind !== "work")
          )
            continue;
          const label = style.label || account.label;
          const color = style.color as ProviderAccountColor | undefined;
          if (label === account.label && color === account.color && style.kind === account.kind)
            continue;
          if (editProviderAccount(provider, account.id, { label, color, kind: style.kind }))
            edited = true;
        }
      }
      if (!edited) return "unchanged";
      // The Host already holds these values: record them as sent so they are not echoed back.
      sent = JSON.stringify(currentStyles());
      synced = changes;
      return "changed";
    } catch (error) {
      console.warn("Reading provider account styles failed", error);
      return "failed";
    } finally {
      applying = false;
      reading = false;
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let quietReads = 0;
  const plan = () => {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || document.hidden) return;
    timer = setTimeout(() => void poll(), nextPullDelay(quietReads));
  };
  const poll = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || document.hidden) return;
    const outcome = await pull();
    if (outcome === "changed") quietReads = 0;
    else if (outcome !== "skipped") quietReads++;
    plan();
  };
  // A hidden window reads nothing; becoming visible or focused catches up at once.
  const catchUp = () => {
    if (stopped || document.hidden) return;
    quietReads = 0;
    void poll();
  };
  push();
  const unsubscribe = subscribeProviderAccounts(() => {
    changes++;
    push();
  });
  document.addEventListener("visibilitychange", catchUp);
  window.addEventListener("focus", catchUp);
  plan();
  return () => {
    stopped = true;
    retry.stop();
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", catchUp);
    window.removeEventListener("focus", catchUp);
    unsubscribe();
  };
}
