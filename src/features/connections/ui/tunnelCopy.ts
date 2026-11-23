import type { TunnelProvider } from "../../../integrations/external-tunnels";
import type { TunnelUiIssue } from "../model/externalTunnelController";

/** The cause only; the surrounding retry or check action carries the next step. */
export const issueCopy: Record<TunnelUiIssue, string> = {
  "cli-missing": "The tunnel CLI is missing on this computer.",
  "credential-missing": "ngrok needs a valid authtoken.",
  "credential-store-unavailable": "The secure credential store is unavailable.",
  "invalid-target": "Enter a loopback HTTP or HTTPS URL, or a port from 1 to 65535.",
  "host-target-required": "This is the bycoda host port. Select bycoda host access to share it.",
  "origin-unreachable": "The local service is not listening on this computer.",
  "connection-failed": "The tunnel provider could not connect.",
  "startup-timeout": "The tunnel did not connect in time.",
  "unexpected-exit": "The tunnel process closed unexpectedly. Its public URL is no longer available.",
  "process-error": "The tunnel process could not start.",
  "stop-failed": "The tunnel process did not stop.",
  "host-restarted": "The host restarted and interrupted this tunnel.",
  "storage-unavailable": "Tunnel state could not be read or saved.",
  "host-update": "Update bycoda Host on this computer to manage external tunnels.",
  connection: "The selected computer could not be reached.",
  "invalid-response": "The host returned an invalid tunnel status.",
};

export const stateCopy = {
  starting: "Starting",
  ready: "Connected",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
  interrupted: "Interrupted",
};

export const providerName = (provider: TunnelProvider) =>
  provider === "ngrok" ? "ngrok" : "Cloudflare";
