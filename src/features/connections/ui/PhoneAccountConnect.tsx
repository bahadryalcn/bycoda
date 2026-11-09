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
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { createAccountPairingCode } from "../model/accountPairingCode";
import { remoteRequest } from "../model/connections";
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

/**
 * While signed in and "Let my signed-in phones find this computer" is on: publishes this
 * computer's phone routes to the account and asks the owner before a signed-in phone is allowed
 * to connect. Renders only the approval dialog. Mount once with the workspace notices.
 */
export function PhoneAccountConnect() {
  useLocale();
  const account = useAccountState();
  const enabled = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const deviceId = isSignedIn(account) ? account.deviceId : null;
  const { confirm, dialog } = useConfirm();
  const confirmRef = useRef(confirm);
  useLayoutEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);

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
          createPairingCode: () => createAccountPairingCode(machine),
        });
      },
      ask: (request, approve) =>
        confirmRef.current({
          title: t("Allow this phone to connect?"),
          message: t(
            "{phone} ({platform}, your account) wants to connect. Check that the code on the phone is {code}.",
            {
              phone: request.phoneName,
              platform: PLATFORM[request.phonePlatform],
              code: pairRequestCode(request),
            },
          ),
          confirmLabel: t("Allow"),
          cancelLabel: t("Deny"),
          pendingLabel: t("Connecting…"),
          tone: "neutral",
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
