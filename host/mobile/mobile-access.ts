import type { MobileAccessStatus } from "../../src/integrations/mobile-access";
import {
  availableMobilePort,
  existingMobileEndpoint,
  tailscaleIdentity,
} from "./mobile-access-config";
import { mobileAccessFailure, runTailscale, tailscaleExecutable } from "./mobile-access-process";

type Dependencies = {
  executable: () => Promise<string | undefined>;
  run: (program: string, args: string[]) => Promise<string>;
};

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
  const status = async (): Promise<MobileAccessStatus> => {
    try {
      const program = await dependencies.executable();
      if (!program) return observed({ state: "install-required" });
      return observed((await inspect(program)).status);
    } catch (error) {
      return observed(mobileAccessFailure(error));
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
      return observed(await operation);
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
