import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import {
  availableMobilePort,
  existingMobileEndpoint,
  tailscaleIdentity,
} from "./mobile-access-config";
import { mobileAccessFailure, runTailscale, tailscaleExecutable } from "./mobile-access-process";
import { networkFingerprint } from "./mobile-network";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";

type Dependencies = {
  executable: () => Promise<string | undefined>;
  run: (program: string, args: string[]) => Promise<string>;
  /** Changes when adapters change; defaults to the live network fingerprint. */
  network?: () => string;
};

/** A probe starts two Tailscale CLI processes, and every start blocks the Host event
 * loop on Windows, while `environment.describe` reads this status on each call. So an
 * answer is reused until the network changes (Tailscale coming up or going down adds or
 * drops its adapter address) or it ages: a settled answer for a minute, one the owner
 * is acting on (approval, permission, setup) only briefly. */
const SETTLED_STATUS_MS = 60_000;
const ACTIVE_STATUS_MS = 5_000;
const SETTLED_STATES = new Set<MobileAccessStatus["state"]>([
  "ready",
  "install-required",
  "sign-in-required",
  "offline",
  "unavailable",
]);

/** Authenticated owner UI calls enable explicitly; status is always read-only. */
export function createMobileAccessService(
  getPort: () => number,
  dependencies: Dependencies = {
    executable: tailscaleExecutable,
    run: runTailscale,
  },
) {
  let enabling: Promise<MobileAccessStatus> | undefined;
  const observers = new Set<(status: MobileAccessStatus) => void>();
  const observed = (status: MobileAccessStatus): MobileAccessStatus => {
    for (const observer of observers) {
      try {
        observer(status);
      } catch {
        /* An observer must never fail the owner's status or enable call. */
      }
    }
    return status;
  };
  const port = () => {
    const current = getPort();
    if (!Number.isInteger(current) || current < 1 || current > 65535)
      throw new Error("Host is not listening");
    return current;
  };
  const inspect = async (program: string) => {
    const hostPort = port();
    const identity = tailscaleIdentity(
      JSON.parse(await dependencies.run(program, ["status", "--json"])),
    );
    if (!identity.dns)
      return {
        identity,
        config: {},
        status: { state: identity.state } as MobileAccessStatus,
      };
    const config: unknown = JSON.parse(
      await dependencies.run(program, ["serve", "status", "--json"]),
    );
    const endpoint = existingMobileEndpoint(config, identity.dns, hostPort);
    const status: MobileAccessStatus = {
      state: endpoint ? "ready" : "setup-required",
      machineName: identity.machineName,
      ...(endpoint ? { endpoint } : {}),
    };
    return { identity, config, status };
  };
  const network = dependencies.network ?? networkFingerprint;
  let cached: { status: MobileAccessStatus; at: number; key: string } | undefined;
  let reading: Promise<MobileAccessStatus> | undefined;
  // Bumped by enable, so a probe that started earlier cannot replace its newer answer.
  let generation = 0;
  const cacheKey = () => `${getPort()}\0${network()}`;
  const remember = (status: MobileAccessStatus, key: string) => {
    cached = { status, at: monotonicNow(), key };
  };
  const probe = async (): Promise<MobileAccessStatus> => {
    try {
      const program = await dependencies.executable();
      if (!program) return { state: "install-required" };
      return (await inspect(program)).status;
    } catch (error) {
      return mobileAccessFailure(error);
    }
  };
  /** `fresh`: the owner asked explicitly, so an external `tailscale serve` change shows
   * now; a probe already in flight is fresh enough to share. */
  const status = async (options: { fresh?: boolean } = {}): Promise<MobileAccessStatus> => {
    // An enable is about to answer with newer state; do not start more CLI processes.
    if (enabling) return enabling;
    const key = cacheKey();
    if (
      !options.fresh &&
      cached &&
      cached.key === key &&
      elapsedSince(cached.at) <
        (SETTLED_STATES.has(cached.status.state) ? SETTLED_STATUS_MS : ACTIVE_STATUS_MS)
    )
      return cached.status;
    if (reading) return reading;
    const started = generation;
    const read = probe().then((result) => {
      // An enable finished while this probe ran: its answer is newer, and observers
      // already saw it, so the older result must not reach them either.
      if (generation !== started && cached) return cached.status;
      remember(result, key);
      return observed(result);
    });
    reading = read;
    try {
      return await read;
    } finally {
      if (reading === read) reading = undefined;
    }
  };
  const enable = async (): Promise<MobileAccessStatus> => {
    if (enabling) return enabling;
    const operation = (async (): Promise<MobileAccessStatus> => {
      try {
        const program = await dependencies.executable();
        if (!program) return { state: "install-required" };
        const before = await inspect(program);
        if (before.status.state !== "setup-required" || !before.identity.dns) return before.status;
        const httpsPort = availableMobilePort(before.config);
        if (!httpsPort)
          return {
            state: "unavailable",
            machineName: before.identity.machineName,
          };
        await dependencies.run(program, [
          "serve",
          "--bg",
          "--yes",
          `--https=${httpsPort}`,
          `http://127.0.0.1:${port()}`,
        ]);
        return (await inspect(program)).status;
      } catch (error) {
        return mobileAccessFailure(error);
      }
    })();
    enabling = operation;
    try {
      const result = await operation;
      generation++;
      remember(result, cacheKey());
      return observed(result);
    } finally {
      if (enabling === operation) enabling = undefined;
    }
  };
  /** Reports every status or enable result this service reads; returns the unsubscribe. */
  const observe = (observer: (status: MobileAccessStatus) => void) => {
    observers.add(observer);
    return () => observers.delete(observer);
  };
  return { status, enable, observe };
}
