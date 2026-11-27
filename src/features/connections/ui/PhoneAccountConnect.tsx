import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  accountApi,
  approvePairRequest,
  createPairRequestHandler,
  isPhoneConnectEnabled,
  isSignedIn,
  pairRequestCode,
  reportAccountFailure,
  startPhoneConnectInbox,
  startPhoneConnectPublisher,
  subscribePhoneConnect,
  useAccountState,
} from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { usePhoneApprovalRequest } from "./PhoneApprovalRequest";
import { createAccountPairingCode } from "../model/accountPairingCode";
import { remoteRequest } from "../model/connections";
import { accountDeviceAccess, startAccountDeviceAccess } from "../model/accountDeviceAccess";
import type { HostDescriptor, RemoteMachine } from "../model/protocol";

const PLATFORM = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  web: "Web",
} as const;

const report = (error: unknown) => {
  reportAccountFailure(error).catch(() => undefined);
};

const localMachine = () => invoke<RemoteMachine | null>("local_host_connect").catch(() => null);

async function describeLocalHost(): Promise<HostDescriptor | null> {
  const machine = await localMachine();
  if (!machine) return null;
  return remoteRequest<HostDescriptor>(
    machine.id,
    "environment.describe",
    {},
    false,
    false,
    machine.environmentId,
  );
}

/** The Host's https Quick Tunnel origin from `environment.describe`, if it published one. */
async function publishedTunnelEndpoint(machine: RemoteMachine): Promise<string | undefined> {
  const host = await remoteRequest<HostDescriptor>(
    machine.id,
    "environment.describe",
    {},
    false,
    false,
    machine.environmentId,
  );
  if (!host.tunnelRoute) return undefined;
  try {
    const url = new URL(host.tunnelRoute);
    return url.protocol === "https:" && url.hostname.endsWith(".trycloudflare.com")
      ? host.tunnelRoute
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * While signed in and "Let my signed-in phones find this computer" is on: publishes this
 * computer's phone routes to the account and asks the owner before a signed-in phone or computer is allowed
 * to connect. Renders only the approval dialog. Mount once with the workspace notices.
 */
export function PhoneAccountConnect() {
  useLocale();
  const account = useAccountState();
  const enabled = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const deviceId = isSignedIn(account) ? account.deviceId : null;
  const accessSync = useSyncExternalStore(accountDeviceAccess.subscribe, accountDeviceAccess.load);
  const { confirm, dialog } = usePhoneApprovalRequest();
  const confirmRef = useRef(confirm);
  useLayoutEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);

  // Keep the enrolled local Host's device access synchronized while this account is active.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- holds the device-access sync for the signed-in device.
  useEffect(() => {
    if (!deviceId || (accessSync !== deviceId && accessSync !== `off:${deviceId}`)) return;
    return startAccountDeviceAccess(deviceId, localMachine, report);
  }, [accessSync, deviceId]);

  useEffect(() => {
    if (!enabled || !deviceId) return;
    const api = accountApi();
    const stopPublisher = startPhoneConnectPublisher({
      deviceId,
      api,
      describeHost: describeLocalHost,
      onError: report,
    });
    const handle = createPairRequestHandler({
      api,
      approve: async (request) => {
        const machine = await localMachine();
        if (!machine?.environmentId) throw new Error("This computer's Host is unavailable.");
        await approvePairRequest(request, {
          api,
          desktopDeviceId: deviceId,
          environmentId: machine.environmentId,
          createPairingCode: () =>
            createAccountPairingCode(machine, undefined, {
              requester: request.requesterKind === "desktop" ? "desktop" : "phone",
              tunnelEndpoint: () => publishedTunnelEndpoint(machine),
            }),
        });
      },
      ask: (request, approve) =>
        confirmRef.current({
          title:
            request.requesterKind === "desktop"
              ? t("Allow this computer to connect?")
              : t("Allow this phone to connect?"),
          message:
            request.requesterKind === "desktop"
              ? t(
                  "{p0} ({p1}, your account) wants to connect. Check that the code on that computer is {p2}.",
                  {
                    p0: request.phoneName,
                    p1: PLATFORM[request.phonePlatform],
                    p2: pairRequestCode(request),
                  },
                )
              : t(
                  "{p0} ({p1}, your account) wants to connect. Check that the code on the phone is {p2}.",
                  {
                    p0: request.phoneName,
                    p1: PLATFORM[request.phonePlatform],
                    p2: pairRequestCode(request),
                  },
                ),
          confirmLabel: t("Allow"),
          cancelLabel: t("Deny"),
          pendingLabel: t("Connecting…"),
          onConfirm: approve,
        }),
      onError: report,
    });
    const stopInbox = startPhoneConnectInbox({
      api,
      onRequests: handle,
      onError: report,
    });
    return () => {
      handle.dispose();
      stopInbox();
      stopPublisher();
    };
  }, [enabled, deviceId]);

  return dialog;
}
