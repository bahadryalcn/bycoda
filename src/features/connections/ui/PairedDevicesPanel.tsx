import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  isPhoneConnectEnabled,
  isSignedIn,
  setPhoneConnectEnabled,
  subscribePhoneConnect,
  useAccountState,
} from "../../account";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ConfirmMorph } from "../../../shared/ui/ConfirmMorph";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Group, Row, useConfirmedPreferences } from "../../../shared/ui/settings";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { KeyRound, Laptop, Plus, RefreshCw, Smartphone } from "../../../shared/ui/icons";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { isLocalSyncMachine, LOCAL_SYNC_MACHINE_NAME } from "../model/localSync";
import { accountDeviceAccess } from "../model/accountDeviceAccess";
import {
  revokePairedDevice,
  setPairedDeviceManagement,
  type PairedDevice,
} from "../model/pairedDevices";
import type { PhoneConnectionPanelProps } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";
import { usePhonePairing } from "../model/usePhonePairing";
import { LocalNetworkAccessRow } from "./LocalNetworkAccessRow";
import { PublicPhoneAccessRow } from "./PublicPhoneAccessRow";
import { PhonePairingDialog } from "./PhonePairingDialog";
import { entryKey, usePairedDevices, type PairedDevicesEntry } from "./usePairedDevices";

function RefreshDevicesButton({
  disabled,
  readDevices,
  refreshInventory,
}: {
  disabled: boolean;
  readDevices: () => Promise<void>;
  refreshInventory: PhoneConnectionPanelProps["onRefresh"];
}) {
  const [pending, setPending] = useState(false);
  const started = useRef(false);
  const refresh = async () => {
    if (started.current) return;
    started.current = true;
    setPending(true);
    try {
      const results = await Promise.allSettled(
        [readDevices, refreshInventory].map(async (load) => load()),
      );
      for (const result of results)
        if (result.status === "rejected") console.warn("Could not refresh devices", result.reason);
    } finally {
      started.current = false;
      setPending(false);
    }
  };
  return (
    <Button
      iconOnly
      variant="ghost"
      label={t("Refresh devices")}
      disabled={disabled && !pending}
      disabledReason={disabled && !pending ? t("Wait for the status check to finish.") : undefined}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={refresh}
    >
      <RefreshCw aria-hidden className="icon-md" />
    </Button>
  );
}

function DeviceIcon({ device }: { device: PairedDevice }) {
  const Icon = device.kind === "phone" ? Smartphone : device.kind === "desktop" ? Laptop : KeyRound;
  return <Icon aria-hidden className="icon-sm shrink-0" tone="muted" />;
}

function hasLocalSyncName(device: PairedDevice) {
  return device.kind !== "phone" && device.name === LOCAL_SYNC_MACHINE_NAME;
}

function DeviceRow({
  machine,
  device,
  canRevoke,
  onRevoked,
}: {
  machine: RemoteMachine;
  device: PairedDevice;
  canRevoke: boolean;
  onRevoked: () => void;
}) {
  const format = useFormat();
  const settings = useConfirmedPreferences();
  const canEdit = !device.isCurrent && canRevoke;
  const permission = device.canManageDevices;
  const now = wallClockNow();
  const activity =
    device.lastSeenAt !== undefined
      ? t("Active {p0}", { p0: format.formatRelativeTime(device.lastSeenAt, { now }) })
      : device.pairedAt !== undefined
        ? t("Paired {p0}", { p0: format.formatDate(device.pairedAt, { dateStyle: "medium" }) })
        : undefined;
  return (
    <Row
      label={
        <span className="flex min-w-0 items-center gap-2">
          {device.isCurrent ? (
            <InfoTooltip
              label={t("This desktop")}
              icon={<Laptop aria-hidden className="icon-sm shrink-0" tone="accent" />}
            >
              {t("This desktop")}
            </InfoTooltip>
          ) : (
            <DeviceIcon device={device} />
          )}
          <Text truncate size="inherit" tone="inherit" className="min-w-0">
            {hasLocalSyncName(device) ? t("Local sync") : device.name}
          </Text>
        </span>
      }
      description={activity}
      descriptionVisible={Boolean(activity)}
      descriptionTone="muted"
      feedback={settings.feedback(device.id)}
    >
      {canEdit && permission !== undefined ? (
        <Switch
          label={t("Manage devices")}
          checked={permission}
          disabled={settings.pending(device.id)}
          onCheckedChange={(enabled) =>
            settings.commit(device.id, {
              write: async () => {
                const updated = await setPairedDeviceManagement(machine, device, enabled);
                onRevoked();
                return updated;
              },
            })
          }
        />
      ) : null}
      {!device.isCurrent ? (
        <ConfirmMorph
          label={t("Revoke")}
          tone="danger"
          disabled={!canRevoke}
          confirmLabel={t("Revoke access")}
          pendingLabel={t("Revoking…")}
          doneLabel={t("Revoked")}
          errorLabel={t("Revoke failed")}
          onConfirm={async () => {
            await revokePairedDevice(machine, device);
            onRevoked();
          }}
        />
      ) : null}
    </Row>
  );
}

function ComputerDevices({
  machine,
  entry,
  onChanged,
  onRetry,
}: {
  machine: RemoteMachine;
  entry: PairedDevicesEntry | undefined;
  onChanged: () => void;
  onRetry: () => void;
}) {
  const format = useFormat();
  const isLocal = isLocalSyncMachine(machine);
  const title = isLocal ? t("This computer") : machine.name;
  const list = entry?.phase === "ready" ? entry.list : undefined;
  const devices = list?.state === "ready" ? list.devices : [];
  const visibleDevices = devices.filter(
    (device) =>
      !device.isLocalDesktop && !(isLocal && device.isCurrent && hasLocalSyncName(device)),
  );
  const feedback =
    !entry || entry.phase === "loading" ? (
      <LoadingText>{t("Loading devices…")}</LoadingText>
    ) : entry.phase === "error" ? (
      <InlineError retry={{ onRetry }}>
        {t("Could not read the devices of {p0}.", { p0: title })}
      </InlineError>
    ) : entry.stale ? (
      // The last good list stays (and stays revocable); it just must not pass for current.
      <InlineMessage tone="warning" retry={{ onRetry }}>
        {t("Could not refresh. Showing the list from {p0}.", {
          p0: format.formatRelativeTime(entry.updatedAt, { now: wallClockNow() }),
        })}
      </InlineMessage>
    ) : list?.state === "unsupported" ? (
      <InlineMessage tone="neutral">
        {t("Update the host on {p0} to see its devices.", { p0: title })}
      </InlineMessage>
    ) : list?.state === "ready" && list.truncated ? (
      // The Host lists at most 256; the rest stay reachable from its CLI.
      <InlineMessage tone="warning">
        {t(
          "{p0} has more devices than this list shows. Run bycoda-host devices on it to see them all.",
          { p0: title },
        )}
      </InlineMessage>
    ) : entry.canRevoke ? undefined : (
      <InlineMessage tone="neutral">
        {devices.some((device) => device.isCurrent && device.canManageDevices === false)
          ? t("This desktop cannot manage devices on {p0}.", { p0: title })
          : t("Update the host on {p0} to revoke devices from here.", { p0: title })}
      </InlineMessage>
    );
  return (
    <Group title={title} feedback={feedback}>
      {visibleDevices.map((device) => (
        <DeviceRow
          key={device.id}
          machine={machine}
          device={device}
          canRevoke={entry?.phase === "ready" && entry.canRevoke}
          onRevoked={onChanged}
        />
      ))}
      {list?.state === "ready" && !visibleDevices.some((device) => !device.isCurrent) ? (
        <Row label={t("No other devices")} />
      ) : null}
    </Group>
  );
}

/**
 * The Devices tab: every credential each connected computer accepts, with revoke, plus
 * pairing a phone (in a dialog) and this computer's phone access settings.
 */
export function PairedDevicesPanel({
  machines,
  loaded,
  loading,
  onRefresh,
  active = true,
}: PhoneConnectionPanelProps) {
  useLocale();
  const ordered = [...machines].sort(
    (a, b) => Number(isLocalSyncMachine(b)) - Number(isLocalSyncMachine(a)),
  );
  const { state, coordinator } = usePhonePairing();
  const [pairing, setPairing] = useState(false);
  const account = useAccountState();
  const { entries, scope, retry, refreshAfterChange } = usePairedDevices(
    ordered,
    active,
    isSignedIn(account) ? account.context.user.id : null,
  );
  const signedIn = isSignedIn(account);
  const accountConnect = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const local = ordered.find(isLocalSyncMachine);
  const accessSync = useSyncExternalStore(accountDeviceAccess.subscribe, accountDeviceAccess.load);
  const accountDeviceId = isSignedIn(account) ? account.deviceId : null;
  const openPairing = () => {
    const machine = ordered[0];
    if (!machine) return;
    setPairing(true);
    void coordinator.open(machine);
  };
  const closePairing = () => {
    // A phone that just paired shows up at once instead of on the next poll.
    if (state.stage === "paired") refreshAfterChange();
    coordinator.close();
    setPairing(false);
  };
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Releases the Host's live pairing code when the tab is hidden, since the panel stays mounted.
  useEffect(() => {
    if (active) return;
    coordinator.close();
    setPairing(false);
  }, [active, coordinator]);

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel
        as="h2"
        actions={
          <>
            <RefreshDevicesButton
              key={scope}
              disabled={!loaded || loading}
              readDevices={retry}
              refreshInventory={onRefresh}
            />
            <Button
              variant="primary"
              aria-haspopup="dialog"
              disabled={ordered.length === 0}
              disabledReason={ordered.length === 0 ? t("Add a computer first.") : undefined}
              onClick={openPairing}
            >
              <Plus aria-hidden className="icon-sm" />
              {t("Connect a phone")}
            </Button>
          </>
        }
      >
        {t("Devices with access")}
      </SectionLabel>
      <div className="connections-management-grid">
        <div className="settings-topics">
          {!loaded && loading && ordered.length === 0 ? (
            <LoadingText>{t("Loading devices…")}</LoadingText>
          ) : null}
          {loaded && !loading && ordered.length === 0 ? (
            <EmptyState
              kind="empty"
              illustration={false}
              title={t("No computer connected")}
              description={t("Add a computer first, then connect a phone to it.")}
            />
          ) : null}
          {ordered.map((machine) => (
            <ComputerDevices
              key={machine.id}
              machine={machine}
              entry={entries[entryKey(machine)]}
              onChanged={refreshAfterChange}
              onRetry={retry}
            />
          ))}
        </div>
        <div className="settings-topics">
          {local ? (
            <Group title={t("Account recovery")}>
              <Row
                label={t("Manage this computer from my account")}
                info={t(
                  "Your account stores device names and permissions. Changes apply when bycoda is open and signed in on this computer.",
                )}
                disabled={!accountDeviceId}
                disabledReason={t("Sign in to your account first")}
              >
                <Switch
                  aria-label={t("Manage this computer from my account")}
                  checked={Boolean(accountDeviceId && accessSync === accountDeviceId)}
                  disabled={!accountDeviceId}
                  onCheckedChange={(enabled) => {
                    if (accountDeviceId)
                      accountDeviceAccess.save(
                        enabled ? accountDeviceId : `off:${accountDeviceId}`,
                      );
                  }}
                />
              </Row>
            </Group>
          ) : null}
          <Group
            title={t("Private — only your devices")}
            description={t(
              "Reachable only from your own network or Tailscale network. Never from the public internet.",
            )}
            descriptionVisible
          >
            {local ? <LocalNetworkAccessRow machine={local} active={active} /> : null}
            {local ? (
              <LocalNetworkAccessRow machine={local} active={active} mode="tailscale" />
            ) : null}
            <Row
              label={t("Let my signed-in phones find this computer")}
              info={t(
                "Phones signed in to your account can ask to connect, and you approve each one here. Needs bycoda open and your account signed in; route addresses are stored in your account.",
              )}
              disabled={!signedIn}
              disabledReason={t("Sign in to your account first")}
            >
              <Switch
                checked={accountConnect && signedIn}
                disabled={!signedIn}
                onCheckedChange={setPhoneConnectEnabled}
                aria-label={t("Let my signed-in phones find this computer")}
              />
            </Row>
          </Group>
          {local ? (
            <Group
              title={t("Public internet")}
              description={t(
                "Cloudflare, ngrok and Tailscale Funnel tunnels (started under Sharing) are public: anyone on the internet can reach the address, and only a device credential protects it.",
              )}
              descriptionVisible
              feedback={
                <InlineMessage tone="warning">
                  {t(
                    "Public paths are separate from the private ones above and are used only by choice.",
                  )}
                </InlineMessage>
              }
            >
              <PublicPhoneAccessRow machine={local} active={active} />
            </Group>
          ) : null}
        </div>
      </div>
      {pairing && state.stage !== "closed" ? (
        <PhonePairingDialog
          machines={ordered}
          state={state}
          onSelect={(selected) => void coordinator.open(selected)}
          onMode={(mode) => void coordinator.selectMode(mode)}
          onClose={closePairing}
          onRefresh={() => void coordinator.refresh()}
          onEnable={(address) => void coordinator.enable(address)}
          onDisable={() => void coordinator.disable()}
          onCreate={() => void coordinator.create()}
          onRegenerate={() => void coordinator.regenerate()}
        />
      ) : null}
    </div>
  );
}
