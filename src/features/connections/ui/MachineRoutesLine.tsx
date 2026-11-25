import { Text } from "../../../shared/ui/Text";
import { invoke } from "@tauri-apps/api/core";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import {
  mergeRoutes,
  type MachineRoute as Route,
  type MachineRoutes,
  type RoutePreference,
} from "../model/machineRoutes";
import type { RemoteMachine } from "../model/protocol";
import { classifyRemoteError } from "../model/remoteFailure";

export type { RoutePreference };

type RouteCheck = { address: string; reachable: boolean | null };

/** Tauri's rejection for a command this desktop build does not register: an older desktop
 * without the route store. Only the saved other address is known then, which is expected. */
const MISSING_ROUTE_COMMAND = /^(?:Error: )?Command remote_machine_routes not found$/;
const olderDesktop = (reason: unknown) =>
  classifyRemoteError(reason).kind === "outdated" || MISSING_ROUTE_COMMAND.test(errorText(reason));

const kindLabel = (kind: Route["kind"]) =>
  kind === "tailscale"
    ? t("Tailscale")
    : kind === "lan"
      ? t("Home network")
      : kind === "tunnel"
        ? t("Tunnel")
        : kind === "url"
          ? t("Host URL")
          : t("SSH name");
const sourceLabel = (route: Route, ssh: boolean) =>
  route.source === "account"
    ? t("Found automatically")
    : route.source === "saved"
      ? ssh
        ? t("SSH address")
        : t("Saved address")
      : route.source === "other"
        ? t("Other address")
        : t("Found by the host");

/** A machine's ways in, in the order a connection tries them, with whether each
 * answers now and which one is in use. The SSH and other address are the
 * owner's own entries and are always tried (Edit changes them); an address the
 * host found can be turned off. The order never moves when a switch changes. */
export function MachineRoutesLine({ machine }: { machine: RemoteMachine }) {
  return (
    <MachineRouteDetails key={`${machine.id}:${JSON.stringify(machine.ssh)}`} machine={machine} />
  );
}

function MachineRouteDetails({ machine }: { machine: RemoteMachine }) {
  useLocale();
  const ssh = machine.ssh;
  const [routes, setRoutes] = useState<MachineRoutes>();
  const [checks, setChecks] = useState<Record<string, boolean | null>>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState(false);
  const [probeError, setProbeError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(ssh ?? null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps this mounted machine's native route snapshot current across retries and cancels obsolete reads on cleanup.
  useEffect(() => {
    let current = true;
    const target = JSON.parse(key) as RemoteMachine["ssh"];
    setLoading(true);
    setReadError(false);
    setProbeError(false);
    invoke<MachineRoutes>("remote_machine_routes", {
      machineId: machine.id,
      target,
      environmentId: machine.environmentId,
    })
      .then((value) => current && setRoutes(value))
      .catch((reason: unknown) => {
        if (current) setReadError(!olderDesktop(reason));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    // Only SSH addresses can be checked from here; a Host URL answers through its own requests.
    (target
      ? invoke<RouteCheck[]>("remote_machine_route_check", { target })
      : Promise.resolve<RouteCheck[]>([])
    )
      .then(
        (value) =>
          current &&
          setChecks(Object.fromEntries(value.map((check) => [check.address, check.reachable]))),
      )
      .catch(() => {
        if (current) {
          setChecks({});
          setProbeError(true);
        }
      });
    return () => {
      current = false;
    };
  }, [machine.id, machine.environmentId, key, retry]);
  if (!ssh && !routes) return null;
  // Without the desktop's route store only the saved other address is known.
  if (!routes)
    return (
      <div>
        {loading ? (
          <LoadingText />
        ) : readError ? (
          <InlineError
            retry={{
              onRetry: () => setRetry((value) => value + 1),
              label: t("Retry"),
              pending: loading,
            }}
          >
            {t("Addresses could not be loaded.")}
          </InlineError>
        ) : null}
        {ssh?.alternate ? (
          <Text wrap="anywhere" as="div" tone="muted">
            {t("Other address: {p0}", { p0: ssh.alternate })}
          </Text>
        ) : null}
      </div>
    );
  const save = (disabled: string[], prefer: RoutePreference) => {
    if (!ssh) return;
    setSaving(true);
    setError("");
    invoke<MachineRoutes>("remote_machine_route_settings", {
      machineId: machine.id,
      target: ssh,
      disabled,
      prefer,
    })
      .then(setRoutes)
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setSaving(false));
  };
  const shown = mergeRoutes(machine, routes);
  const disabled = routes.routes.filter((route) => !route.enabled).map((route) => route.address);
  const toggle = (address: string, on: boolean) =>
    save(
      on ? disabled.filter((value) => value !== address) : [...disabled, address],
      routes.prefer,
    );
  return (
    <section className="mt-3 flex flex-col gap-2" data-machine-routes aria-label={t("Addresses")}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <Text as="div" size="secondary" tone="inherit" weight="medium">
              {t("Addresses")}
            </Text>
            <InfoPopover label={t("About addresses")}>
              <Text as="p">{t("Tried in this order; the first one that answers is used.")}</Text>
              {ssh ? (
                <Text as="p" tone="muted" className="mt-2">
                  {t("Change the SSH and other address with Edit name and address.")}
                </Text>
              ) : null}
            </InfoPopover>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {ssh && routes.routes.length > 1 ? (
            <div className="w-48">
              <Select
                label={t("Try first")}
                fieldSize="sm"
                value={routes.prefer}
                disabled={saving}
                onValueChange={(value) => {
                  if (!saving) save(disabled, value as RoutePreference);
                }}
                options={[
                  { value: "saved", label: t("SSH address") },
                  { value: "lan", label: t("Home network") },
                  { value: "tailscale", label: t("Tailscale") },
                ]}
              />
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={saving}
            loading={loading}
            onClick={() => setRetry((value) => value + 1)}
          >
            {readError || probeError ? t("Retry") : t("Check again")}
          </Button>
        </div>
      </div>
      <Surface as="ul" padding="none" dividers="pane" className="flex flex-col">
        {shown.routes.map((route) => {
          const inUse = route.address === routes.active;
          const reachable = checks?.[route.address];
          return (
            <li
              key={route.address}
              data-route={route.address}
              className="flex min-w-0 flex-wrap items-center gap-2 py-2"
            >
              <div className={`min-w-0 flex-1 ${route.enabled ? "" : "opacity-60"}`}>
                <Text as="div" size="secondary" tone="inherit" family="mono" truncate>
                  {route.address}
                </Text>
                <Text as="div" tone="muted">
                  {kindLabel(route.kind)} · {sourceLabel(route, Boolean(ssh))}
                </Text>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {inUse ? <StatusDot tone="accent" label={t("In use")} /> : null}
                {route.enabled && reachable === false ? (
                  <StatusDot tone="warning" label={t("No response")} />
                ) : null}
                {route.source === "reported" ? (
                  <Switch
                    aria-label={t("Use {p0}", { p0: route.address })}
                    checked={route.enabled}
                    disabled={saving}
                    onCheckedChange={(on) => toggle(route.address, on)}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </Surface>
      {/* One message at a time; the Check again / Retry button above is the recovery. */}
      {error ? (
        <InlineError details={error}>{t("Could not change this address.")}</InlineError>
      ) : readError ? (
        <InlineError>{t("Addresses could not be loaded.")}</InlineError>
      ) : probeError ? (
        <InlineError>{t("Address check unavailable.")}</InlineError>
      ) : null}
    </section>
  );
}
