import { Text } from "../../../shared/ui/Text";
import { invoke } from "@tauri-apps/api/core";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { InlineError } from "../../../shared/ui/InlineError";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Select } from "../../../shared/ui/Select";
import { Switch } from "../../../shared/ui/Switch";
import type { RemoteMachine } from "../model/protocol";

export type RoutePreference = "saved" | "lan" | "tailscale";
type Route = {
  address: string;
  kind: "tailscale" | "lan" | "name";
  source: "saved" | "other" | "reported";
  enabled: boolean;
};
type MachineRoutes = { routes: Route[]; prefer: RoutePreference; active?: string | null };
type RouteCheck = { address: string; reachable: boolean | null };

const kindLabel = (kind: Route["kind"]) =>
  kind === "tailscale" ? t("Tailscale") : kind === "lan" ? t("Home network") : t("SSH name");
const sourceLabel = (source: Route["source"]) =>
  source === "saved"
    ? t("SSH address")
    : source === "other"
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
  const key = ssh ? JSON.stringify(ssh) : "";
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps this mounted machine's native route snapshot current across retries and cancels obsolete reads on cleanup.
  useEffect(() => {
    if (!key) return;
    let current = true;
    const target = JSON.parse(key);
    setLoading(true);
    setReadError(false);
    setProbeError(false);
    invoke<MachineRoutes>("remote_machine_routes", { machineId: machine.id, target })
      .then((value) => current && setRoutes(value))
      .catch((reason: unknown) => {
        if (current)
          setReadError(
            !/unknown command|command.*not found|not supported|no desktop/i.test(String(reason)),
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    invoke<RouteCheck[]>("remote_machine_route_check", { target })
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
  }, [machine.id, key, retry]);
  if (!ssh) return null;
  // Without the desktop's route store only the saved other address is known.
  if (!routes)
    return (
      <div>
        {loading ? (
          <LoadingText />
        ) : readError ? (
          <InlineError>{t("Addresses could not be loaded.")}</InlineError>
        ) : null}
        {readError ? (
          <Button loading={loading} onClick={() => setRetry((value) => value + 1)}>
            {t("Retry")}
          </Button>
        ) : null}
        {ssh.alternate ? (
          <Text wrap="anywhere" as="div" tone="muted" className="mt-1">
            {t("Other address · ")}
            {ssh.alternate}
          </Text>
        ) : null}
      </div>
    );
  const save = (disabled: string[], prefer: RoutePreference) => {
    setSaving(true);
    setError("");
    invoke<MachineRoutes>("remote_machine_route_settings", {
      machineId: machine.id,
      target: ssh,
      disabled,
      prefer,
    })
      .then(setRoutes)
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setSaving(false));
  };
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
          <Text as="div" size="secondary" tone="inherit" weight="medium">
            {t("Addresses")}
          </Text>
          <Text as="p" tone="muted">
            {t("Tried in this order; the first one that answers is used.")}
          </Text>
        </div>
        {routes.routes.length > 1 ? (
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
      </div>
      <Surface as="ul" variant="outline" padding="none" dividers="stroke" className="flex flex-col">
        {routes.routes.map((route) => {
          const inUse = route.address === routes.active;
          const reachable = checks?.[route.address];
          return (
            <li
              key={route.address}
              data-route={route.address}
              className="flex min-w-0 items-center gap-3 px-3 py-2"
            >
              <div className={`min-w-0 flex-1 ${route.enabled ? "" : "opacity-60"}`}>
                <Text as="div" size="secondary" tone="inherit" truncate className="font-mono">
                  {route.address}
                </Text>
                <Text as="div" tone="muted">
                  {kindLabel(route.kind)} · {sourceLabel(route.source)}
                </Text>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {inUse ? (
                  <Badge size="xs" tone="accent">
                    {t("In use")}
                  </Badge>
                ) : null}
                {!route.enabled ? (
                  <Badge size="xs">{t("Off")}</Badge>
                ) : checks === undefined ? (
                  <Badge size="xs">{t("Checking…")}</Badge>
                ) : reachable === true ? (
                  <Badge size="xs" tone="success">
                    {t("Responds")}
                  </Badge>
                ) : reachable === false ? (
                  <Badge size="xs" tone="warning">
                    {t("No response")}
                  </Badge>
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
      <Text as="p" tone="muted">
        {t("Change the SSH and other address with Edit name and address.")}
      </Text>
      {error ? <InlineError>{error}</InlineError> : null}
      {readError ? <InlineError>{t("Addresses could not be loaded.")}</InlineError> : null}
      {probeError ? <InlineError>{t("Address check unavailable.")}</InlineError> : null}
      <Button disabled={saving} loading={loading} onClick={() => setRetry((value) => value + 1)}>
        {readError || probeError ? t("Retry") : t("Check again")}
      </Button>
    </section>
  );
}
