import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { t, useT } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { Select } from "../../../shared/ui/Select";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { StatusDot } from "../../../shared/ui/StatusDot";
import {
  chooseSettingsHost,
  loadSettingsHosts,
  probeSettingsHost,
  settingsHostEntries,
  settingsHostOptions,
  settingsHostUnavailableMessage,
  type SettingsHostStatus,
} from "../model/settingsHosts";
import type { RemoteMachine } from "../model/protocol";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";
import { LocalHostRevokedFeedback } from "./LocalHostRevoked";

/** Announced when a machine is saved, edited or removed. */
const MACHINES_CHANGED = "bycoda:remote-machines";

/**
 * Which Host a Settings page that stores its data on a Host applies to. Opens on this computer and
 * lists every saved machine with its live state, never waiting for one to answer. `selected` is
 * the chosen machine only while it is connected: a page edits and saves through it and nothing
 * else. A chosen machine that is offline, needs pairing or updating, or was removed is reported
 * by `SettingsHostNotice`; the scope never switches to another machine by itself.
 */
export function useSettingsHostScope() {
  const [choice, setChoice] = useState<string>();
  const hosts = useQuery({
    queryKey: ["settings", "hosts"],
    queryFn: loadSettingsHosts,
    retry: false,
    staleTime: 0,
  });
  const machines: RemoteMachine[] = hosts.data
    ? [...(hosts.data.local ? [hosts.data.local] : []), ...hosts.data.remotes]
    : [];
  // One background probe per machine the store has not heard from; the list never waits on them.
  // An answer reaches the list through the connection store, so only a probe that taught the
  // store nothing (`false`) is read here: that machine is offline, not "checking" forever.
  const probes = useQueries({
    queries: machines.map((machine) => ({
      queryKey: ["settings", "host-probe", machine.id, machine.endpoint],
      queryFn: () => probeSettingsHost(machine),
      enabled: readRemoteConnection(machine.environmentId).status === "connecting",
      retry: false,
    })),
  });
  const unanswered = new Set(
    machines.filter((_, index) => probes[index]?.data === false).map((machine) => machine.id),
  );
  // Rerender whenever any listed machine's live state changes.
  useSyncExternalStore(
    subscribeChanges,
    () =>
      machines
        .map((machine) => {
          const state = readRemoteConnection(machine.environmentId);
          return `${state.status}|${state.error ?? ""}`;
        })
        .join("\n"),
    () => "",
  );
  const entries = hosts.data ? settingsHostEntries(hosts.data, unanswered) : [];
  const chosen = hosts.data
    ? chooseSettingsHost(entries, choice)
    : { entry: undefined, missing: false };
  const entry = chosen.entry;

  const { refetch: refetchHosts } = hosts;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- window listener held while mounted: a machine saved, edited or removed in Connections changes the list
  useEffect(() => {
    const reload = () => void refetchHosts();
    window.addEventListener(MACHINES_CHANGED, reload);
    return () => window.removeEventListener(MACHINES_CHANGED, reload);
  }, [refetchHosts]);

  const options = settingsHostOptions(entries);
  // A removed machine stays visible in the picker, disabled, instead of reading as another one.
  if (chosen.missing && choice !== undefined)
    options.push({ value: choice, label: t("Unavailable machine"), disabled: true });
  return {
    /** The saved machines are still being read. */
    loading: hosts.isPending,
    /** The chosen machine's state is still being learned. */
    checking: entry?.status === "checking",
    /** This computer's Host, whatever its state. */
    local: hosts.data?.local,
    entries,
    /** The chosen machine, whatever its state; undefined when it was removed. */
    entry,
    /** The chosen machine was removed: nothing is selected until the owner picks another. */
    missing: chosen.missing,
    /** The chosen machine, only while it is connected. */
    selected: entry?.status === "connected" ? entry.machine : undefined,
    /** The saved machines could not be read. */
    error: hosts.error ? errorText(hosts.error) : undefined,
    options,
    /** The picker value: the chosen machine, or the removed one. */
    value: chosen.entry?.id ?? choice ?? "",
    select: setChoice,
    /** Reads the saved machines again and asks the chosen one afresh. */
    retry: () => {
      void refetchHosts();
      const index = machines.findIndex((machine) => machine.id === entry?.id);
      if (index >= 0) void probes[index]?.refetch();
    },
  };
}

export type SettingsHostScope = ReturnType<typeof useSettingsHostScope>;

/**
 * What a Settings page shows instead of its editor while the chosen machine cannot be used:
 * Loading, "no longer available" with a way back to this computer, or the reason it is
 * unavailable with Retry (and Reconnect for this computer's revoked link). Renders nothing for a
 * connected machine. `lead` is put before the reason.
 */
export function SettingsHostNotice({ scope, lead }: { scope: SettingsHostScope; lead?: string }) {
  const t = useT();
  if (scope.loading || scope.checking)
    return <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>;
  const retry = { label: t("Retry"), onClick: scope.retry };
  if (scope.error)
    return (
      <SettingsFeedback state="error" action={retry}>
        {[lead, scope.error].filter(Boolean).join(" ")}
      </SettingsFeedback>
    );
  if (scope.missing)
    return (
      <SettingsFeedback
        state="error"
        action={{ label: t("Use this computer"), onClick: () => scope.select(undefined) }}
      >
        {t("This machine is no longer available.")}
      </SettingsFeedback>
    );
  const { entry } = scope;
  const message = entry ? settingsHostUnavailableMessage(entry) : undefined;
  if (!entry || !message) return null;
  if (entry.status === "pair-again" && entry.isLocal && entry.machine)
    return <LocalHostRevokedFeedback machine={entry.machine} onReconnected={scope.retry} />;
  return (
    <SettingsFeedback state="error" action={retry}>
      {[lead, message].filter(Boolean).join(" ")}
    </SettingsFeedback>
  );
}

/**
 * A Host load failure on a Settings page whose chosen machine is connected: `message` with Retry,
 * or "Reconnect" when `revoked` says this computer's own Host refused the saved link.
 */
export function SettingsHostFailure({
  scope,
  message,
  revoked = false,
  onRetry,
}: {
  scope: SettingsHostScope;
  message: ReactNode;
  /** The failure was the Host refusing this computer's credential (`isHostAuthorizationRefusal`). */
  revoked?: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (revoked && scope.local && scope.local.id === scope.selected?.id)
    return (
      <LocalHostRevokedFeedback
        machine={scope.local}
        onReconnected={() => {
          scope.retry();
          onRetry();
        }}
      />
    );
  return (
    <SettingsFeedback state="error" action={{ label: t("Retry"), onClick: onRetry }}>
      {message}
    </SettingsFeedback>
  );
}

/** Decorative state mark before a machine's name; the option text names the state. */
function HostStatusDot({ status }: { status?: SettingsHostStatus }) {
  switch (status) {
    case "connected":
      return <StatusDot tone="success" />;
    case "offline":
      return <StatusDot tone="muted" appearance="presence" hollow />;
    case "pair-again":
      return <StatusDot tone="danger" />;
    case "update-needed":
      return <StatusDot tone="warning" />;
    case "checking":
      return <StatusDot tone="muted" />;
    default:
      return <StatusDot tone="danger" hollow appearance="presence" />;
  }
}

/** "Applying settings to <machine>"; hidden while this computer is the only saved machine. */
export function SettingsHostPicker({ scope }: { scope: SettingsHostScope }) {
  const t = useT();
  if (scope.entries.length < 2) return null;
  return (
    <div className="max-w-xs">
      <Select
        label={t("Applying settings to")}
        value={scope.value}
        options={scope.options.map(({ status, ...option }) => ({
          ...option,
          icon: <HostStatusDot status={status} />,
        }))}
        onValueChange={scope.select}
        fieldSize="sm"
      />
    </div>
  );
}
