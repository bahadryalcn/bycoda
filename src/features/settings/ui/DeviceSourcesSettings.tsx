import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { AndroidIcon, Apple, MoreHorizontal, Plus } from "../../../shared/ui/icons";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { toast } from "../../../shared/ui/ToastRegion";
import { Group, Row, SettingsFeedback, Toggle } from "../../../shared/ui/settings";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import type { DeviceHostStatus } from "../../../shared/model/host-contracts/native-devices";
import type { RemoteMachine } from "../../connections";
import { requestMachineEdit } from "../../connections/public/connections";
import { hostToolRequest, listHostToolMachines } from "../../connections/public/hostFeatureClient";
import { isLocalSyncMachine } from "../../connections/public/localSync";
import { toolPreferences } from "../../host-tools/public/toolPreferences";
import { loadHostAgentDevices, saveHostAgentDevices } from "../model/hostAgentDevices";
import { openSettingsSection } from "../model/settingsLink";

type SourceStatus =
  | { state: "loading" }
  | { state: "ready"; status: DeviceHostStatus }
  | { state: "error"; message: string };

const LOCAL_SOURCE = "local";

function sourceStatus(source: string) {
  return hostToolRequest<DeviceHostStatus>(
    "",
    "device.host",
    "devices.status",
    {},
    source === LOCAL_SOURCE ? { kind: "local" } : { kind: "machine", machineId: source },
  );
}

/** This computer's Host switch for agent device tools; the Host refuses them while off. */
export function AgentDevicesRow({ description }: { description: string }) {
  useLocale();
  const [enabled, setEnabled] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the mounted switch with the local Host setting and discard late replies when it closes.
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    loadHostAgentDevices().then(
      (value) => {
        if (active) setEnabled(value);
      },
      (reason: unknown) => {
        if (active) setError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const onChange = (next: boolean) => {
    setSaving(true);
    setError(undefined);
    saveHostAgentDevices(next)
      .then(setEnabled, (reason: unknown) => setError(errorText(reason)))
      .finally(() => setSaving(false));
  };
  return (
    <Row
      id="device-agent-access"
      label={t("Agents can use devices")}
      description={description}
      descriptionVisible
      feedback={
        error ? (
          <SettingsFeedback state="error">
            {t("Could not reach this computer's Host setting: {p1}", {
              p1: error,
            })}
          </SettingsFeedback>
        ) : undefined
      }
    >
      <Toggle
        label={t("Agents can use devices")}
        on={enabled === true}
        disabled={enabled === undefined || saving}
        onChange={onChange}
      />
    </Row>
  );
}

function PlatformIcons({ status }: { status: SourceStatus }) {
  if (status.state === "error") return null;
  const platforms = status.state === "ready" ? status.status.platforms : [];
  return (
    <span className="flex items-center gap-1.5" aria-busy={status.state === "loading"}>
      {(["ios", "android"] as const).map((platform) => {
        const entry = platforms.find((item) => item.platform === platform);
        const name = platform === "ios" ? t("iOS Simulator") : t("Android Emulator");
        const Icon = platform === "ios" ? Apple : AndroidIcon;
        const label = !entry
          ? name
          : entry.available
            ? t("{p1} available", { p1: name })
            : t("{p1} unavailable", { p1: name });
        return (
          <Tooltip key={platform} label={label} details={entry?.reason ? [entry.reason] : []}>
            <Icon
              className="icon-sm"
              tone={entry?.available ? "primary" : "muted"}
              aria-label={label}
            />
          </Tooltip>
        );
      })}
    </span>
  );
}

/** Where the Devices panel finds simulators: this computer and each saved bycoda machine. */
export function DeviceSourcesGroup() {
  useLocale();
  const [machines, setMachines] = useState<RemoteMachine[]>();
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});
  const [menu, setMenu] = useState<{ source: string; anchor: HTMLElement }>();
  const [hidden] = useStoredPreferenceState(
    toolPreferences.deviceHiddenMachines.load,
    toolPreferences.deviceHiddenMachines.subscribe,
  );

  const check = (source: string, announce = false) => {
    setStatuses((current) => ({ ...current, [source]: { state: "loading" } }));
    return sourceStatus(source).then(
      (status) => {
        setStatuses((current) => ({
          ...current,
          [source]: { state: "ready", status },
        }));
        if (announce) toast.show({ title: t("Connected"), tone: "success" });
      },
      (reason: unknown) => {
        const message = errorText(reason);
        setStatuses((current) => ({
          ...current,
          [source]: { state: "error", message },
        }));
        if (announce)
          toast.show({
            title: t("Connection failed"),
            tone: "danger",
            extra: <ErrorDetails detail={message} title={t("Connection failed")} />,
          });
      },
    );
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Load saved machines and each source's device status while this section is mounted.
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    setLoadError("");
    listHostToolMachines().then(
      (values) => {
        if (!active) return;
        const remote = values.filter(
          (machine) => !machine.localHost && !isLocalSyncMachine(machine),
        );
        setMachines(remote);
        for (const source of [LOCAL_SOURCE, ...remote.map((machine) => machine.id)])
          void check(source);
      },
      (reason: unknown) => {
        if (active) setLoadError(errorText(reason));
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `check` only writes state; reload drives refreshes.
  }, [reload]);

  const desktop = isTauri();
  const setHidden = (machineId: string, hide: boolean) => {
    const next = hide
      ? [...new Set([...hidden, machineId])]
      : hidden.filter((id) => id !== machineId);
    try {
      toolPreferences.deviceHiddenMachines.save(next);
    } catch {
      toast.show({ title: t("Could not save changes"), tone: "danger" });
    }
  };

  const menuItems = (source: string): DropdownMenuItem[] => {
    const items: DropdownMenuItem[] = [{ kind: "item", id: "test", label: t("Test connection") }];
    if (source === LOCAL_SOURCE) return items;
    return [
      ...items,
      { kind: "sep" },
      hidden.includes(source)
        ? { kind: "item", id: "restore", label: t("Show in Devices") }
        : {
            kind: "item",
            id: "remove",
            label: t("Remove from Devices"),
            danger: true,
          },
    ];
  };

  const renderRow = (source: string, machine?: RemoteMachine) => {
    const status = statuses[source] ?? { state: "loading" };
    const removed = !!machine && hidden.includes(machine.id);
    const name = machine?.name ?? t("This computer");
    const description = removed
      ? t("Removed from the Devices panel.")
      : status.state === "error"
        ? t("Unreachable: {p1}", { p1: status.message })
        : machine
          ? (machine.ssh?.target ?? machine.endpoint)
          : t("Simulators and emulators installed on this computer.");
    return (
      <Row
        key={source}
        label={
          <span className="flex min-w-0 items-center gap-2">
            <Text size="inherit" tone="inherit" leading="inherit" truncate>
              {name}
            </Text>
            {machine ? <Badge size="xs">{machine.ssh ? "SSH" : t("Host")}</Badge> : null}
          </span>
        }
        description={description}
        descriptionVisible
      >
        <span className="flex items-center gap-2">
          {removed ? null : <PlatformIcons status={status} />}
          {machine ? (
            <Button size="sm" variant="secondary" onClick={() => requestMachineEdit(machine.id)}>
              {t("Edit")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            label={t("Actions for {p0}", { p0: name })}
            tooltip={t("Source actions")}
            aria-haspopup="menu"
            aria-expanded={menu?.source === source}
            loading={status.state === "loading" && statuses[source] !== undefined}
            onClick={(event) => {
              const anchor = event.currentTarget;
              setMenu((current) => (current?.source === source ? undefined : { source, anchor }));
            }}
          >
            <MoreHorizontal className="icon-md" strokeWidth={1.75} aria-hidden />
          </Button>
        </span>
      </Row>
    );
  };

  return (
    <Group
      id="device-sources"
      title={t("Device sources")}
      layout="full"
      description={t(
        "The Devices panel can use simulators on this computer and on saved computers running bycoda Host.",
      )}
      action={
        <Button size="sm" onClick={() => openSettingsSection("connections")}>
          <Plus className="icon-sm" strokeWidth={1.75} aria-hidden />
          {t("Add source")}
        </Button>
      }
      feedback={
        !desktop ? (
          <SettingsFeedback state="empty">
            {t("Device sources are managed in the desktop app.")}
          </SettingsFeedback>
        ) : loadError ? (
          <SettingsFeedback
            state="error"
            action={{
              label: t("Retry"),
              onClick: () => setReload((value) => value + 1),
            }}
          >
            {t("Could not load saved computers: {p1}", { p1: loadError })}
          </SettingsFeedback>
        ) : !machines ? (
          <SettingsFeedback state="loading">{t("Loading device sources…")}</SettingsFeedback>
        ) : undefined
      }
    >
      {desktop ? renderRow(LOCAL_SOURCE) : null}
      {machines?.map((machine) => renderRow(machine.id, machine))}
      {menu ? (
        <DropdownMenu
          anchor={menu.anchor}
          label={t("Source actions")}
          items={menuItems(menu.source)}
          onClose={() => setMenu(undefined)}
          onPick={(id) => {
            const { source } = menu;
            setMenu(undefined);
            if (id === "test") void check(source, true);
            else if (id === "remove") setHidden(source, true);
            else if (id === "restore") setHidden(source, false);
          }}
        />
      ) : null}
    </Group>
  );
}
