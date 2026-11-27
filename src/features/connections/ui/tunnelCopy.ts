import { t } from "../../../shared/i18n";
import type { TunnelProvider } from "../../../integrations/external-tunnels";
import type { TunnelUiIssue } from "../model/externalTunnelController";

/** The cause only; the surrounding retry or check action carries the next step. `remoteName`
 * names the sharing computer when it is not the one this window runs on. */
export const issueCopy = (issue: TunnelUiIssue, remoteName?: string): string =>
  ({
    "cli-missing": remoteName
      ? t("The tunnel CLI is missing on {p0}.", { p0: remoteName })
      : t("The tunnel CLI is missing on this computer."),
    "credential-missing": t("ngrok needs a valid authtoken."),
    "credential-store-unavailable": t("The secure credential store is unavailable."),
    "invalid-target": t("Enter a loopback HTTP or HTTPS URL, or a port from 1 to 65535."),
    "host-target-required": t("This port is bycoda itself. Choose Remote access to share it."),
    "approval-required": remoteName
      ? t("Tailscale Funnel is not enabled for {p0} yet.", { p0: remoteName })
      : t("Tailscale Funnel is not enabled for this computer yet."),
    "origin-unreachable": remoteName
      ? t("The local service is not listening on {p0}.", { p0: remoteName })
      : t("The local service is not listening on this computer."),
    "connection-failed": t("The tunnel provider could not connect."),
    "startup-timeout": t("The tunnel did not connect in time."),
    "unexpected-exit": t(
      "The tunnel process closed unexpectedly. Its public URL is no longer available.",
    ),
    "process-error": t("The tunnel process could not start."),
    "stop-failed": t("The tunnel process did not stop."),
    "host-restarted": t("The host restarted and interrupted this tunnel."),
    "storage-unavailable": t("Tunnel state could not be read or saved."),
    "host-update": remoteName
      ? t("Update bycoda Host on {p0} to manage external tunnels.", { p0: remoteName })
      : t("Update bycoda Host on this computer to manage external tunnels."),
    connection: t("The selected computer could not be reached."),
    "invalid-response": t("The host returned an invalid tunnel status."),
  })[issue];

export const stateCopy = (
  state: "starting" | "ready" | "stopping" | "stopped" | "error" | "interrupted",
) =>
  ({
    starting: t("Starting"),
    ready: t("Connected"),
    stopping: t("Stopping"),
    stopped: t("Stopped"),
    error: t("Error"),
    interrupted: t("Interrupted"),
  })[state];

export const providerName = (provider: TunnelProvider) =>
  provider === "ngrok"
    ? "ngrok"
    : provider === "tailscale"
      ? "Tailscale Funnel (public)"
      : "Cloudflare";
