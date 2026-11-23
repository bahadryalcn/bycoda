import { useEffect, useState, useSyncExternalStore } from "react";
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
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Group, Row } from "../../../shared/ui/settings";
import { Switch } from "../../../shared/ui/Switch";
import { Text } from "../../../shared/ui/Text";
import { KeyRound, Laptop, Plus, RefreshCw, Smartphone } from "../../../shared/ui/icons";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { isLocalSyncMachine } from "../model/localSync";
import { revokePairedDevice, type PairedDevice } from "../model/pairedDevices";
import type { PhoneConnectionPanelProps } from "../model/phonePairingTypes";
import type { RemoteMachine } from "../model/protocol";
import { usePhonePairing } from "../model/usePhonePairing";
import { LocalNetworkAccessRow } from "./LocalNetworkAccessRow";
import { PhonePairingDialog } from "./PhonePairingDialog";
import { entryKey, usePairedDevices, type PairedDevicesEntry } from "./usePairedDevices";

function DeviceIcon({ device }: { device: PairedDevice }) {
  const Icon = device.kind === "phone" ? Smartphone : device.kind === "desktop" ? Laptop : KeyRound;
  return <Icon aria-hidden className="icon-sm shrink-0" tone="muted" />;
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
          <DeviceIcon device={device} />
          <Text truncate size="inherit" tone="inherit" className="min-w-0">
            {device.name}
          </Text>
        </span>
      }
      description={activity}
      descriptionVisible={Boolean(activity)}
    >
      {device.isCurrent ? null : (
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
      )}
    </Row>
  );
}

function ComputerDevices({
  machine,
  entry,
  onChanged,
}: {
  machine: RemoteMachine;
  entry: PairedDevicesEntry | undefined;
  onChanged: () => void;
}) {
  const format = useFormat();
  const title = isLocalSyncMachine(machine) ? t("This computer") : machine.name;
  const list = entry?.phase === "ready" ? entry.list : undefined;
  const devices = list?.state === "ready" ? list.devices : [];
  const others = devices.filter((device) => !device.isCurrent);
  const feedback =
    !entry || entry.phase === "loading" ? (
      <LoadingText>{t("Loading devices…")}</LoadingText>
    ) : entry.phase === "error" ? (
      <InlineError retry={{ onRetry: onChanged }}>
        {t("Could not read the devices of {p0}.", { p0: title })}
      </InlineError>
    ) : entry.stale ? (
      // The last good list stays (and stays revocable); it just must not pass for current.
      <InlineMessage tone="warning" retry={{ onRetry: onChanged }}>
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
        {t("Update the host on {p0} to revoke devices from here.", { p0: title })}
      </InlineMessage>
    );
  return (
    <Group title={title} feedback={feedback}>
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          machine={machine}
          device={device}
          canRevoke={entry?.phase === "ready" && entry.canRevoke}
          onRevoked={onChanged}
        />
      ))}
      {list?.state === "ready" && others.length === 0 ? (
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
  const { entries, refresh } = usePairedDevices(ordered, active);
  const { state, coordinator } = usePhonePairing();
  const [pairing, setPairing] = useState(false);
  const signedIn = isSignedIn(useAccountState());
  const accountConnect = useSyncExternalStore(subscribePhoneConnect, isPhoneConnectEnabled);
  const local = ordered.find(isLocalSyncMachine);
  const openPairing = () => {
    const machine = ordered[0];
    if (!machine) return;
    setPairing(true);
    void coordinator.open(machine);
  };
  const closePairing = () => {
    // A phone that just paired shows up at once instead of on the next poll.
    if (state.stage === "paired") refresh();
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
            <Button
              iconOnly
              variant="ghost"
              label={t("Refresh devices")}
              disabled={!loaded || loading}
              onClick={() => {
                refresh();
                void onRefresh();
              }}
            >
              <RefreshCw aria-hidden className="icon-md" />
            </Button>
            <Button
              variant="primary"
              aria-haspopup="dialog"
              disabled={ordered.length === 0}
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
            <EmptyState kind="empty" title={t("No computer connected")} />
          ) : null}
          {ordered.map((machine) => (
            <ComputerDevices
              key={machine.id}
              machine={machine}
              entry={entries[entryKey(machine)]}
              onChanged={refresh}
            />
          ))}
        </div>
        <div>
          <Group title={t("Phone access")}>
            {local ? <LocalNetworkAccessRow machine={local} active={active} /> : null}
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
